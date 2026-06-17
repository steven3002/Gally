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

/// Routed to `raw_events` only in BI-M2 (no dedicated handler until a later milestone).
#[derive(Debug, Clone, Deserialize)]
pub struct EntityDefaultedEvent {
    pub asset_id: String,
    #[serde(deserialize_with = "de_u64")]
    pub tranche_missed: u64,
    #[serde(deserialize_with = "de_u64")]
    pub collateral_seized: u64,
    #[serde(deserialize_with = "de_u64")]
    pub escrow_seized: u64,
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

/// `accumulator` module. `index_at_claim` is a `u128` (NUMERIC).
#[derive(Debug, Clone, Deserialize)]
pub struct YieldClaimedEvent {
    pub asset_id: String,
    pub holder: String,
    #[serde(deserialize_with = "de_u64")]
    pub amount: u64,
    #[serde(deserialize_with = "de_u128")]
    pub index_at_claim: u128,
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
}
