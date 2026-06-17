// Permissionless "crank" (keeper) operations (FE-M7.2, spec §2.2 verb #9).
//
// Cranks are the protocol's permissionless maintenance calls: anyone may run them
// once an on-chain precondition is met. This module DERIVES, from the same mock
// fixtures the explorer reads, exactly which cranks are runnable right now and
// which are still pending — mirroring each Move precondition 1:1 so the UI never
// offers a call the contract would abort:
//
//   • resolve_dispute<T>    dispute.move  — OPEN dispute, voting window elapsed
//   • flag_default<T>       asset.move    — EXECUTING, next tranche deadline missed (unapproved)
//   • abort_failed_raise    asset.move    — FUNDING, funding deadline passed, raise short of goal
//   • sweep_rollover<T>     accumulator   — rollover_reserve > 0 AND unwrapped supply > 0
//   • sweep_compensation<T> accumulator   — now ≥ compensation_unlock_ms AND compensation_pool > 0
//
// Pure + deterministic (eligibility is computed against the fixed `NOW`).

import type { Asset, Dispute } from "../types";
import type { CrankKind } from "../tx/intents";
import { assets, disputes } from "./data";
import { NOW } from "../format";

export interface CrankOp {
  crank: CrankKind;
  label: string; // button/verb label
  entry: string; // the Move entry it maps to
  description: string; // one line: what running it does
  targetId: string; // subject object id
  targetLabel: string; // human label for the subject
  route: string; // deep-link to the subject's page
  eligible: boolean; // precondition currently met
  reason: string; // why it is / isn't runnable
  availableAtMs?: number; // when a time-gated crank unlocks (for the countdown)
}

/** Unwrapped (yield-bearing) supply = minted deeds − wrapped Coin<T>. */
function unwrappedSupply(a: Asset): number {
  const acc = a.accumulator;
  if (!acc) return 0;
  return Math.max(0, acc.totalMintedShares - acc.totalWrappedShares);
}

/* ------------------------------------------------------------- per subject */

/** Asset-scoped cranks: flag_default (EXECUTING) and abort_failed_raise (FUNDING). */
export function cranksForAsset(a: Asset): CrankOp[] {
  const out: CrankOp[] = [];
  const route = `/assets/${a.id}`;

  if (a.state === "EXECUTING") {
    const t = a.tranches.find((x) => !x.released);
    if (t) {
      const overdue = NOW > t.deadlineMs;
      const eligible = overdue && !t.approvedBy;
      out.push({
        crank: "flag_default",
        label: "Flag default",
        entry: "asset::flag_default",
        description:
          "Milestone deadline missed without an approved proof — seize the entity's collateral + undeployed escrow into the compensation pool.",
        targetId: a.id,
        targetLabel: a.name,
        route,
        eligible,
        availableAtMs: t.deadlineMs,
        reason: eligible
          ? `Milestone ${t.index} deadline passed unapproved — anyone can flag the default.`
          : t.approvedBy
            ? `Milestone ${t.index} proof is already approved — not a default.`
            : `Milestone ${t.index} deadline has not passed yet.`,
      });
    }
  }

  if (a.state === "FUNDING") {
    const expired = NOW > a.fundingDeadlineMs;
    const short = a.raised < a.fundingGoal;
    const eligible = expired && short;
    out.push({
      crank: "abort_failed_raise",
      label: "Abort failed raise",
      entry: "asset::abort_failed_raise",
      description:
        "Funding window closed below goal — fail the raise so contributors can refund and the entity's collateral goes home.",
      targetId: a.id,
      targetLabel: a.name,
      route,
      eligible,
      availableAtMs: a.fundingDeadlineMs,
      reason: eligible
        ? "Funding deadline passed below goal — anyone can abort the raise."
        : !expired
          ? "Funding window is still open."
          : "The goal was met — the raise can be finalized, not aborted.",
    });
  }

  return out;
}

/** Accumulator-scoped cranks: sweep_rollover and sweep_compensation. */
export function cranksForAccumulator(a: Asset): CrankOp[] {
  const acc = a.accumulator;
  if (!acc) return [];
  const out: CrankOp[] = [];
  const route = `/tokens/${acc.id}`;

  if (acc.rolloverReserve > 0) {
    const unwrapped = unwrappedSupply(a);
    const eligible = unwrapped > 0;
    out.push({
      crank: "sweep_rollover",
      label: "Sweep rollover",
      entry: "accumulator::sweep_rollover",
      description:
        "Push revenue parked while supply was fully wrapped back through the index to today's unwrapped holders.",
      targetId: acc.id,
      targetLabel: acc.tokenSymbol,
      route,
      eligible,
      reason: eligible
        ? "Rollover reserve is funded and there are unwrapped holders to distribute to."
        : "No unwrapped supply to distribute to — rescued automatically on the next unwrap.",
    });
  }

  if ((acc.compensationPool ?? 0) > 0 && acc.compensationUnlockMs != null) {
    const elapsed = NOW >= acc.compensationUnlockMs;
    out.push({
      crank: "sweep_compensation",
      label: "Sweep compensation",
      entry: "accumulator::sweep_compensation",
      description:
        "Grace window elapsed — distribute the seized/slashed restitution pool across unwrapped holders and unfreeze wrapping.",
      targetId: acc.id,
      targetLabel: acc.tokenSymbol,
      route,
      eligible: elapsed,
      availableAtMs: acc.compensationUnlockMs,
      reason: elapsed
        ? "Compensation grace window has elapsed — anyone can sweep the pool into the index."
        : "Grace window is still open — wrapped holders may still unwrap to stay eligible.",
    });
  }

  return out;
}

/** Dispute-scoped crank: resolve_dispute once the voting window has elapsed. */
export function cranksForDispute(d: Dispute): CrankOp[] {
  if (d.status !== "OPEN") return [];
  const elapsed = NOW >= d.votingDeadlineMs;
  return [
    {
      crank: "resolve_dispute",
      label: "Resolve dispute",
      entry: "dispute::resolve_dispute",
      description:
        "Voting window closed — tally the jury, slash or exonerate the validator, and route restitution or refund the bond.",
      targetId: d.id,
      targetLabel: `Dispute vs ${d.targetValidatorName}`,
      route: `/disputes/${d.id}`,
      eligible: elapsed,
      availableAtMs: d.votingDeadlineMs,
      reason: elapsed
        ? "Voting window has closed — anyone can resolve the dispute."
        : "Voting is still open.",
    },
  ];
}

/* --------------------------------------------------------------- aggregate */

/** Every crank opportunity across the protocol, eligible-first (the keeper view). */
export function allCranks(): CrankOp[] {
  const out: CrankOp[] = [];
  for (const a of assets) {
    out.push(...cranksForAsset(a));
    out.push(...cranksForAccumulator(a));
  }
  for (const d of disputes) out.push(...cranksForDispute(d));
  return out.sort((x, y) => {
    if (x.eligible !== y.eligible) return x.eligible ? -1 : 1;
    return (x.availableAtMs ?? Infinity) - (y.availableAtMs ?? Infinity);
  });
}
