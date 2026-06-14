// Event stream (FE-M1, rewritten). A deterministic, internally-consistent
// reconstruction of the protocol's event log:
//   • actors are PERSISTENT accounts (holders/personas/validators), never random
//   • the FULL §18.3 catalog is represented (governance, validator-status,
//     state-changes, redemptions, sweeps — not just the happy path)
//   • events are grouped into TRANSACTIONS (shared txDigest) where the protocol
//     emits several atomically, so `/tx/:digest` has real groupings.
// Time-series/aggregate values come from the same fixtures the charts read, so
// the swap to the live indexer (FE-M8) reproduces them.

import type { EventFeed, EventType, ProtocolEvent, TxRow } from "../types";
import { DAY, HOUR, NOW, usd } from "../format";
import { assets, disputes, validators, DEMO_WALLET, validatorByPool } from "./data";
import { holdersOf } from "./holders";
import { paramHistory, treasuryHistory, pauseHistory, genesisTxDigest, GENESIS_TS, protocolConfig } from "./governance";
import { seeded } from "./series";

const FEED_OF: Record<EventType, EventFeed> = {
  AssetCreated: "lifecycle",
  AssetVouched: "lifecycle",
  AssetStateChanged: "lifecycle",
  AssetCancelled: "lifecycle",
  MilestoneProofSubmitted: "lifecycle",
  MilestoneApproved: "lifecycle",
  TrancheReleased: "lifecycle",
  AssetOperational: "lifecycle",
  EntityDefaulted: "lifecycle",
  AssetClosed: "lifecycle",
  CapitalContributed: "position",
  ContributionRefunded: "position",
  SharesClaimed: "position",
  SharesWrapped: "position",
  SharesUnwrapped: "position",
  ShareRedeemed: "position",
  YieldClaimed: "position",
  RaiseFinalized: "revenue",
  RaiseAborted: "revenue",
  RevenueDeposited: "revenue",
  RolloverSwept: "revenue",
  CompensationSwept: "revenue",
  ValidatorRegistered: "validator",
  StakeAdded: "validator",
  StakeWithdrawn: "validator",
  ValidatorStatusChanged: "validator",
  DisputeOpened: "dispute",
  JurorVoted: "dispute",
  DisputeResolved: "dispute",
  ProtocolInitialized: "governance",
  ProtocolParamChanged: "governance",
  ProtocolTreasuryChanged: "governance",
  EmergencyStopTriggered: "governance",
  ProtocolResumed: "governance",
};

const rnd = seeded(31337);
function digest(): string {
  const hex = "0123456789abcdef";
  let s = "0x";
  for (let i = 0; i < 44; i++) s += hex[Math.floor(rnd() * 16)];
  return s;
}

let seq = 0;
type Partial = Omit<ProtocolEvent, "id" | "feed" | "txDigest">;
const events: ProtocolEvent[] = [];

function push(p: Partial, txDigest: string) {
  events.push({ id: `ev${seq++}`, feed: FEED_OF[p.type], txDigest, ...p });
}
/** One standalone transaction (unique digest). */
const one = (p: Partial) => push(p, digest());
/** A group of events emitted atomically in one transaction (shared digest). */
function tx(parts: Partial[]) {
  const d = digest();
  for (const p of parts) push(p, d);
}

/* ----------------------------------------------------- protocol genesis + governance */

one({
  type: "ProtocolInitialized",
  tsMs: GENESIS_TS,
  actor: protocolConfig.admin,
  actorRole: "admin",
  summary: "Gally protocol initialized",
  meta: `Config ${protocolConfig.configId.slice(0, 10)}… · v${protocolConfig.version}`,
});
for (const p of paramHistory) {
  push(
    {
      type: "ProtocolParamChanged",
      tsMs: p.tsMs,
      actor: protocolConfig.admin,
      actorRole: "admin",
      summary: `Parameter changed — ${p.name}`,
      meta: `${p.oldValue} → ${p.newValue}`,
    },
    p.txDigest,
  );
}
for (const t of treasuryHistory) {
  push(
    {
      type: "ProtocolTreasuryChanged",
      tsMs: t.tsMs,
      actor: protocolConfig.admin,
      actorRole: "admin",
      summary: "Protocol treasury rotated",
      meta: `${t.oldTreasury.slice(0, 8)}… → ${t.newTreasury.slice(0, 8)}…`,
    },
    t.txDigest,
  );
}
for (const ph of pauseHistory) {
  push(
    {
      type: ph.paused ? "EmergencyStopTriggered" : "ProtocolResumed",
      tsMs: ph.tsMs,
      actor: protocolConfig.admin,
      actorRole: "admin",
      summary: ph.paused ? "Emergency stop triggered" : "Protocol resumed",
      meta: ph.paused ? "Capital entry halted (exits stay open, D6)" : "Normal operation restored",
    },
    ph.txDigest,
  );
}

/* ----------------------------------------------------- validator registry */

for (const v of validators) {
  one({
    type: "ValidatorRegistered",
    tsMs: v.registeredAtMs,
    actor: v.address,
    actorRole: "validator",
    assetName: v.name,
    amount: v.stake,
    summary: `${v.name} registered a validator pool`,
    meta: `Staked ${usd(v.stake)}`,
  });
  // a top-up
  one({
    type: "StakeAdded",
    tsMs: v.registeredAtMs + 30 * DAY,
    actor: v.address,
    actorRole: "validator",
    assetName: v.name,
    amount: Math.round(v.stake * 0.12),
    summary: `${v.name} added stake`,
    meta: `Pool collateral topped up`,
  });
}
// a withdrawal by a healthy validator (free stake only)
one({
  type: "StakeWithdrawn",
  tsMs: NOW - 60 * DAY,
  actor: validators[3].address,
  actorRole: "validator",
  assetName: validators[3].name,
  amount: 80_000,
  summary: `${validators[3].name} withdrew free stake`,
  meta: "Within the locked-coverage floor",
});

/* ----------------------------------------------------- per-asset lifecycle */

const FINALIZED = new Set(["FUNDED", "EXECUTING", "OPERATIONAL", "DEFAULTED", "COMPENSATING", "CLOSED"]);

for (const a of assets) {
  const v = validatorByPool[a.validatorPoolId];
  const vName = v?.name ?? "validator";
  const ledger = holdersOf(a.id);
  const sample = ledger.slice(0, 3); // a few representative holders

  // create
  tx([
    {
      type: "AssetCreated",
      tsMs: a.createdAtMs,
      assetId: a.id,
      assetName: a.name,
      actor: a.entity,
      actorRole: "entity",
      summary: `${a.entityName} listed ${a.name}`,
      meta: `Goal ${usd(a.fundingGoal)} · ${a.tranches.length} tranches`,
    },
    {
      type: "AssetStateChanged",
      tsMs: a.createdAtMs,
      assetId: a.id,
      assetName: a.name,
      summary: `${a.name} → Pending vouch`,
    },
  ]);

  // cancelled (never vouched)
  if (a.state === "CANCELLED") {
    tx([
      {
        type: "AssetCancelled",
        tsMs: a.createdAtMs + 20 * DAY,
        assetId: a.id,
        assetName: a.name,
        actor: a.entity,
        actorRole: "entity",
        summary: `${a.name} cancelled`,
        meta: "No validator vouched within the timeout · collateral returned",
      },
      {
        type: "AssetStateChanged",
        tsMs: a.createdAtMs + 20 * DAY,
        assetId: a.id,
        assetName: a.name,
        summary: `${a.name} → Cancelled`,
      },
    ]);
    continue;
  }

  // vouch (everything past PENDING_VOUCH was vouched)
  if (a.state !== "PENDING_VOUCH") {
    tx([
      {
        type: "AssetVouched",
        tsMs: a.createdAtMs + 2 * DAY,
        assetId: a.id,
        assetName: a.name,
        actor: v?.address,
        actorRole: "validator",
        summary: `${vName} vouched legal docs for ${a.name}`,
        meta: `Locked ${usd(a.coverageLocked)} coverage`,
      },
      {
        type: "AssetStateChanged",
        tsMs: a.createdAtMs + 2 * DAY,
        assetId: a.id,
        assetName: a.name,
        summary: `${a.name} → Funding`,
      },
    ]);
  }

  // contributions (sampled holders + demo), ending near the raise close
  if (a.raised > 0) {
    const contributors = sample.length ? sample.map((h) => h.address) : [DEMO_WALLET];
    contributors.forEach((address, i) => {
      const frac = (i + 1) / (contributors.length + 1);
      one({
        type: "CapitalContributed",
        tsMs: a.createdAtMs + (5 + i * 4) * DAY,
        assetId: a.id,
        assetName: a.name,
        actor: address,
        actorRole: "investor",
        amount: Math.round(a.raised * (0.06 + rnd() * 0.05)),
        summary: `Capital contributed to ${a.name}`,
        meta: `Raised ${usd(Math.round(a.raised * frac))} of ${usd(a.fundingGoal)}`,
      });
    });
  }

  // failed raise
  if (a.state === "FAILED") {
    tx([
      {
        type: "RaiseAborted",
        tsMs: a.fundingDeadlineMs + HOUR,
        assetId: a.id,
        assetName: a.name,
        summary: `Raise aborted — ${a.name}`,
        meta: `${usd(a.raised)} of ${usd(a.fundingGoal)} · refunds open`,
      },
      {
        type: "AssetStateChanged",
        tsMs: a.fundingDeadlineMs + HOUR,
        assetId: a.id,
        assetName: a.name,
        summary: `${a.name} → Failed`,
      },
    ]);
    one({
      type: "ContributionRefunded",
      tsMs: a.fundingDeadlineMs + 5 * DAY,
      assetId: a.id,
      assetName: a.name,
      actor: DEMO_WALLET === a.entity ? a.entity : "0x1a02investor00000000000000000000000000000000000000000000sahel002",
      actorRole: "investor",
      amount: Math.round(a.raised * 0.18),
      summary: `Contribution refunded — ${a.name}`,
      meta: "Receipt burned, principal returned",
    });
    continue;
  }

  if (a.state === "FUNDING" || a.state === "PENDING_VOUCH") continue;

  // finalize (post-finalize states)
  if (FINALIZED.has(a.state)) {
    tx([
      {
        type: "RaiseFinalized",
        tsMs: a.fundingDeadlineMs,
        assetId: a.id,
        assetName: a.name,
        summary: `Raise finalized for ${a.name}`,
        meta: `${a.fundingGoal.toLocaleString()} shares minted · accumulator armed`,
      },
      {
        type: "AssetStateChanged",
        tsMs: a.fundingDeadlineMs,
        assetId: a.id,
        assetName: a.name,
        summary: `${a.name} → Executing`,
      },
    ]);
    // a few holders claim their deeds
    sample.forEach((h, i) =>
      one({
        type: "SharesClaimed",
        tsMs: a.fundingDeadlineMs + (1 + i) * DAY,
        assetId: a.id,
        assetName: a.name,
        actor: h.address,
        actorRole: "investor",
        amount: h.shareCount + h.wrapped,
        summary: `Shares claimed — ${a.name}`,
        meta: "Receipt converted to GallyShare deed",
      }),
    );
  }

  // tranche milestones: submit (entity) → approve (validator) → release (entity)
  for (const t of a.tranches) {
    if (!t.approvedBy && !t.released) continue;
    one({
      type: "MilestoneProofSubmitted",
      tsMs: t.deadlineMs - 8 * DAY,
      assetId: a.id,
      assetName: a.name,
      actor: a.entity,
      actorRole: "entity",
      summary: `Milestone ${t.index + 1} proof submitted — ${a.name}`,
      meta: t.description,
    });
    one({
      type: "MilestoneApproved",
      tsMs: t.deadlineMs - 5 * DAY,
      assetId: a.id,
      assetName: a.name,
      actor: validatorByPool[t.approvedBy ?? a.validatorPoolId]?.address ?? t.approvedBy,
      actorRole: "validator",
      summary: `Milestone ${t.index + 1} approved — ${a.name}`,
      meta: `By ${vName}`,
    });
    if (t.released) {
      const isFinal = t.index === a.tranches.length - 1;
      const parts: Partial[] = [
        {
          type: "TrancheReleased",
          tsMs: t.deadlineMs - 3 * DAY,
          assetId: a.id,
          assetName: a.name,
          actor: a.entity,
          actorRole: "entity",
          amount: t.amount,
          summary: `Tranche ${t.index + 1} released — ${a.name}`,
          meta: t.description,
        },
      ];
      if (isFinal && (a.state === "OPERATIONAL" || a.state === "CLOSED")) {
        parts.push({
          type: "AssetStateChanged",
          tsMs: t.deadlineMs - 3 * DAY,
          assetId: a.id,
          assetName: a.name,
          summary: `${a.name} → Operational`,
        });
        parts.push({
          type: "AssetOperational",
          tsMs: t.deadlineMs - 3 * DAY,
          assetId: a.id,
          assetName: a.name,
          summary: `${a.name} is now operational`,
          meta: "Revenue distribution active",
        });
      }
      tx(parts);
    }
  }

  // operational economics: revenue, rollover sweep, yield claims, wrap/unwrap
  const acc = a.accumulator;
  if ((a.state === "OPERATIONAL" || a.state === "CLOSED") && acc) {
    const depCount = 4;
    for (let i = 0; i < depCount; i++) {
      const gross = Math.round((acc.lifetimeInvestorRevenue / depCount) * (0.85 + rnd() * 0.3));
      const fee = Math.round(gross * (protocolConfig.protocolFeeBps / 10_000));
      const investor = Math.round((gross - fee) * (a.revenueSplitBps / 10_000));
      one({
        type: "RevenueDeposited",
        tsMs: NOW - (depCount - i) * 18 * DAY,
        assetId: a.id,
        assetName: a.name,
        actor: a.entity,
        actorRole: "entity",
        amount: gross,
        summary: `Revenue deposited — ${a.name}`,
        meta: `Fee ${usd(fee)} · investors ${usd(investor)} · entity ${usd(gross - fee - investor)}`,
      });
    }
    if (acc.rolloverReserve > 0) {
      one({
        type: "RolloverSwept",
        tsMs: NOW - 9 * DAY,
        assetId: a.id,
        assetName: a.name,
        amount: acc.rolloverReserve,
        summary: `Rollover reserve swept — ${a.name}`,
        meta: "Stranded revenue distributed on first unwrap",
      });
    }
    // yield claims by sampled holders + the demo wallet
    sample.forEach((h, i) => {
      if (h.shareCount <= 0) return;
      one({
        type: "YieldClaimed",
        tsMs: NOW - (4 + i * 5) * DAY,
        assetId: a.id,
        assetName: a.name,
        actor: h.address,
        actorRole: "investor",
        amount: Math.max(1, Math.round((acc.cumulativeIndex - h.yieldClaimedIndex) * h.shareCount)),
        summary: `Yield claimed from ${a.name}`,
        meta: "Lazy-index payout",
      });
    });
    // a wrap and an unwrap to exercise both
    const wrapHolder = ledger.find((h) => h.wrapped > 0);
    if (wrapHolder) {
      one({
        type: "SharesWrapped",
        tsMs: NOW - 22 * DAY,
        assetId: a.id,
        assetName: a.name,
        actor: wrapHolder.address,
        actorRole: "investor",
        amount: wrapHolder.wrapped,
        summary: `Shares wrapped to ${acc.tokenSymbol}`,
        meta: `${acc.totalWrappedShares.toLocaleString()} circulating`,
      });
      one({
        type: "SharesUnwrapped",
        tsMs: NOW - 11 * DAY,
        assetId: a.id,
        assetName: a.name,
        actor: ledger[Math.min(1, ledger.length - 1)].address,
        actorRole: "investor",
        amount: Math.max(1, Math.round(wrapHolder.wrapped * 0.25)),
        summary: `Coins unwrapped to GallyShare — ${a.name}`,
        meta: "Yield eligibility resumes at the current index",
      });
    }
  }

  // closed: redemptions
  if (a.state === "CLOSED") {
    tx([
      {
        type: "AssetClosed",
        tsMs: NOW - 30 * DAY,
        assetId: a.id,
        assetName: a.name,
        summary: `${a.name} closed`,
        meta: "Term return target met · settlement complete",
      },
      {
        type: "AssetStateChanged",
        tsMs: NOW - 30 * DAY,
        assetId: a.id,
        assetName: a.name,
        summary: `${a.name} → Closed`,
      },
    ]);
    sample.slice(0, 2).forEach((h, i) =>
      one({
        type: "ShareRedeemed",
        tsMs: NOW - (24 - i * 4) * DAY,
        assetId: a.id,
        assetName: a.name,
        actor: h.address,
        actorRole: "investor",
        amount: h.shareCount,
        summary: `Shares redeemed — ${a.name}`,
        meta: "Deed burned after final claim",
      }),
    );
  }

  // default → compensation
  if (a.state === "DEFAULTED" || a.state === "COMPENSATING") {
    const compPool = acc?.compensationPool ?? 0;
    tx([
      {
        type: "EntityDefaulted",
        tsMs: NOW - 20 * DAY,
        assetId: a.id,
        assetName: a.name,
        actor: a.entity,
        actorRole: "entity",
        amount: compPool,
        summary: `${a.entityName} defaulted on ${a.name}`,
        meta: "Collateral + residual escrow seized into compensation",
      },
      {
        type: "AssetStateChanged",
        tsMs: NOW - 20 * DAY,
        assetId: a.id,
        assetName: a.name,
        summary: `${a.name} → ${a.state === "DEFAULTED" ? "Defaulted" : "Compensating"}`,
      },
      {
        type: "CompensationSwept",
        tsMs: NOW - 20 * DAY,
        assetId: a.id,
        assetName: a.name,
        amount: compPool,
        summary: `Compensation swept — ${a.name}`,
        meta: "Distributed pro-rata after the unwrap grace window",
      },
    ]);
  }
}

/* ----------------------------------------------------- disputes */

for (const d of disputes) {
  const target = validatorByPool[d.targetPoolId];
  // open + freeze target
  tx([
    {
      type: "DisputeOpened",
      tsMs: d.openedAtMs,
      assetId: d.assetId,
      assetName: d.assetName,
      actor: d.challenger,
      actorRole: "challenger",
      amount: d.bond,
      summary: `Dispute opened against ${d.targetValidatorName}`,
      meta: `${d.assetName} · bond ${usd(d.bond)}`,
    },
    {
      type: "ValidatorStatusChanged",
      tsMs: d.openedAtMs,
      assetId: d.assetId,
      assetName: d.targetValidatorName,
      actor: target?.address,
      actorRole: "validator",
      summary: `${d.targetValidatorName} → Frozen`,
      meta: "Pending approvals halted while contested",
    },
  ]);
  // juror votes (actors = other validator pools, cycling)
  const jurors = validators.filter((x) => x.poolId !== d.targetPoolId && x.status !== "SLASHED");
  const totalVotes = d.votesGuilty + d.votesInnocent;
  for (let i = 0; i < totalVotes; i++) {
    const juror = jurors[i % jurors.length];
    one({
      type: "JurorVoted",
      tsMs: d.openedAtMs + (i + 1) * 7 * HOUR,
      assetId: d.assetId,
      assetName: d.assetName,
      actor: juror?.address,
      actorRole: "validator",
      summary: `Juror voted ${i < d.votesGuilty ? "guilty" : "innocent"}`,
      meta: `Tally ${Math.min(i + 1, d.votesGuilty)}–${Math.max(0, i + 1 - d.votesGuilty)}`,
    });
  }
  // resolution
  if (d.status !== "OPEN") {
    const upheld = d.status === "UPHELD";
    const parts: Partial[] = [
      {
        type: "DisputeResolved",
        tsMs: d.votingDeadlineMs + HOUR,
        assetId: d.assetId,
        assetName: d.assetName,
        actor: d.challenger,
        actorRole: "challenger",
        amount: d.slashed,
        summary: `Dispute ${upheld ? "upheld" : d.status === "REJECTED" ? "rejected" : "expired"} — ${d.targetValidatorName}`,
        meta: upheld
          ? `Slashed ${usd(d.slashed ?? 0)} · bounty ${usd(d.bounty ?? 0)}`
          : "Challenger bond forfeited 50/50 to jurors & target",
      },
      {
        type: "ValidatorStatusChanged",
        tsMs: d.votingDeadlineMs + HOUR,
        assetId: d.assetId,
        assetName: d.targetValidatorName,
        actor: target?.address,
        actorRole: "validator",
        summary: `${d.targetValidatorName} → ${upheld ? "Slashed" : "Active"}`,
        meta: upheld ? "Coverage slashed; pool terminal" : "Unfrozen — attestation upheld",
      },
    ];
    if (upheld) {
      parts.push({
        type: "CompensationSwept",
        tsMs: d.votingDeadlineMs + HOUR,
        assetId: d.assetId,
        assetName: d.assetName,
        amount: (d.slashed ?? 0) - (d.bounty ?? 0),
        summary: `Compensation swept — ${d.assetName}`,
        meta: "Slashed remainder routed to holders",
      });
    }
    tx(parts);
  }
}

events.sort((a, b) => b.tsMs - a.tsMs);

/* ----------------------------------------------------- exports / selectors */

export const allEvents = events;

export const eventsForAsset = (assetId: string) => events.filter((e) => e.assetId === assetId);
export const eventsForActor = (address: string) => events.filter((e) => e.actor === address);
export const eventsByFeed = (feed: EventFeed) => events.filter((e) => e.feed === feed);
export const recentEvents = (n: number) => events.slice(0, n);
export const portfolioActivity = eventsForActor(DEMO_WALLET);

export const eventsForTx = (digest: string) => events.filter((e) => e.txDigest === digest);

/** All transactions (event groups), newest first. */
export const txList = (): TxRow[] => {
  const byDigest = new Map<string, ProtocolEvent[]>();
  for (const e of events) {
    const list = byDigest.get(e.txDigest) ?? [];
    list.push(e);
    byDigest.set(e.txDigest, list);
  }
  const rows: TxRow[] = [];
  for (const [digest, evs] of byDigest) {
    rows.push({ digest, tsMs: Math.max(...evs.map((e) => e.tsMs)), events: evs, kind: evs[0].type });
  }
  return rows.sort((a, b) => b.tsMs - a.tsMs);
};

export const txByDigest = (digest: string): TxRow | undefined => {
  const evs = eventsForTx(digest);
  if (!evs.length) return undefined;
  return { digest, tsMs: Math.max(...evs.map((e) => e.tsMs)), events: evs, kind: evs[0].type };
};
