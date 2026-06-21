// Typed transaction INTENTS (FE-M7.2, spec §2.2 / §6.1).
//
// One variant per *user-callable* Move entry function (investor / holder /
// challenger role only — entity/validator/admin verbs are out of scope, D-FE2).
// Components build these; the executor turns them into a (mock now / PTB later)
// transaction. Every `kind` traces to a `gally_core/sources/*.move` entry.

import type { Tone } from "@/lib/format";
import { usd } from "@/lib/format";

export type CrankKind =
  | "resolve_dispute"
  | "flag_default"
  | "abort_failed_raise"
  | "sweep_rollover"
  | "sweep_compensation";

export type TxIntent =
  | { kind: "contribute"; assetId: string; assetName: string; amount: number } // asset::contribute_capital
  | { kind: "claim_shares"; assetId: string; assetName: string; amount: number } // asset::claim_shares<T>
  | { kind: "refund"; assetId: string; assetName: string; amount: number } // asset::refund_contribution
  | { kind: "claim_rewards"; assetId: string; assetName: string; amount: number } // accumulator::claim_rewards<T>
  | { kind: "wrap"; assetId: string; assetName: string; amount: number; tokenSymbol?: string } // accumulator::wrap_shares<T>
  | { kind: "unwrap"; assetId: string; assetName: string; amount: number; tokenSymbol?: string } // accumulator::unwrap_coins<T>
  | { kind: "split"; assetId: string; assetName: string; amount: number } // share::split_share
  // evidenceBlobId/evidenceSha256 are the real Walrus ref of an attached evidence file
  // (uploaded + hashed in-browser); both omitted ⇒ a reason-only dispute (empty ref).
  | {
      kind: "raise_dispute";
      poolId: string;
      validatorName: string;
      assetId: string;
      bond: number;
      reason?: string;
      evidenceBlobId?: string;
      evidenceSha256?: string;
    } // dispute::initialize_dispute<T>
  | { kind: "crank"; crank: CrankKind; targetId: string; label: string; route?: string }; // permissionless cranks

export type IntentKind = TxIntent["kind"];

/** The Move entry each intent maps to — shown in the confirm modal for transparency. */
export const INTENT_ENTRY: Record<IntentKind, string> = {
  contribute: "asset::contribute_capital",
  claim_shares: "asset::claim_shares",
  refund: "asset::refund_contribution",
  claim_rewards: "accumulator::claim_rewards",
  wrap: "accumulator::wrap_shares",
  unwrap: "accumulator::unwrap_coins",
  split: "share::split_share",
  raise_dispute: "dispute::initialize_dispute",
  crank: "permissionless crank",
};

/** Short verb label for buttons/toasts. */
export function intentVerb(intent: TxIntent): string {
  switch (intent.kind) {
    case "contribute":
      return "Buy Shares";
    case "claim_shares":
      return "Claim deeds";
    case "refund":
      return "Sell Shares";
    case "claim_rewards":
      return "Claim yield";
    case "wrap":
      return "Wrap";
    case "unwrap":
      return "Unwrap";
    case "split":
      return "Split deed";
    case "raise_dispute":
      return "Raise dispute";
    case "crank":
      return intent.label;
  }
}

/** One-line human summary of what the intent will do. */
export function intentSummary(intent: TxIntent): string {
  switch (intent.kind) {
    case "contribute":
      return `Invest ${usd(intent.amount)} USDC in ${intent.assetName}. You receive a soulbound receipt redeemable for GallyShare deeds once the raise closes.`;
    case "claim_shares":
      return `Convert your receipt for ${intent.assetName} into ${intent.amount.toLocaleString()} GallyShare deeds.`;
    case "refund":
      return `Recover your ${usd(intent.amount)} investment in ${intent.assetName} — the raise did not meet its goal.`;
    case "claim_rewards":
      return `Claim ${usd(intent.amount)} of accrued yield from your ${intent.assetName} deeds.`;
    case "wrap":
      return `Wrap ${intent.amount.toLocaleString()} ${intent.assetName} deeds into ${intent.tokenSymbol ?? "Coin<T>"}. Wrapped tokens earn no yield until unwrapped.`;
    case "unwrap":
      return `Unwrap ${intent.amount.toLocaleString()} ${intent.tokenSymbol ?? "Coin<T>"} back into yield-bearing GallyShare deeds.`;
    case "split":
      return `Split off ${intent.amount.toLocaleString()} deeds from your ${intent.assetName} GallyShare into a new object.`;
    case "raise_dispute":
      return `Challenge ${intent.validatorName}'s attestation by posting a ${usd(intent.bond)} bond. Refunded with a bounty if upheld; forfeited if rejected.`;
    case "crank":
      return `Run the permissionless ${intent.label.toLowerCase()} crank. Anyone may call this once its precondition is met.`;
  }
}

/** The entity route this intent concerns (for deep-linking notifications). */
export function intentRoute(intent: TxIntent): string | undefined {
  switch (intent.kind) {
    case "raise_dispute":
      return `/validators/${intent.poolId}`;
    case "crank":
      return intent.route;
    default:
      return `/assets/${intent.assetId}`;
  }
}

/**
 * Stable key identifying *which action on which subject* an intent performs.
 * The optimistic-reconciliation store (`lib/tx/optimistic.ts`) records these on
 * success so the same action reads as "submitted" across every page that renders
 * it (and so the matching seeded alert is dismissed). One key per (verb, subject).
 */
export function optimisticKey(intent: TxIntent): string {
  switch (intent.kind) {
    case "contribute":
      return `contribute:${intent.assetId}`;
    case "claim_rewards":
      return `claim:${intent.assetId}`;
    case "claim_shares":
      return `claim_shares:${intent.assetId}`;
    case "refund":
      return `refund:${intent.assetId}`;
    case "wrap":
      return `wrap:${intent.assetId}`;
    case "unwrap":
      return `unwrap:${intent.assetId}`;
    case "split":
      return `split:${intent.assetId}`;
    case "raise_dispute":
      return `dispute:${intent.poolId}`;
    case "crank":
      return `crank:${intent.crank}:${intent.targetId}`;
  }
}

/** Toast tone on success. Exit/positive actions are positive; cranks neutral. */
export function intentTone(intent: TxIntent): Tone {
  switch (intent.kind) {
    case "claim_rewards":
    case "claim_shares":
    case "contribute":
      return "positive";
    case "refund":
    case "unwrap":
      return "warning";
    case "raise_dispute":
      return "danger";
    default:
      return "primary";
  }
}

/**
 * Pure validation of an intent against its (caller-supplied) preconditions.
 * Returns `null` when valid, else a human reason. Unit-tested; the executor
 * runs it first so the error path is real (matches the contract's aborts).
 */
export function validateIntent(intent: TxIntent): string | null {
  switch (intent.kind) {
    case "contribute":
      if (intent.amount <= 0) return "Enter an investment amount.";
      return null;
    case "claim_rewards":
      if (intent.amount <= 0) return "No yield is currently claimable.";
      return null;
    case "claim_shares":
      if (intent.amount <= 0) return "No receipt to convert.";
      return null;
    case "refund":
      if (intent.amount <= 0) return "Nothing to refund.";
      return null;
    case "wrap":
    case "unwrap":
    case "split":
      if (intent.amount <= 0) return "Enter an amount.";
      return null;
    case "raise_dispute":
      if (intent.bond <= 0) return "Challenger bond is unset.";
      return null;
    case "crank":
      return null;
  }
}
