//! `sim_state.json` — a **cache** of seeded object ids (SIM-D6 / guard_rails R5):
//! never a source of truth, never a database. Everything here is re-derivable
//! from on-chain events; it exists only to make seeding idempotent (SI-5) and to
//! skip a redundant genesis when the bot restarts against the same node.
//!
//! The `entity_tokens` pool (SIM-D4) is **pre-populated by the deploy runbook**
//! (publish `entity_token_template` copies, record each `(package_id,
//! treasury_cap, metadata, type_tag)`); the lifecycle seeder *consumes* one per
//! finalized asset via the `entity_tokens_used` cursor. The bot preserves the
//! pool on round-trip and only appends `lifecycle` / advances the cursor.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;

/// One pooled entity token (one `entity_token_template` publish, SIM-D4).
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EntityToken {
    pub package_id: String,
    pub module: String,
    pub witness: String,
    pub treasury_cap_id: String,
    pub metadata_id: String,
}

impl EntityToken {
    /// Fully-qualified coin type `T` for `finalize_successful_raise<T>`.
    pub fn type_tag(&self) -> String {
        format!("{}::{}::{}", self.package_id, self.module, self.witness)
    }
}

/// A seeded lifecycle asset and the ids later steps need.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct LifecycleAsset {
    pub asset_id: String,
    pub entity_cap_id: Option<String>,
    pub accumulator_id: Option<String>,
    /// The pooled `T` type tag consumed at finalize (for finalized assets).
    pub token_type: Option<String>,
}

#[derive(Serialize, Deserialize, Default, Debug, Clone)]
pub struct SimState {
    // --- funding slice (SIM-M3 part 1) ---
    pub validator_pool_id: Option<String>,
    pub validator_cap_id: Option<String>,
    pub asset_id: Option<String>,
    pub entity_cap_id: Option<String>,

    // --- full lifecycle (SIM-M3 part 2) ---
    #[serde(default)]
    pub time_warped: bool,
    /// K registered validator pools (the first also vouches the lifecycle assets).
    #[serde(default)]
    pub validator_pools: Vec<String>,
    #[serde(default)]
    pub validator_caps: Vec<String>,
    /// Pre-published entity-token pool (SIM-D4); consumed left-to-right.
    #[serde(default)]
    pub entity_tokens: Vec<EntityToken>,
    #[serde(default)]
    pub entity_tokens_used: usize,
    /// state-name (`"pending_vouch"`, …, `"closed"`) → the asset seeded for it.
    #[serde(default)]
    pub lifecycle: BTreeMap<String, LifecycleAsset>,
}

impl SimState {
    pub fn load(path: &str) -> SimState {
        match fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
            Err(_) => SimState::default(),
        }
    }

    pub fn save(&self, path: &str) -> Result<()> {
        let text = serde_json::to_string_pretty(self).context("serialising sim_state")?;
        fs::write(path, text).with_context(|| format!("writing sim state to {path}"))
    }

    /// Take the next unused pooled token, advancing the cursor. `None` if the
    /// pool is exhausted (publish more copies — SIM-D4).
    pub fn take_token(&mut self) -> Option<EntityToken> {
        let tok = self.entity_tokens.get(self.entity_tokens_used).cloned();
        if tok.is_some() {
            self.entity_tokens_used += 1;
        }
        tok
    }
}
