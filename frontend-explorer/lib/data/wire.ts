// FE-M8a — Indexer wire types + numeric/enum decoders.
//
// THE ONLY place that knows the BI-M8 JSON wire format (`logic_flow.md §6/§10.2`).
// Everything downstream consumes `lib/types.ts`. Amounts arrive as **strings**
// (u64/u128, to dodge JS number precision loss); timestamps as ms numbers.
//
// Source of truth: the running indexer's responses + `logic_flow.md §6`. Decoded
// here so `map.ts` deals only in `lib/types.ts` shapes.

import type { AssetState, Category } from "@/lib/types";

/* ---------------------------------------------------------------- primitives */

/** Scale factor for the u128 yield index (protocol_flow.md §15, SCALE = 1e9). */
export const INDEX_SCALE = 1_000_000_000;
/** μUSDC per 1 USDC / shares per "1 share" (6-decimal coin). */
export const MICRO = 1_000_000;

/** Parse a μ-amount string ("100000000000") → human number (100000). Null/"" → 0. */
export function usdc(s: string | null | undefined): number {
  if (s == null || s === "") return 0;
  // BigInt-safe for the integer part, then scale; values are well within f64 once divided.
  const neg = s.startsWith("-");
  const digits = neg ? s.slice(1) : s;
  if (!/^\d+$/.test(digits)) return 0;
  const n = Number(BigInt(digits)) / MICRO;
  return neg ? -n : n;
}

/** Parse a plain integer-ish string → number (counts that are NOT μ-scaled). */
export function intOf(s: string | number | null | undefined): number {
  if (s == null || s === "") return 0;
  const n = typeof s === "number" ? s : Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Unscale the raw u128 yield index → a human "USDC of lifetime yield per share".
 * raw = Σ(investor_portion_scaled / unwrapped_supply); divide out SCALE and the
 * μUSDC factor. Display-only; the backend serves `apy` separately.
 */
export function indexHuman(s: string | null | undefined): number {
  if (s == null || s === "") return 0;
  if (!/^\d+$/.test(s)) return 0;
  return Number(BigInt(s)) / INDEX_SCALE / MICRO;
}

/* --------------------------------------------------------------------- enums */

// asset.move state bytes (authoritative): there is NO byte for FUNDED/DEFAULTED —
// those are Tier-5 frontend-derived labels (see map.ts `deriveState`).
const STATE_BY_BYTE: Record<number, AssetState> = {
  0: "PENDING_VOUCH",
  1: "FUNDING",
  2: "FAILED",
  3: "CANCELLED",
  4: "EXECUTING",
  5: "OPERATIONAL",
  6: "COMPENSATING",
  7: "CLOSED",
};

export function stateOfByte(b: number | null | undefined): AssetState {
  return STATE_BY_BYTE[b ?? 0] ?? "PENDING_VOUCH";
}

// LI-D4 category enum (catalog.rs:26): 0 Housing · 1 Machinery · 2 Trade Finance ·
// 3 Agriculture · 4 Energy · 5 Infrastructure — same order as `lib/types.ts Category`.
const CATEGORY_BY_INT: Category[] = [
  "Housing",
  "Machinery",
  "Trade Finance",
  "Agriculture",
  "Energy",
  "Infrastructure",
];

export function categoryOfInt(i: number | null | undefined): Category {
  return CATEGORY_BY_INT[i ?? 0] ?? "Housing";
}

// validator.move status bytes.
export function validatorStatusOfByte(b: number | null | undefined): "ACTIVE" | "FROZEN" | "SLASHED" {
  return b === 2 ? "SLASHED" : b === 1 ? "FROZEN" : "ACTIVE";
}

/* ----------------------------------------------------------------- wire types */

export interface Envelope<T> {
  data: T[];
  nextCursor: string | null;
  hasNextPage: boolean;
}

export interface WireAccumulator {
  reward_pool: string | null;
  rollover_reserve: string | null;
  compensation_pool: string | null;
  compensation_unlock_ms: number | null;
  wrapping_frozen: boolean | null;
}

export interface WireAsset {
  asset_id: string;
  entity: string;
  goal: string;
  funding_deadline_ms: number;
  tranche_count: number;
  revenue_split_bps: number;
  collateral: string;
  validator_pool_id: string | null;
  coverage: string | null;
  accumulator_id: string | null;
  current_state: number;
  close_reason: number | null;
  created_at_ms: number;
  // BI-M8 metadata
  name: string | null;
  ticker: string | null;
  category: number | null;
  location: string | null;
  entity_name: string | null;
  metadata_blob_id: string | null;
  metadata_sha256: string | null;
  is_term_financing: boolean | null;
  return_target: string | null;
  // detail-only computed members (LI-D11)
  apy?: number;
  accumulator?: WireAccumulator;
}

export interface WireTrancheSchedule {
  tranche_index: number;
  amount: string;
  deadline_ms: number;
  description: string;
}

export interface WireTrancheEvent {
  event_type: string; // proof_submitted | approved | released
  tranche_index: number;
  timestamp_ms: number;
  approver?: string | null;
  proof_blob_id?: string | null;
  proof_sha256?: string | null;
  tx_digest?: string;
}

export interface WireTranchesEnvelope extends Envelope<WireTrancheEvent> {
  schedule: WireTrancheSchedule[];
}

export interface WireRaisePoint {
  timestamp_ms: number;
  contributor: string;
  amount: string;
  raised_after: string;
  tx_digest: string;
}

export interface WireYieldPoint {
  timestamp_ms: number;
  event_type: string;
  gross: string | null;
  fee: string | null;
  investor_portion: string | null;
  entity_portion: string | null;
  index_after: string | null;
  unwrapped_supply: string | null;
  tx_digest: string;
}

export interface WireWrapPoint {
  timestamp_ms: number;
  total_wrapped_after: string;
  total_minted_after?: string | null;
  tx_digest: string;
}

export interface WireHolder {
  address: string;
  share_count: string;
  wrapped: string;
  pct_of_supply: string;
  acquired_at_ms: number;
  yield_claimed_index: string;
}

export interface WireHoldersEnvelope extends Envelope<WireHolder> {
  attribution: string;
  total_minted_shares: string;
}

export interface WireValidator {
  pool_id: string;
  validator: string;
  initial_stake: string;
  current_status: number;
  registered_at_ms: number;
  name: string | null;
}

export interface WireValidatorDetail extends WireValidator {
  reputation: number;
  stake_events: Array<{ kind?: string; amount?: string; timestamp_ms: number }>;
  status_changes: Array<{ new_status: number; old_status: number; timestamp_ms: number; dispute_id?: string }>;
  track_record: {
    assets_vouched?: number;
    assets_defaulted?: number;
    milestones_approved?: number;
    disputes_against?: number;
    disputes_upheld?: number;
    coverage_locked?: string;
    active_vouches?: number;
  };
}

export interface WireDispute {
  dispute_id: string;
  asset_id: string;
  target_pool_id: string;
  challenger: string;
  bond: string;
  evidence_hash: string | null;
  reason: string | null;
  opened_at_ms: number;
  verdict: number | null; // null OPEN; 1 upheld/guilty; 0 rejected/innocent (see map)
  votes_guilty: number;
  votes_innocent: number;
  slashed: string | null;
  bounty: string | null;
  quorum?: number | null;
  voting_deadline_ms?: number | null;
  asset_name?: string | null;
  target_validator_name?: string | null;
}

export interface WirePortfolioEvent {
  timestamp_ms: number;
  event_type: string;
  asset_id: string;
  actor: string;
  amount: string | null;
  share_object_id?: string | null;
  tx_digest: string;
}

export interface WireGovEvent {
  timestamp_ms: number;
  event_type: string;
  tx_digest: string;
  config_id: string | null;
  admin: string | null;
  param_name: string | null;
  old_value: string | null;
  new_value: string | null;
  old_treasury: string | null;
  new_treasury: string | null;
}

export interface WireTxEvent {
  event_seq: number;
  event_type: string;
  payload: Record<string, unknown>;
}

export interface WireTx {
  tx_digest: string;
  timestamp_ms: number;
  checkpoint_seq: number;
  events: WireTxEvent[];
}

export interface WireAddress {
  address: string;
  roles: string[];
  holdings: Array<{
    asset_id: string;
    share_count: string;
    wrapped: string;
    yield_claimed_index: string;
  }>;
  attribution: string;
}

export interface WireHealth {
  cursor: number;
  lag_checkpoints: number;
  latest_chain_checkpoint: number;
  status: string;
}

export interface WireLegalDoc {
  blob_id: string;
  sha256: string;
  attested_by: string;
}
