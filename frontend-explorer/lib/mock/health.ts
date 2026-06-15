// Asset health, default-risk & holder-protection selectors (FE-M5).
//
// Everything here is *derived* from the same fixtures the rest of the explorer
// reads (the holder ledger + the accumulator index + tranche deadlines), exactly
// as the indexer would reconstruct it — no new hand-set numbers. Three concerns:
//   • Solvency   — reward_pool vs. owed (§15.4 / I-M2): is unclaimed yield backed?
//   • Default-risk — the next unreleased tranche's deadline (forward-looking).
//   • Compensation — the §13/§14 restitution stack + the grace deadline holders
//                    must unwrap before to keep their restitution (D5).

import type { Asset } from "../types";
import { assetById } from "./data";
import { holdersOf } from "./holders";
import { NOW, DAY } from "../format";

/* --------------------------------------------------------------- solvency */

export interface Solvency {
  owed: number; // Σ over unwrapped deeds of (index − share.index)·count  (§15.4)
  rewardPool: number; // USDC backing those entitlements
  ratio: number; // rewardPool / owed (Infinity when nothing is owed)
  buffer: number; // rewardPool − owed (the truncation-dust solvency buffer)
  healthy: boolean; // I-M2: rewardPool ≥ owed (always true for a sound fixture)
  hasYield: boolean; // index has moved → solvency is a meaningful question
}

/** Total unclaimed yield owed across an asset's unwrapped deeds (matches the per-holder claimable). */
export function owedOf(assetId: string): number {
  const a = assetById[assetId];
  const cumIndex = a?.accumulator?.cumulativeIndex ?? 0;
  if (!a || cumIndex <= 0) return 0;
  return holdersOf(assetId).reduce(
    (s, h) => s + Math.max(0, Math.round((cumIndex - h.yieldClaimedIndex) * h.shareCount)),
    0,
  );
}

/**
 * Solvency of an asset's reward pool vs. what it owes (§15.4). `reward_pool ≥ owed`
 * is invariant I-M2 — the gap is exactly cumulative truncation dust, which favors
 * the pool. So a sound fixture is always "healthy"; the ratio quantifies the buffer.
 */
export function solvencyOf(assetId: string): Solvency {
  const a = assetById[assetId];
  const rewardPool = a?.accumulator?.rewardPool ?? 0;
  const cumIndex = a?.accumulator?.cumulativeIndex ?? 0;
  const owed = owedOf(assetId);
  return {
    owed,
    rewardPool,
    ratio: owed > 0 ? rewardPool / owed : Infinity,
    buffer: rewardPool - owed,
    healthy: rewardPool >= owed,
    hasYield: cumIndex > 0,
  };
}

/* ----------------------------------------------------------- default risk */

export type DeadlineRisk = "ok" | "soon" | "overdue";

export interface NextDeadline {
  index: number;
  description: string;
  amount: number;
  deadlineMs: number;
  daysLeft: number; // signed — negative once the deadline has passed
  overdue: boolean;
  risk: DeadlineRisk;
}

/** Window (days) before a tranche deadline at which we flag it "due soon". */
const SOON_DAYS = 14;

/**
 * The next unreleased tranche's deadline as a forward-looking default-risk clock
 * (Flow J, §14): once `now > deadline` with the proof unapproved, anyone may
 * `flag_default`. Returns undefined when no tranche is pending (all released).
 */
export function nextTrancheOf(asset: Asset): NextDeadline | undefined {
  const t = asset.tranches.find((x) => !x.released);
  if (!t) return undefined;
  const daysLeft = Math.round((t.deadlineMs - NOW) / DAY);
  const overdue = t.deadlineMs < NOW;
  const risk: DeadlineRisk = overdue ? "overdue" : daysLeft <= SOON_DAYS ? "soon" : "ok";
  return {
    index: t.index,
    description: t.description,
    amount: t.amount,
    deadlineMs: t.deadlineMs,
    daysLeft,
    overdue,
    risk,
  };
}

/* ------------------------------------------------- compensation / grace */

export interface Grace {
  unlockMs: number;
  active: boolean; // wrapping frozen AND the window has not yet closed
  daysLeft: number; // signed days until the unwrap window closes
}

/**
 * The compensation grace window (D5): while `wrapping_frozen`, wrapped holders
 * must unwrap before `compensation_unlock_ms` or they permanently miss the
 * slashed/seized restitution swept into the index. Undefined when no window is set.
 */
export function graceOf(asset: Asset): Grace | undefined {
  const unlockMs = asset.accumulator?.compensationUnlockMs;
  if (unlockMs == null) return undefined;
  const frozen = asset.accumulator?.wrappingFrozen ?? false;
  return {
    unlockMs,
    active: frozen && NOW < unlockMs,
    daysLeft: Math.round((unlockMs - NOW) / DAY),
  };
}

export interface CompLayer {
  label: string;
  amount: number;
  note: string;
}

export interface CompensationStack {
  layers: CompLayer[]; // seized in this order: escrow → validator slash → entity collateral
  pool: number; // current compensation_pool balance
}

/**
 * The three-layer restitution stack made whole to holders on default/upheld
 * dispute (§13 routing, §14 Triangle of Repercussion): undeployed escrow first,
 * then the validator's slashed coverage, then the entity's collateral bond.
 */
export function compensationLayersOf(asset: Asset): CompensationStack {
  const escrow = asset.tranches.filter((t) => !t.released).reduce((s, t) => s + t.amount, 0);
  return {
    layers: [
      {
        label: "Undeployed escrow",
        amount: escrow,
        note: "Capital still held against unreleased tranches — seized first.",
      },
      {
        label: "Validator coverage",
        amount: asset.coverageLocked,
        note: "Slashed from the vouching pool when a dispute is upheld.",
      },
      {
        label: "Entity collateral",
        amount: asset.entityCollateral,
        note: "The entity's slashable skin-in-the-game bond.",
      },
    ],
    pool: asset.accumulator?.compensationPool ?? 0,
  };
}

/** True when an asset's wrapped holders are exposed to the restitution-forfeit risk (§13). */
export function isCompensating(asset: Asset): boolean {
  return (
    asset.state === "DEFAULTED" ||
    asset.state === "COMPENSATING" ||
    (asset.accumulator?.wrappingFrozen ?? false)
  );
}
