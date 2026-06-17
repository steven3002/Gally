//! Rust structs mapping to DB rows (`sqlx::FromRow`) and their JSON serialization for the API.
//!
//! Column ⇄ field types follow `logic_flow.md §2.0`: `BIGINT`→`i64`, `INT`→`i32`,
//! `SMALLINT`→`i16`, `TEXT`→`String`, nullable→`Option`. Per §9.1 every `u64`/`u128` amount is
//! serialized **as a string** in API responses (JSON numbers lose precision in some JS
//! runtimes); the `string_amount` / `opt_string_amount` helpers do that on the way out.

use serde::{Serialize, Serializer};
use sqlx::FromRow;

/// Serialize an `i64` amount as a JSON string (`logic_flow.md §9.1`).
fn string_amount<S: Serializer>(v: &i64, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&v.to_string())
}

/// Serialize an `Option<i64>` amount as a JSON string or `null`.
fn opt_string_amount<S: Serializer>(v: &Option<i64>, s: S) -> Result<S::Ok, S::Error> {
    match v {
        Some(n) => s.serialize_str(&n.to_string()),
        None => s.serialize_none(),
    }
}

/// One `assets` row (`logic_flow.md §2.4`); serialized as the §6.1 asset-list item.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct AssetRow {
    pub asset_id: String,
    pub entity: String,
    #[serde(serialize_with = "string_amount")]
    pub goal: i64,
    pub funding_deadline_ms: i64,
    pub tranche_count: i32,
    pub revenue_split_bps: i32,
    #[serde(serialize_with = "string_amount")]
    pub collateral: i64,
    pub validator_pool_id: Option<String>,
    #[serde(serialize_with = "opt_string_amount")]
    pub coverage: Option<i64>,
    pub accumulator_id: Option<String>,
    pub current_state: i16,
    pub close_reason: Option<i16>,
    pub created_at_ms: i64,
    // Not part of the §6.1 item shape, but useful for /tx cross-refs and stable cursors.
    #[serde(skip_serializing)]
    pub created_tx: String,
}

/// One `asset_state_changes` row (`logic_flow.md §2.5`); the `/assets/:id/history` item.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct AssetStateChangeRow {
    #[serde(skip_serializing)]
    pub id: i64,
    pub timestamp_ms: i64,
    pub old_state: i16,
    pub new_state: i16,
    pub tx_digest: String,
}

/// One `governance_events` row (`logic_flow.md §2.3`); the `/governance` item. Only the columns
/// relevant to the row's `event_type` are populated — the rest serialize as `null`.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct GovernanceRow {
    #[serde(skip_serializing)]
    pub id: i64,
    pub timestamp_ms: i64,
    pub event_type: String,
    pub tx_digest: String,
    pub config_id: Option<String>,
    pub admin: Option<String>,
    pub param_name: Option<String>,
    #[serde(serialize_with = "opt_string_amount")]
    pub old_value: Option<i64>,
    #[serde(serialize_with = "opt_string_amount")]
    pub new_value: Option<i64>,
    pub old_treasury: Option<String>,
    pub new_treasury: Option<String>,
}

// ===========================================================================
// BI-M3 — validator registry + position ledger
// ===========================================================================

/// One `validator_pools` row (`§2.7`); the `/validators` list item.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ValidatorPoolRow {
    pub pool_id: String,
    pub validator: String,
    #[serde(serialize_with = "string_amount")]
    pub initial_stake: i64,
    pub current_status: i16,
    pub registered_at_ms: i64,
}

/// One `validator_stake_events` row (`§2.8`); embedded in `/validators/:pool_id`.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct StakeEventRow {
    #[serde(skip_serializing)]
    pub id: i64,
    pub timestamp_ms: i64,
    pub event_type: String, // 'added' | 'withdrawn'
    pub depositor: Option<String>,
    #[serde(serialize_with = "string_amount")]
    pub amount: i64,
    #[serde(serialize_with = "string_amount")]
    pub stake_after: i64,
    pub tx_digest: String,
}

/// One `validator_status_changes` row (`§2.9`); embedded in `/validators/:pool_id`.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct StatusChangeRow {
    #[serde(skip_serializing)]
    pub id: i64,
    pub timestamp_ms: i64,
    pub old_status: i16,
    pub new_status: i16,
    pub dispute_id: Option<String>,
    pub tx_digest: String,
}

/// One `raise_progress` row (`§2.6`); the `/assets/:id/raise-progress` item (shape `§6.2`).
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct RaiseProgressRow {
    #[serde(skip_serializing)]
    pub id: i64,
    pub timestamp_ms: i64,
    pub contributor: String,
    #[serde(serialize_with = "string_amount")]
    pub amount: i64,
    #[serde(serialize_with = "string_amount")]
    pub raised_after: i64,
    pub tx_digest: String,
}

/// One `position_events` row (`§2.10`); the `/portfolio/:address` item (shape `§6.4`).
/// `index_at_claim` is read via `::text` (NUMERIC → string), preserving full u128 precision.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PositionEventRow {
    #[serde(skip_serializing)]
    pub id: i64,
    pub timestamp_ms: i64,
    pub event_type: String,
    pub asset_id: String,
    pub actor: String,
    #[serde(serialize_with = "opt_string_amount")]
    pub amount: Option<i64>,
    pub share_object_id: Option<String>,
    #[serde(serialize_with = "opt_string_amount")]
    pub total_wrapped_after: Option<i64>,
    pub index_at_claim: Option<String>,
    pub tx_digest: String,
}

/// The aggregated per-actor holder fold (`§2.17`) for one asset — **not a table**, computed by a
/// GROUP BY over `position_events`. `holding` (= `share_count + wrapped`) is the ranking key and
/// the keyset cursor magnitude; the route adds the `pct_of_supply` from `assets.goal`.
#[derive(Debug, Clone, FromRow)]
pub struct HolderFoldRow {
    pub address: String,
    pub share_count: i64,
    pub wrapped: i64,
    pub holding: i64,
    pub acquired_at_ms: Option<i64>,
    pub yield_claimed_index: Option<String>,
}

// ===========================================================================
// BI-M4 — yield index / tranche / dispute feeds
// ===========================================================================

/// One `yield_index_series` row (`§2.11`); the `/assets/:id/yield` item (shape `§6.3`). The
/// revenue-only split columns are `null` on rollover/compensation rows; `routed_to_rollover` is set
/// only on compensation. `index_after` (u128) is read via `::text` for exact precision.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct YieldIndexRow {
    #[serde(skip_serializing)]
    pub id: i64,
    pub timestamp_ms: i64,
    pub event_type: String, // 'revenue' | 'rollover' | 'compensation'
    #[serde(serialize_with = "opt_string_amount")]
    pub gross: Option<i64>,
    #[serde(serialize_with = "opt_string_amount")]
    pub fee: Option<i64>,
    #[serde(serialize_with = "opt_string_amount")]
    pub investor_portion: Option<i64>,
    #[serde(serialize_with = "opt_string_amount")]
    pub entity_portion: Option<i64>,
    pub routed_to_rollover: Option<bool>,
    pub index_after: String,
    #[serde(serialize_with = "string_amount")]
    pub unwrapped_supply: i64,
    pub tx_digest: String,
}

/// The `/assets/:id/wrap-ratio` item — the `total_wrapped_after` series drawn from wrap/unwrap
/// `position_events` rows (`§2.10`; the data lives nowhere else). Ascending by `(timestamp_ms, id)`.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct WrapRatioRow {
    #[serde(skip_serializing)]
    pub id: i64,
    pub timestamp_ms: i64,
    pub event_type: String, // 'SharesWrapped' | 'SharesUnwrapped'
    #[serde(serialize_with = "opt_string_amount")]
    pub total_wrapped_after: Option<i64>,
    pub tx_digest: String,
}

/// One `tranche_events` row (`§2.12`); the `/assets/:id/tranches` item. Only the columns the
/// subtype carries are populated (`blob_id`/`sha256` for proof_submitted; `validator`/`pool_id`
/// for approved; `amount`/`escrow_after` for released).
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct TrancheRow {
    #[serde(skip_serializing)]
    pub id: i64,
    pub timestamp_ms: i64,
    pub event_type: String, // 'proof_submitted' | 'approved' | 'released'
    pub tranche_index: i32,
    pub blob_id: Option<String>,
    pub sha256: Option<String>,
    pub validator: Option<String>,
    pub pool_id: Option<String>,
    #[serde(serialize_with = "opt_string_amount")]
    pub amount: Option<i64>,
    #[serde(serialize_with = "opt_string_amount")]
    pub escrow_after: Option<i64>,
    pub tx_digest: String,
}

/// One `disputes` row joined with its running vote tallies (`§2.13`/`§2.14`); the dispute item
/// (shape `§6.5`). `verdict` is `null` while open; `votes_guilty`/`votes_innocent` are the latest
/// tallies (`MAX(votes_*_after)`).
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct DisputeRow {
    pub dispute_id: String,
    pub asset_id: String,
    pub target_pool_id: String,
    pub challenger: String,
    #[serde(serialize_with = "string_amount")]
    pub bond: i64,
    pub evidence_hash: String,
    pub opened_at_ms: i64,
    pub resolved_at_ms: Option<i64>,
    pub verdict: Option<i16>,
    #[serde(serialize_with = "opt_string_amount")]
    pub slashed: Option<i64>,
    #[serde(serialize_with = "opt_string_amount")]
    pub bounty: Option<i64>,
    pub votes_guilty: i32,
    pub votes_innocent: i32,
}

/// One `jury_votes` row (`§2.14`); embedded in `GET /disputes/:id`.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct JuryVoteRow {
    #[serde(skip_serializing)]
    pub id: i64,
    pub timestamp_ms: i64,
    pub juror_pool_id: String,
    pub guilty: bool,
    pub votes_guilty_after: i32,
    pub votes_innocent_after: i32,
    pub tx_digest: String,
}
