//! Rust deserialization structs for every Move event.
//!
//! **Authoritative field list:** `logic_flow.md §10.3` (derived from the shipped `gally_core`
//! source — NOT `protocol_flow.md §18.3`, which has drifted; see §10.1). **Wire-type rules:**
//! `logic_flow.md §10.2` — Sui `parsedJson` renders `u64`/`u128`/`u256` as JSON **strings**,
//! `vector<u8>` as a JSON **array of byte ints**, and `Option<ID>` as `null`-or-string. The
//! single most common indexer bug is forgetting that numerics arrive as strings, so every
//! numeric field below uses the string-aware [`de_u64`] deserializer.
//!
//! BI-M2 covers the **governance** + **asset-lifecycle** feeds. BI-M3/BI-M4 add validator,
//! position, yield, tranche, and dispute structs.

use serde::de::{self, Deserializer};
use serde::Deserialize;

/// Deserialize a Sui `u64` that `parsedJson` renders as a JSON **string** (`§10.2`). Also
/// accepts a JSON number so hand-written test fixtures stay readable.
pub fn de_u64<'de, D>(d: D) -> Result<u64, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StrOrNum {
        Str(String),
        Num(u64),
    }
    match StrOrNum::deserialize(d)? {
        StrOrNum::Str(s) => s.parse().map_err(de::Error::custom),
        StrOrNum::Num(n) => Ok(n),
    }
}

/// Deserialize a Sui `u128` that `parsedJson` renders as a JSON **string** (`§10.2`). Stored in a
/// `NUMERIC(39,0)` column (u128 exceeds `BIGINT`); the handler binds `to_string()` and casts to
/// `::numeric`, and reads come back via `::text`. Also accepts a JSON number for test fixtures.
pub fn de_u128<'de, D>(d: D) -> Result<u128, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StrOrNum {
        Str(String),
        Num(u128),
    }
    match StrOrNum::deserialize(d)? {
        StrOrNum::Str(s) => s.parse().map_err(de::Error::custom),
        StrOrNum::Num(n) => Ok(n),
    }
}

/// Deserialize a `vector<u64>` (BI-M8): a JSON array whose elements `parsedJson` renders as
/// **strings** (the §10.2 wire rule applies per element). Used for the `AssetCreatedEvent` tranche
/// schedule's `tranche_amounts` / `tranche_deadlines_ms` (LI-D8). Also accepts JSON numbers so
/// hand-written fixtures stay readable.
pub fn de_vec_u64<'de, D>(d: D) -> Result<Vec<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StrOrNum {
        Str(String),
        Num(u64),
    }
    Vec::<StrOrNum>::deserialize(d)?
        .into_iter()
        .map(|v| match v {
            StrOrNum::Str(s) => s.parse().map_err(de::Error::custom),
            StrOrNum::Num(n) => Ok(n),
        })
        .collect()
}

/// Decode an on-chain `vector<u8>` text field (BI-M8) to a `String`. The protocol stores human
/// metadata (`name`, `ticker`, `location`, `entity_name`, dispute `reason`, validator `name`,
/// tranche descriptions) as UTF-8 bytes (LI-Q2); we decode lossily for storage. Empty ⇒ `None` so
/// pre-M8 fixtures (which omit the field) and genuinely-blank fields store SQL `NULL`, not `""`.
pub fn utf8_opt(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        None
    } else {
        Some(String::from_utf8_lossy(bytes).into_owned())
    }
}

// ---------------------------------------------------------------------------
// Governance feed (`protocol` module — `§10.3`)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct ProtocolInitializedEvent {
    pub config_id: String,
    pub admin: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProtocolParamChangedEvent {
    pub name: String,
    #[serde(deserialize_with = "de_u64")]
    pub old_value: u64,
    #[serde(deserialize_with = "de_u64")]
    pub new_value: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProtocolTreasuryChangedEvent {
    pub old_treasury: String,
    pub new_treasury: String,
}

/// Carries `config_id` (not empty) — a §10.1 catalog/code drift.
#[derive(Debug, Clone, Deserialize)]
pub struct EmergencyStopTriggeredEvent {
    pub config_id: String,
}

/// Carries `config_id` (not empty) — a §10.1 catalog/code drift.
#[derive(Debug, Clone, Deserialize)]
pub struct ProtocolResumedEvent {
    pub config_id: String,
}

// ---------------------------------------------------------------------------
// Asset-lifecycle feed (`asset` module — `§10.3`)
// ---------------------------------------------------------------------------

/// Field is `funding_goal` (not `goal`) — stored in `assets.goal` (§10.1).
///
/// BI-M8 adds the on-chain metadata block (LI-D3/D5/D12), the term-status fields (LI-D12), and the
/// full tranche schedule (LI-D8). Every M8 field is `#[serde(default)]` so the BI-M7 fixtures (and
/// any pre-M8 archived payload) still deserialize — a missing field is the dual of R7's "extra
/// fields must not crash". Text fields are `vector<u8>` (LI-Q2 — decode via [`utf8_opt`]); blob/sha
/// are `vector<u8>` (hex-encode via [`Self::metadata_blob_id_hex`]); the tranche schedule arrives as
/// three parallel vectors (LI-Q1).
#[derive(Debug, Clone, Deserialize)]
pub struct AssetCreatedEvent {
    pub asset_id: String,
    pub entity: String,
    #[serde(deserialize_with = "de_u64")]
    pub funding_goal: u64,
    #[serde(deserialize_with = "de_u64")]
    pub funding_deadline_ms: u64,
    #[serde(deserialize_with = "de_u64")]
    pub tranche_count: u64,
    #[serde(deserialize_with = "de_u64")]
    pub revenue_split_bps: u64,
    #[serde(deserialize_with = "de_u64")]
    pub collateral: u64,
    // --- BI-M8 metadata (LI-D3) ---
    #[serde(default)]
    pub name: Vec<u8>,
    #[serde(default)]
    pub ticker: Vec<u8>,
    #[serde(default)]
    pub category: u8,
    #[serde(default)]
    pub location: Vec<u8>,
    #[serde(default)]
    pub entity_name: Vec<u8>,
    #[serde(default)]
    pub metadata_blob_id: Vec<u8>,
    #[serde(default)]
    pub metadata_sha256: Vec<u8>,
    // --- BI-M8 term status (LI-D12) ---
    #[serde(default)]
    pub is_term_financing: bool,
    #[serde(default, deserialize_with = "de_u64")]
    pub return_target: u64,
    // --- BI-M8 tranche schedule (LI-D8 / LI-Q1) — three parallel vectors ---
    #[serde(default, deserialize_with = "de_vec_u64")]
    pub tranche_amounts: Vec<u64>,
    #[serde(default, deserialize_with = "de_vec_u64")]
    pub tranche_deadlines_ms: Vec<u64>,
    #[serde(default)]
    pub tranche_descriptions: Vec<Vec<u8>>,
}

impl AssetCreatedEvent {
    pub fn name_str(&self) -> Option<String> {
        utf8_opt(&self.name)
    }
    pub fn ticker_str(&self) -> Option<String> {
        utf8_opt(&self.ticker)
    }
    pub fn location_str(&self) -> Option<String> {
        utf8_opt(&self.location)
    }
    pub fn entity_name_str(&self) -> Option<String> {
        utf8_opt(&self.entity_name)
    }
    /// `None` when no blob is attached (empty id), else the hex-encoded WalrusRef id (§10.2).
    pub fn metadata_blob_id_hex(&self) -> Option<String> {
        if self.metadata_blob_id.is_empty() {
            None
        } else {
            Some(hex_encode(&self.metadata_blob_id))
        }
    }
    pub fn metadata_sha256_hex(&self) -> Option<String> {
        if self.metadata_sha256.is_empty() {
            None
        } else {
            Some(hex_encode(&self.metadata_sha256))
        }
    }
    /// `is_term_financing ? Some(return_target) : None` — open-ended raises store NULL (LI-D12).
    pub fn return_target_opt(&self) -> Option<i64> {
        if self.is_term_financing {
            Some(self.return_target as i64)
        } else {
            None
        }
    }
    /// The declared schedule as `(tranche_index, amount, deadline_ms, description)` tuples (LI-D8).
    /// Indexed by position in the parallel vectors; `deadline_ms`/`description` fall back to `0`/`None`
    /// if a vector is shorter (defensive — the Move code emits them in lockstep).
    pub fn tranche_schedule(&self) -> Vec<(i32, i64, i64, Option<String>)> {
        self.tranche_amounts
            .iter()
            .enumerate()
            .map(|(i, &amount)| {
                let deadline = self.tranche_deadlines_ms.get(i).copied().unwrap_or(0);
                let desc = self.tranche_descriptions.get(i).and_then(|b| utf8_opt(b));
                (i as i32, amount as i64, deadline as i64, desc)
            })
            .collect()
    }
}

/// `doc_hashes` is a `vector<vector<u8>>` (array of byte-arrays). It is **not** stored in the
/// `assets` row — the legal-doc list is an object-proxy / dynamic-field read (guard rail R8).
/// It is kept here so the full payload deserializes; [`Self::doc_hashes_hex`] hex-encodes each
/// per the §10.2 rule should a caller need it.
#[derive(Debug, Clone, Deserialize)]
pub struct AssetVouchedEvent {
    pub asset_id: String,
    pub pool_id: String,
    pub validator: String,
    #[serde(deserialize_with = "de_u64")]
    pub coverage: u64,
    #[serde(default)]
    pub doc_hashes: Vec<Vec<u8>>,
}

impl AssetVouchedEvent {
    /// Hex-encode each doc hash (`vector<u8>` → hex, §10.2).
    pub fn doc_hashes_hex(&self) -> Vec<String> {
        self.doc_hashes.iter().map(|b| hex_encode(b)).collect()
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct AssetStateChangedEvent {
    pub asset_id: String,
    pub old_state: u8,
    pub new_state: u8,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AssetOperationalEvent {
    pub asset_id: String,
    pub accumulator_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RaiseFinalizedEvent {
    pub asset_id: String,
    pub accumulator_id: String,
    #[serde(deserialize_with = "de_u64")]
    pub total_shares: u64,
}

/// `reason` is a `u8` (1/2/3, §11.4) — not a string (§10.1).
#[derive(Debug, Clone, Deserialize)]
pub struct AssetClosedEvent {
    pub asset_id: String,
    pub reason: u8,
}

/// No dedicated handler — the CANCELLED=3 state arrives via `AssetStateChangedEvent`; this is
/// archived in `raw_events` only (`logic_flow.md §4`). Defined for completeness / future use.
#[derive(Debug, Clone, Deserialize)]
pub struct AssetCancelledEvent {
    pub asset_id: String,
}

/// Routed to `raw_events` only in BI-M2 (no dedicated handler until a later milestone).
#[derive(Debug, Clone, Deserialize)]
pub struct RaiseAbortedEvent {
    pub asset_id: String,
    #[serde(deserialize_with = "de_u64")]
    pub raised: u64,
}

/// BI-M8 folds its `*_after` compensation snapshot (LI-D9) into `accumulator_balances`: the default
/// seeds the pool, opens the grace window, and freezes wrapping (D5). `tranche_missed`/`*_seized`
/// remain un-stored (no typed column — archived in `raw_events`).
#[derive(Debug, Clone, Deserialize)]
pub struct EntityDefaultedEvent {
    pub asset_id: String,
    #[serde(deserialize_with = "de_u64")]
    pub tranche_missed: u64,
    #[serde(deserialize_with = "de_u64")]
    pub collateral_seized: u64,
    #[serde(deserialize_with = "de_u64")]
    pub escrow_seized: u64,
    #[serde(default, deserialize_with = "de_u64")]
    pub compensation_pool_after: u64,
    #[serde(default, deserialize_with = "de_u64")]
    pub compensation_unlock_ms: u64,
    #[serde(default)]
    pub wrapping_frozen: bool,
}

// ---------------------------------------------------------------------------
// Validator registry feed (`validator` module — `§10.3`, status integers `§11.2`)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct ValidatorRegisteredEvent {
    pub pool_id: String,
    pub validator: String,
    #[serde(deserialize_with = "de_u64")]
    pub stake: u64,
    /// Self-asserted display name (LI-D6); `vector<u8>` → [`Self::name_str`] (BI-M8).
    #[serde(default)]
    pub name: Vec<u8>,
}

impl ValidatorRegisteredEvent {
    pub fn name_str(&self) -> Option<String> {
        utf8_opt(&self.name)
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct StakeAddedEvent {
    pub pool_id: String,
    pub depositor: String,
    #[serde(deserialize_with = "de_u64")]
    pub amount: u64,
    #[serde(deserialize_with = "de_u64")]
    pub stake_after: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StakeWithdrawnEvent {
    pub pool_id: String,
    pub validator: String,
    #[serde(deserialize_with = "de_u64")]
    pub amount: u64,
    #[serde(deserialize_with = "de_u64")]
    pub stake_after: u64,
}

/// `dispute_id` is `Option<ID>` — `null` (manual freeze) or the dispute id that drove the
/// FROZEN/SLASHED transition (`§10.2`).
#[derive(Debug, Clone, Deserialize)]
pub struct ValidatorStatusChangedEvent {
    pub pool_id: String,
    pub old_status: u8,
    pub new_status: u8,
    #[serde(default)]
    pub dispute_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Position-ledger feed (`asset` + `accumulator` modules — `§10.3`)
// ---------------------------------------------------------------------------

/// `asset` module. Drives `raise_progress` (not `position_events`) — see `§4` dispatch map.
#[derive(Debug, Clone, Deserialize)]
pub struct CapitalContributedEvent {
    pub asset_id: String,
    pub contributor: String,
    #[serde(deserialize_with = "de_u64")]
    pub amount: u64,
    #[serde(deserialize_with = "de_u64")]
    pub raised_after: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ContributionRefundedEvent {
    pub asset_id: String,
    pub contributor: String,
    #[serde(deserialize_with = "de_u64")]
    pub amount: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SharesClaimedEvent {
    pub asset_id: String,
    pub holder: String,
    #[serde(deserialize_with = "de_u64")]
    pub count: u64,
    pub share_object_id: String,
}

/// `accumulator` module.
#[derive(Debug, Clone, Deserialize)]
pub struct SharesWrappedEvent {
    pub asset_id: String,
    pub holder: String,
    #[serde(deserialize_with = "de_u64")]
    pub count: u64,
    #[serde(deserialize_with = "de_u64")]
    pub total_wrapped_after: u64,
}

/// `accumulator` module.
#[derive(Debug, Clone, Deserialize)]
pub struct SharesUnwrappedEvent {
    pub asset_id: String,
    pub holder: String,
    #[serde(deserialize_with = "de_u64")]
    pub count: u64,
    pub share_object_id: String,
    #[serde(deserialize_with = "de_u64")]
    pub total_wrapped_after: u64,
}

/// `accumulator` module. `index_at_claim` is a `u128` (NUMERIC). BI-M8: `reward_pool_after` folds
/// into `accumulator_balances` (LI-D9 — the claim drains the reward pool).
#[derive(Debug, Clone, Deserialize)]
pub struct YieldClaimedEvent {
    pub asset_id: String,
    pub holder: String,
    #[serde(deserialize_with = "de_u64")]
    pub amount: u64,
    #[serde(deserialize_with = "de_u128")]
    pub index_at_claim: u128,
    #[serde(default, deserialize_with = "de_u64")]
    pub reward_pool_after: u64,
}

/// `accumulator` module. `total_minted_after` is not a `position_events` column (the fold uses
/// `count`); it is captured for completeness but not stored (`§2.10`).
#[derive(Debug, Clone, Deserialize)]
pub struct ShareRedeemedEvent {
    pub asset_id: String,
    pub holder: String,
    #[serde(deserialize_with = "de_u64")]
    pub count: u64,
    #[serde(deserialize_with = "de_u64")]
    pub total_minted_after: u64,
}

// ---------------------------------------------------------------------------
// Yield-index feed (`asset` + `accumulator` modules — `§10.3`)
// ---------------------------------------------------------------------------

/// `asset` module (NOT `accumulator` — a §10.1 module-placement drift). `index_after` is a `u128`.
#[derive(Debug, Clone, Deserialize)]
pub struct RevenueDepositedEvent {
    pub asset_id: String,
    #[serde(deserialize_with = "de_u64")]
    pub gross: u64,
    #[serde(deserialize_with = "de_u64")]
    pub fee: u64,
    #[serde(deserialize_with = "de_u64")]
    pub investor_portion: u64,
    #[serde(deserialize_with = "de_u64")]
    pub entity_portion: u64,
    #[serde(deserialize_with = "de_u128")]
    pub index_after: u128,
    #[serde(deserialize_with = "de_u64")]
    pub unwrapped_supply: u64,
    /// BI-M8 (LI-D9): post-deposit pool balances. NOTE — the shipped Move struct carries ONLY these
    /// two `*_after` fields (NOT `compensation_pool_after`, despite plan §5.3's draft). R0/R1: the
    /// struct wins.
    #[serde(default, deserialize_with = "de_u64")]
    pub reward_pool_after: u64,
    #[serde(default, deserialize_with = "de_u64")]
    pub rollover_reserve_after: u64,
}

/// `accumulator` module. `amount` is captured but not stored (`§2.11` has no amount column —
/// retained in `raw_events`); only `index_after`/`unwrapped_supply` land in `yield_index_series`.
#[derive(Debug, Clone, Deserialize)]
pub struct RolloverSweptEvent {
    pub asset_id: String,
    #[serde(deserialize_with = "de_u64")]
    pub amount: u64,
    #[serde(deserialize_with = "de_u128")]
    pub index_after: u128,
    #[serde(deserialize_with = "de_u64")]
    pub unwrapped_supply: u64,
    /// BI-M8 (LI-D9): post-sweep pool balances.
    #[serde(default, deserialize_with = "de_u64")]
    pub reward_pool_after: u64,
    #[serde(default, deserialize_with = "de_u64")]
    pub rollover_reserve_after: u64,
}

/// `accumulator` module. Carries the extra `routed_to_rollover: bool` (a §10.1 catalog/code
/// drift). `amount` is captured but not stored (see [`RolloverSweptEvent`]).
#[derive(Debug, Clone, Deserialize)]
pub struct CompensationSweptEvent {
    pub asset_id: String,
    #[serde(deserialize_with = "de_u64")]
    pub amount: u64,
    #[serde(deserialize_with = "de_u128")]
    pub index_after: u128,
    #[serde(deserialize_with = "de_u64")]
    pub unwrapped_supply: u64,
    pub routed_to_rollover: bool,
    /// BI-M8 (LI-D9): the sweep empties the compensation pool and unfreezes wrapping — the full
    /// post-op snapshot.
    #[serde(default, deserialize_with = "de_u64")]
    pub reward_pool_after: u64,
    #[serde(default, deserialize_with = "de_u64")]
    pub rollover_reserve_after: u64,
    #[serde(default, deserialize_with = "de_u64")]
    pub compensation_pool_after: u64,
    #[serde(default)]
    pub wrapping_frozen: bool,
}

/// `accumulator` module. Admin reclaims truncation residue at closure (`§2.16`); code-only (§10.1).
#[derive(Debug, Clone, Deserialize)]
pub struct DustSweptEvent {
    pub asset_id: String,
    #[serde(deserialize_with = "de_u64")]
    pub amount: u64,
    /// BI-M8 (LI-D9): both pools are emptied by the sweep — reported for a complete balance trail.
    #[serde(default, deserialize_with = "de_u64")]
    pub reward_pool_after: u64,
    #[serde(default, deserialize_with = "de_u64")]
    pub rollover_reserve_after: u64,
}

// ---------------------------------------------------------------------------
// Tranche / milestone feed (`asset` module — `§10.3`)
// ---------------------------------------------------------------------------

/// `asset` module. `blob_id` and `sha256` are `vector<u8>` (hex-encode for storage, §10.2);
/// [`Self::blob_id_hex`] / [`Self::sha256_hex`] produce the stored form.
#[derive(Debug, Clone, Deserialize)]
pub struct MilestoneProofSubmittedEvent {
    pub asset_id: String,
    #[serde(deserialize_with = "de_u64")]
    pub tranche: u64,
    #[serde(default)]
    pub blob_id: Vec<u8>,
    #[serde(default)]
    pub sha256: Vec<u8>,
}

impl MilestoneProofSubmittedEvent {
    pub fn blob_id_hex(&self) -> String {
        hex_encode(&self.blob_id)
    }
    pub fn sha256_hex(&self) -> String {
        hex_encode(&self.sha256)
    }
}

/// `asset` module.
#[derive(Debug, Clone, Deserialize)]
pub struct MilestoneApprovedEvent {
    pub asset_id: String,
    #[serde(deserialize_with = "de_u64")]
    pub tranche: u64,
    pub validator: String,
    pub pool_id: String,
}

/// `asset` module.
#[derive(Debug, Clone, Deserialize)]
pub struct TrancheReleasedEvent {
    pub asset_id: String,
    #[serde(deserialize_with = "de_u64")]
    pub tranche: u64,
    #[serde(deserialize_with = "de_u64")]
    pub amount: u64,
    #[serde(deserialize_with = "de_u64")]
    pub escrow_after: u64,
}

// ---------------------------------------------------------------------------
// Dispute feed (`dispute` module — `§10.3`, verdict integers `§11.3`)
// ---------------------------------------------------------------------------

/// `dispute` module. Field is `evidence_sha256` (not `evidence_hash`) — a §10.1 drift; it is a
/// `vector<u8>` hex-encoded into `disputes.evidence_hash` ([`Self::evidence_hex`]).
#[derive(Debug, Clone, Deserialize)]
pub struct DisputeOpenedEvent {
    pub dispute_id: String,
    pub asset_id: String,
    pub target_pool_id: String,
    pub challenger: String,
    #[serde(deserialize_with = "de_u64")]
    pub bond: u64,
    #[serde(default)]
    pub evidence_sha256: Vec<u8>,
    /// Challenger's short claim (LI-D7); `vector<u8>` → [`Self::reason_str`] (BI-M8).
    #[serde(default)]
    pub reason: Vec<u8>,
}

impl DisputeOpenedEvent {
    pub fn evidence_hex(&self) -> String {
        hex_encode(&self.evidence_sha256)
    }
    pub fn reason_str(&self) -> Option<String> {
        utf8_opt(&self.reason)
    }
}

/// `dispute` module. `votes_*_after` are running tallies (`u64` on the wire); stored as `INT`.
#[derive(Debug, Clone, Deserialize)]
pub struct JurorVotedEvent {
    pub dispute_id: String,
    pub juror_pool_id: String,
    pub guilty: bool,
    #[serde(deserialize_with = "de_u64")]
    pub votes_guilty_after: u64,
    #[serde(deserialize_with = "de_u64")]
    pub votes_innocent_after: u64,
}

/// `dispute` module. `verdict` is a `u8` (§11.3: 1 UPHELD | 2 REJECTED | 3 EXPIRED).
#[derive(Debug, Clone, Deserialize)]
pub struct DisputeResolvedEvent {
    pub dispute_id: String,
    pub asset_id: String,
    pub target_pool_id: String,
    pub verdict: u8,
    #[serde(deserialize_with = "de_u64")]
    pub slashed: u64,
    #[serde(deserialize_with = "de_u64")]
    pub bounty: u64,
    pub challenger: String,
    /// BI-M8 (LI-D9): an UPHELD verdict seeds the compensation pool + opens the grace window; folded
    /// into `accumulator_balances` so wrapped-holder alerts read from the event stream.
    #[serde(default, deserialize_with = "de_u64")]
    pub compensation_pool_after: u64,
    #[serde(default, deserialize_with = "de_u64")]
    pub compensation_unlock_ms: u64,
    #[serde(default)]
    pub wrapping_frozen: bool,
}

/// `dispute` module. Code-only event (not in §18.3, §10.1) → `juror_rewards` (`§2.15`).
#[derive(Debug, Clone, Deserialize)]
pub struct JurorRewardClaimedEvent {
    pub dispute_id: String,
    pub juror_pool_id: String,
    #[serde(deserialize_with = "de_u64")]
    pub amount: u64,
}

/// Lowercase-hex encode a byte slice (`vector<u8>` storage form, §10.2). Dependency-free.
pub fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn u64_field_deserializes_from_json_string() {
        // The §10.2 wire form: u64 arrives as a JSON string.
        let v = json!({
            "asset_id": "0xa", "entity": "0xb",
            "funding_goal": "1000000000", "funding_deadline_ms": "4102444800000",
            "tranche_count": "3", "revenue_split_bps": "5000", "collateral": "200000000"
        });
        let e: AssetCreatedEvent = serde_json::from_value(v).unwrap();
        assert_eq!(e.funding_goal, 1_000_000_000);
        assert_eq!(e.tranche_count, 3);
        assert_eq!(e.collateral, 200_000_000);
    }

    #[test]
    fn u8_state_stays_a_number() {
        let v = json!({ "asset_id": "0xa", "old_state": 0, "new_state": 1 });
        let e: AssetStateChangedEvent = serde_json::from_value(v).unwrap();
        assert_eq!(e.old_state, 0);
        assert_eq!(e.new_state, 1);
    }

    #[test]
    fn doc_hashes_byte_arrays_hex_encode() {
        // vector<vector<u8>> arrives as [[9,9,9,9]] (matches the live node).
        let v = json!({
            "asset_id": "0xa", "pool_id": "0xp", "validator": "0xv",
            "coverage": "20000000000", "doc_hashes": [[9, 9, 9, 9], [255, 0, 16]]
        });
        let e: AssetVouchedEvent = serde_json::from_value(v).unwrap();
        assert_eq!(e.coverage, 20_000_000_000);
        assert_eq!(e.doc_hashes_hex(), vec!["09090909".to_string(), "ff0010".to_string()]);
    }

    #[test]
    fn revenue_u128_index_from_string() {
        // index_after is a u128 — arrives as a JSON string (§10.2).
        let v = json!({
            "asset_id": "0xa", "gross": "10000000", "fee": "100000",
            "investor_portion": "7000000", "entity_portion": "2900000",
            "index_after": "340282366920938463463374607431768211455", "unwrapped_supply": "1000000"
        });
        let e: RevenueDepositedEvent = serde_json::from_value(v).unwrap();
        assert_eq!(e.investor_portion, 7_000_000);
        assert_eq!(e.index_after, u128::MAX);
    }

    #[test]
    fn compensation_carries_routed_flag() {
        let v = json!({
            "asset_id": "0xa", "amount": "500", "index_after": "9",
            "unwrapped_supply": "100", "routed_to_rollover": true
        });
        let e: CompensationSweptEvent = serde_json::from_value(v).unwrap();
        assert!(e.routed_to_rollover);
        assert_eq!(e.index_after, 9);
    }

    #[test]
    fn dispute_evidence_byte_array_hex_encodes() {
        // evidence_sha256 (vector<u8>) arrives as a byte-int array (§10.2).
        let v = json!({
            "dispute_id": "0xd", "asset_id": "0xa", "target_pool_id": "0xp",
            "challenger": "0xc", "bond": "1000000", "evidence_sha256": [222, 173, 190, 239]
        });
        let e: DisputeOpenedEvent = serde_json::from_value(v).unwrap();
        assert_eq!(e.bond, 1_000_000);
        assert_eq!(e.evidence_hex(), "deadbeef");
    }

    // ----- BI-M8 metadata / enrichment -----

    #[test]
    fn asset_created_metadata_and_schedule_decode() {
        // vector<u8> text arrives as byte-int arrays; u64 vectors as string arrays (§10.2).
        let v = json!({
            "asset_id": "0xA", "entity": "0xE", "funding_goal": "300",
            "funding_deadline_ms": "1750000000000", "tranche_count": "2",
            "revenue_split_bps": "7000", "collateral": "100000000",
            "name": [71, 97, 108, 108, 121],          // "Gally"
            "ticker": [71, 76, 89],                    // "GLY"
            "category": 2,
            "location": [76, 97, 103, 111, 115],       // "Lagos"
            "entity_name": [65, 99, 109, 101],         // "Acme"
            "metadata_blob_id": [222, 173], "metadata_sha256": [190, 239],
            "is_term_financing": true, "return_target": "450",
            "tranche_amounts": ["100", "200"],
            "tranche_deadlines_ms": ["1000", "2000"],
            "tranche_descriptions": [[77, 49], [77, 50]]  // "M1","M2"
        });
        let e: AssetCreatedEvent = serde_json::from_value(v).unwrap();
        assert_eq!(e.name_str().as_deref(), Some("Gally"));
        assert_eq!(e.ticker_str().as_deref(), Some("GLY"));
        assert_eq!(e.category, 2);
        assert_eq!(e.location_str().as_deref(), Some("Lagos"));
        assert_eq!(e.entity_name_str().as_deref(), Some("Acme"));
        assert_eq!(e.metadata_blob_id_hex().as_deref(), Some("dead"));
        assert_eq!(e.metadata_sha256_hex().as_deref(), Some("beef"));
        assert!(e.is_term_financing);
        assert_eq!(e.return_target_opt(), Some(450));
        assert_eq!(
            e.tranche_schedule(),
            vec![
                (0, 100, 1000, Some("M1".to_string())),
                (1, 200, 2000, Some("M2".to_string())),
            ]
        );
    }

    #[test]
    fn asset_created_without_metadata_defaults_cleanly() {
        // The BI-M7 fixture shape (no M8 fields) must still deserialize (the dual of R7).
        let v = json!({
            "asset_id": "0xA", "entity": "0xE", "funding_goal": "300",
            "funding_deadline_ms": "1750000000000", "tranche_count": "1",
            "revenue_split_bps": "7000", "collateral": "100000000"
        });
        let e: AssetCreatedEvent = serde_json::from_value(v).unwrap();
        assert_eq!(e.name_str(), None);
        assert_eq!(e.category, 0);
        assert_eq!(e.metadata_blob_id_hex(), None);
        assert!(!e.is_term_financing);
        assert_eq!(e.return_target_opt(), None);
        assert!(e.tranche_schedule().is_empty());
    }

    #[test]
    fn validator_name_and_dispute_reason_decode() {
        let v = json!({ "pool_id": "0xP", "validator": "0xV", "stake": "5000000000",
                        "name": [78, 111, 100, 101] }); // "Node"
        let e: ValidatorRegisteredEvent = serde_json::from_value(v).unwrap();
        assert_eq!(e.name_str().as_deref(), Some("Node"));

        let v = json!({ "dispute_id": "0xD", "asset_id": "0xA", "target_pool_id": "0xP",
                        "challenger": "0xC", "bond": "1000000", "evidence_sha256": [1],
                        "reason": [70, 114, 97, 117, 100] }); // "Fraud"
        let d: DisputeOpenedEvent = serde_json::from_value(v).unwrap();
        assert_eq!(d.reason_str().as_deref(), Some("Fraud"));
    }

    #[test]
    fn compensation_swept_after_fields_decode() {
        let v = json!({
            "asset_id": "0xA", "amount": "500", "index_after": "9", "unwrapped_supply": "100",
            "routed_to_rollover": false, "reward_pool_after": "10", "rollover_reserve_after": "20",
            "compensation_pool_after": "0", "wrapping_frozen": false
        });
        let e: CompensationSweptEvent = serde_json::from_value(v).unwrap();
        assert_eq!(e.reward_pool_after, 10);
        assert_eq!(e.rollover_reserve_after, 20);
        assert_eq!(e.compensation_pool_after, 0);
        assert!(!e.wrapping_frozen);
    }
}
