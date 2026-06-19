// FE-M8a — Wire → `lib/types.ts` mappers.
//
// Pure functions: BI-M8 JSON (see `wire.ts`) → the domain shapes `app/`+`components/`
// already consume. The mock path and the live path both ultimately hand the UI these
// shapes, so the type-seam bet holds. No `fetch` here — just translation + Tier-5
// derivation (FUNDED label, derived series).

import type {
  Accumulator,
  Asset,
  AssetState,
  Dispute,
  DisputeStatus,
  GovParamChange,
  HolderEntry,
  Point,
  ProtocolEvent,
  Tranche,
  TxRow,
  Validator,
} from "@/lib/types";
import { eventFeedOf, eventTypeOf } from "./events";
import {
  categoryOfInt,
  indexHuman,
  intOf,
  stateOfByte,
  usdc,
  validatorStatusOfByte,
  type WireAsset,
  type WireDispute,
  type WireGovEvent,
  type WireHolder,
  type WirePortfolioEvent,
  type WireRaisePoint,
  type WireTrancheSchedule,
  type WireTx,
  type WireValidator,
  type WireValidatorDetail,
  type WireWrapPoint,
  type WireYieldPoint,
} from "./wire";

/** States in which the capital raise has fully completed (raised == goal). */
const RAISE_COMPLETE: AssetState[] = ["EXECUTING", "OPERATIONAL", "COMPENSATING", "CLOSED"];

/**
 * Tier-5 derived display state (m8a §8.1): the chain has no FUNDED/DEFAULTED byte.
 * - FUNDED  = FUNDING && fully subscribed (raised ≥ goal), awaiting finalize.
 * - DEFAULTED = an EXECUTING/OPERATIONAL asset flagged in default before it settles
 *   into COMPENSATING (driven by a real `defaulted` input; never fabricated).
 */
export function deriveState(byteState: AssetState, raised: number, goal: number, defaulted = false): AssetState {
  if (byteState === "FUNDING" && goal > 0 && raised >= goal) return "FUNDED";
  if (defaulted && (byteState === "EXECUTING" || byteState === "OPERATIONAL")) return "DEFAULTED";
  return byteState;
}

export interface AssetExtras {
  raised?: number;
  raiseSeries?: Point[];
  indexSeries?: Point[];
  wrapSeries?: Point[];
  cumulativeIndex?: number;
  totalMintedShares?: number;
  totalWrappedShares?: number;
  holders?: number;
  contributors?: number;
  disputed?: boolean;
  defaulted?: boolean;
  tokenSymbol?: string;
}

export function mapAsset(w: WireAsset, extras: AssetExtras = {}): Asset {
  const base = stateOfByte(w.current_state);
  const goal = usdc(w.goal);
  // raised: exact from the series when we have it; else inferred from lifecycle.
  const raised =
    extras.raised ??
    (RAISE_COMPLETE.includes(base) ? goal : 0);
  const state = deriveState(base, raised, goal, extras.defaulted);
  const category = categoryOfInt(w.category);
  const entityName = w.entity_name ?? "Unknown Entity";
  const name = w.name ?? `Asset ${w.asset_id.slice(0, 8)}`;
  const location = w.location ?? "—";

  const acc = w.accumulator;
  const accumulator: Accumulator | undefined =
    w.accumulator_id == null
      ? undefined
      : {
          id: w.accumulator_id,
          tokenSymbol: extras.tokenSymbol ?? w.ticker ?? "Coin<T>",
          cumulativeIndex: extras.cumulativeIndex ?? 0,
          totalMintedShares: extras.totalMintedShares ?? 0,
          totalWrappedShares: extras.totalWrappedShares ?? 0,
          rewardPool: usdc(acc?.reward_pool),
          rolloverReserve: usdc(acc?.rollover_reserve),
          compensationPool: usdc(acc?.compensation_pool),
          wrappingFrozen: acc?.wrapping_frozen ?? false,
          compensationUnlockMs: acc?.compensation_unlock_ms ?? undefined,
          lifetimeInvestorRevenue: usdc(acc?.reward_pool),
          apy: w.apy ?? 0,
        };

  return {
    id: w.asset_id,
    name,
    ticker: w.ticker ?? name.slice(0, 4).toUpperCase(),
    entity: w.entity,
    entityName,
    category,
    state,
    blurb: `${entityName} — ${category} in ${location}.`,
    location,
    fundingGoal: goal,
    raised,
    fundingDeadlineMs: w.funding_deadline_ms,
    createdAtMs: w.created_at_ms,
    tranches: [], // filled by mapTranches on the detail
    entityCollateral: usdc(w.collateral),
    revenueSplitBps: w.revenue_split_bps,
    accumulator,
    isTermFinancing: w.is_term_financing ?? false,
    returnTarget: usdc(w.return_target),
    disputed: extras.disputed ?? false,
    validatorPoolId: w.validator_pool_id ?? "",
    coverageLocked: usdc(w.coverage),
    raiseSeries: extras.raiseSeries ?? [],
    indexSeries: extras.indexSeries ?? [],
    wrapSeries: extras.wrapSeries ?? [],
    spark: (extras.raiseSeries ?? extras.indexSeries ?? []).map((p) => p.v),
    contributors: extras.contributors ?? 0,
    holders: extras.holders ?? 0,
  };
}

export function mapTranches(schedule: WireTrancheSchedule[], released: Set<number>, approvers: Map<number, { by?: string; blob?: string; sha?: string }>): Tranche[] {
  return schedule
    .slice()
    .sort((a, b) => a.tranche_index - b.tranche_index)
    .map((t) => {
      const extra = approvers.get(t.tranche_index);
      return {
        index: t.tranche_index,
        amount: usdc(t.amount),
        description: t.description,
        deadlineMs: t.deadline_ms,
        released: released.has(t.tranche_index),
        approvedBy: extra?.by,
        proofBlobId: extra?.blob,
        proofSha256: extra?.sha,
      };
    });
}

export function mapRaiseSeries(points: WireRaisePoint[]): Point[] {
  return points.map((p) => ({ t: p.timestamp_ms, v: usdc(p.raised_after) }));
}

export function mapYieldSeries(points: WireYieldPoint[]): Point[] {
  return points
    .filter((p) => p.index_after != null)
    .map((p) => ({ t: p.timestamp_ms, v: indexHuman(p.index_after) }));
}

export function mapWrapSeries(points: WireWrapPoint[]): Point[] {
  return points.map((p) => ({ t: p.timestamp_ms, v: usdc(p.total_wrapped_after) }));
}

export function mapValidator(w: WireValidator, detail?: WireValidatorDetail): Validator {
  const tr = detail?.track_record;
  const stake = usdc(w.initial_stake);
  return {
    poolId: w.pool_id,
    address: w.validator,
    name: w.name ?? `Validator ${w.pool_id.slice(0, 8)}`,
    status: validatorStatusOfByte(w.current_status),
    stake,
    locked: usdc(tr?.coverage_locked),
    activeVouches: intOf(tr?.active_vouches),
    registeredAtMs: w.registered_at_ms,
    assetsVouched: intOf(tr?.assets_vouched),
    milestonesApproved: intOf(tr?.milestones_approved),
    disputesAgainst: intOf(tr?.disputes_against),
    disputesUpheld: intOf(tr?.disputes_upheld),
    reputation: detail ? intOf(detail.reputation) : 0,
    stakeSpark: [],
  };
}

function disputeStatus(w: WireDispute): DisputeStatus {
  if (w.verdict == null) {
    if (w.voting_deadline_ms != null && Date.now() > w.voting_deadline_ms) return "EXPIRED";
    return "OPEN";
  }
  return w.verdict === 1 ? "UPHELD" : "REJECTED";
}

export function mapDispute(w: WireDispute): Dispute {
  return {
    id: w.dispute_id,
    assetId: w.asset_id,
    assetName: w.asset_name ?? `Asset ${w.asset_id.slice(0, 8)}`,
    targetPoolId: w.target_pool_id,
    targetValidatorName: w.target_validator_name ?? `Validator ${w.target_pool_id.slice(0, 8)}`,
    challenger: w.challenger,
    bond: usdc(w.bond),
    status: disputeStatus(w),
    votesGuilty: intOf(w.votes_guilty),
    votesInnocent: intOf(w.votes_innocent),
    quorum: intOf(w.quorum) || 3,
    votingDeadlineMs: w.voting_deadline_ms ?? 0,
    openedAtMs: w.opened_at_ms,
    reason: w.reason ?? "—",
    slashed: w.slashed == null ? undefined : usdc(w.slashed),
    bounty: w.bounty == null ? undefined : usdc(w.bounty),
  };
}

export function mapHolder(w: WireHolder): HolderEntry {
  return {
    address: w.address,
    shareCount: usdc(w.share_count),
    wrapped: usdc(w.wrapped),
    acquiredAtMs: w.acquired_at_ms,
    yieldClaimedIndex: indexHuman(w.yield_claimed_index),
  };
}

export function mapGovEvent(w: WireGovEvent): GovParamChange {
  if (w.event_type === "ProtocolTreasuryChanged") {
    return { name: "treasury", oldValue: w.old_treasury ?? "—", newValue: w.new_treasury ?? "—", tsMs: w.timestamp_ms, txDigest: w.tx_digest };
  }
  if (w.event_type === "ProtocolParamChanged") {
    return { name: w.param_name ?? "param", oldValue: w.old_value ?? "—", newValue: w.new_value ?? "—", tsMs: w.timestamp_ms, txDigest: w.tx_digest };
  }
  // Initialized / EmergencyStop / Resumed — render as a status line.
  const label =
    w.event_type === "ProtocolInitialized" ? "initialized" : w.event_type === "EmergencyStopTriggered" ? "paused" : w.event_type === "ProtocolResumed" ? "resumed" : w.event_type;
  return { name: label, oldValue: "—", newValue: "—", tsMs: w.timestamp_ms, txDigest: w.tx_digest };
}

export function mapPortfolioEvent(w: WirePortfolioEvent): ProtocolEvent {
  const type = eventTypeOf(w.event_type);
  return {
    id: `${w.tx_digest}:${w.event_type}:${w.timestamp_ms}`,
    type,
    feed: eventFeedOf(type),
    tsMs: w.timestamp_ms,
    assetId: w.asset_id,
    actor: w.actor,
    amount: w.amount == null ? undefined : usdc(w.amount),
    txDigest: w.tx_digest,
    summary: `${type} ${w.amount ? usdc(w.amount).toLocaleString() : ""}`.trim(),
  };
}

export function mapTx(w: WireTx): TxRow {
  const events: ProtocolEvent[] = w.events.map((e) => {
    const type = eventTypeOf(e.event_type);
    const p = e.payload as Record<string, unknown>;
    const assetId = (p.asset_id as string) ?? undefined;
    const actor = (p.actor as string) ?? (p.contributor as string) ?? undefined;
    return {
      id: `${w.tx_digest}:${e.event_seq}`,
      type,
      feed: eventFeedOf(type),
      tsMs: w.timestamp_ms,
      assetId,
      actor,
      txDigest: w.tx_digest,
      summary: type,
    };
  });
  return {
    digest: w.tx_digest,
    tsMs: w.timestamp_ms,
    events,
    kind: events[0]?.type ?? "transaction",
  };
}
