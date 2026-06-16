//! `sim_state.json` — a **cache** of seeded object ids (SIM-D6 / guard_rails R5):
//! never a source of truth, never a database. Everything here is re-derivable
//! from on-chain events; it exists only to make re-seeding idempotent (SI-5) and
//! to skip a redundant genesis when the bot restarts against the same node.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Serialize, Deserialize, Default, Debug, Clone)]
pub struct SimState {
    /// The validator pool seeded for the demo asset.
    pub validator_pool_id: Option<String>,
    /// Its `ValidatorCap` (owned by the operator), needed to vouch.
    pub validator_cap_id: Option<String>,
    /// The demo `Asset` the user cohort funds.
    pub asset_id: Option<String>,
    /// Its `EntityCap` (owned by the operator) — recorded for later lifecycle steps.
    pub entity_cap_id: Option<String>,
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
}
