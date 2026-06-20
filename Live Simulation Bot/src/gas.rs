//! SUI **gas** funding. Two sources (config `GAS_SOURCE`):
//!   • `faucet` (localnet): top an address up from the node's `--with-faucet` SUI faucet.
//!   • `operator` (Devnet, DEV-G1): NO faucet — the operator wallet (the funded recovery
//!     phrase) pays each user a gas grant from its own SUI. Finite balance ⇒ the bot must
//!     **throttle**: a pre-flight reads the operator balance and caps how many users/assets
//!     it will drive so it can never run dry mid-funding (which would OOG-panic a tx).
//! This is the node's SUI gas — wholly distinct from the protocol's Mock-USDC `MockFaucet`.

use anyhow::{anyhow, Result};
use serde_json::json;
use tracing::{info, warn};

use crate::keys::Keypair;
use crate::sui_client::SuiClient;

/// Where per-address SUI gas comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GasSource {
    /// Local node faucet (`sui start --with-faucet`).
    Faucet,
    /// The operator wallet funds users from its own balance (Devnet — no faucet).
    Operator,
}

impl GasSource {
    pub fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "operator" | "wallet" => GasSource::Operator,
            _ => GasSource::Faucet,
        }
    }
}

/// Dynamic gas budget for the operator-funded (Devnet) path (DEV-G1).
#[derive(Clone, Copy, Debug)]
pub struct GasBudget {
    /// SUI (MIST) granted to each fake user — must cover its whole soak of txs.
    pub per_user_grant_mist: u64,
    /// SUI (MIST) the operator keeps for its OWN txs (publish/genesis/reseed/seed).
    pub operator_reserve_mist: u64,
    /// MIST budgeted per simulated asset the operator seeds at genesis.
    pub per_asset_mist: u64,
}

impl Default for GasBudget {
    fn default() -> Self {
        // Tuned so the worked example holds exactly: 2 SUI ⇒ 30 users.
        // (2e9 − 0.2e9 reserve) / 0.06e9 per user = 30.
        GasBudget {
            per_user_grant_mist: 60_000_000,    // 0.06 SUI per user
            operator_reserve_mist: 200_000_000, // 0.2 SUI operator float
            per_asset_mist: 50_000_000,         // 0.05 SUI per seeded asset
        }
    }
}

/// The result of the pre-flight throttle: how much the operator balance can actually
/// afford, vs. what was requested.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GasPlan {
    pub balance_mist: u64,
    pub requested_users: usize,
    pub effective_users: usize,
    pub requested_assets: usize,
    pub effective_assets: usize,
    pub downscaled: bool,
}

/// SUI (MIST) the operator balance can spend on funding (after its own reserve).
fn spendable(balance_mist: u64, b: &GasBudget) -> u64 {
    balance_mist.saturating_sub(b.operator_reserve_mist)
}

/// How many users the operator balance can safely fund (pure — unit-tested).
/// Never more than requested; with `0` per-user grant, falls back to `requested`.
pub fn affordable_users(balance_mist: u64, requested: usize, b: &GasBudget) -> usize {
    if b.per_user_grant_mist == 0 {
        return requested;
    }
    let max = (spendable(balance_mist, b) / b.per_user_grant_mist) as usize;
    requested.min(max)
}

/// How many seeded assets the operator balance can afford, AFTER reserving the chosen
/// users' grants (pure — unit-tested). Assets draw on whatever the user grants leave.
pub fn affordable_assets(balance_mist: u64, users: usize, requested_assets: usize, b: &GasBudget) -> usize {
    if b.per_asset_mist == 0 {
        return requested_assets;
    }
    let after_users = spendable(balance_mist, b).saturating_sub((users as u64) * b.per_user_grant_mist);
    let max = (after_users / b.per_asset_mist) as usize;
    requested_assets.min(max)
}

/// Pre-flight throttle (DEV-G1): given the live operator balance + the requested scale,
/// compute the effective users/assets the bot will actually drive. Pure — unit-tested.
pub fn plan_gas(balance_mist: u64, requested_users: usize, requested_assets: usize, b: &GasBudget) -> GasPlan {
    let effective_users = affordable_users(balance_mist, requested_users, b);
    let effective_assets = affordable_assets(balance_mist, effective_users, requested_assets, b);
    GasPlan {
        balance_mist,
        requested_users,
        effective_users,
        requested_assets,
        effective_assets,
        downscaled: effective_users < requested_users || effective_assets < requested_assets,
    }
}

/// Run the pre-flight throttle against the live operator balance and log the outcome.
/// Returns the plan; the caller overrides its `user_count`/asset scale with the
/// effective values so no transaction is ever attempted unfunded.
pub fn preflight_throttle(
    client: &SuiClient,
    operator: &str,
    requested_users: usize,
    requested_assets: usize,
    b: &GasBudget,
) -> GasPlan {
    let balance = client.sui_balance(operator).unwrap_or(0);
    let plan = plan_gas(balance, requested_users, requested_assets, b);
    if plan.downscaled {
        warn!(
            operator,
            balance_sui = balance as f64 / 1e9,
            requested_users = plan.requested_users,
            effective_users = plan.effective_users,
            requested_assets = plan.requested_assets,
            effective_assets = plan.effective_assets,
            per_user_sui = b.per_user_grant_mist as f64 / 1e9,
            reserve_sui = b.operator_reserve_mist as f64 / 1e9,
            "DEV-G1 gas throttle: insufficient operator SUI — DOWNSCALING the sim to fit the budget (prevents out-of-gas panics)"
        );
    } else {
        info!(
            operator,
            balance_sui = balance as f64 / 1e9,
            effective_users = plan.effective_users,
            effective_assets = plan.effective_assets,
            "DEV-G1 gas throttle: operator balance covers the requested scale"
        );
    }
    plan
}

pub struct GasFaucet {
    url: String,
    agent: ureq::Agent,
}

impl GasFaucet {
    pub fn new(url: &str) -> Self {
        GasFaucet {
            url: url.to_string(),
            agent: ureq::agent(),
        }
    }

    /// Request a fixed gas grant for `address` from the local SUI faucet.
    pub fn request_gas(&self, address: &str) -> Result<()> {
        let body = json!({ "FixedAmountRequest": { "recipient": address } });
        self.agent
            .post(&self.url)
            .set("Content-Type", "application/json")
            .send_string(&body.to_string())
            .map_err(|e| anyhow!("SUI gas faucet request for {address} failed: {e}"))?;
        Ok(())
    }

    /// Request gas only when `address` is below `threshold_mist` (lazy top-up).
    pub fn ensure_gas(&self, client: &SuiClient, address: &str, threshold_mist: u64) -> Result<()> {
        let balance = client.sui_balance(address).unwrap_or(0);
        if balance < threshold_mist {
            info!(address, balance, threshold = threshold_mist, "gas low — requesting from SUI faucet");
            self.request_gas(address)?;
        } else {
            info!(address, balance, "gas sufficient");
        }
        Ok(())
    }
}

/// MIST budgeted for each operator-funded `paySui` transaction itself.
const FUND_TX_GAS_BUDGET: u64 = 50_000_000; // 0.05 SUI

/// Operator-funded gas (Devnet, DEV-G1): top each user up to `per_user_grant` SUI from
/// the operator's own balance — there is NO faucet. Users already at/above the grant are
/// skipped (lazy). A single failed funding is contained (logged, loop continues) so one
/// flaky tx never aborts the run. Returns the number actually funded.
pub fn fund_users_from_operator(client: &SuiClient, operator: &Keypair, user_addrs: &[String], b: &GasBudget) -> usize {
    let mut funded = 0usize;
    for addr in user_addrs {
        let bal = client.sui_balance(addr).unwrap_or(0);
        if bal >= b.per_user_grant_mist {
            continue; // already has enough — don't waste operator SUI
        }
        let need = b.per_user_grant_mist - bal;
        match client.pay_sui(operator, addr, need, FUND_TX_GAS_BUDGET) {
            Ok(_) => {
                funded += 1;
                info!(user = %addr, grant_sui = need as f64 / 1e9, "operator funded user gas (DEV-G1)");
            }
            Err(e) => warn!(user = %addr, error = %e, "operator gas funding failed — skipping user (loop continues)"),
        }
    }
    funded
}

#[cfg(test)]
mod tests {
    use super::*;

    /// DEV-G1 worked example: "60 users requested, wallet only has 2 SUI ⇒ downscale to 30".
    #[test]
    fn test_throttle_downscales_to_fit_balance() {
        let b = GasBudget::default(); // 0.06 SUI/user, 0.2 SUI reserve
        // 2 SUI: (2.0 − 0.2) / 0.06 = 30 affordable users.
        assert_eq!(affordable_users(2_000_000_000, 60, &b), 30);
        let plan = plan_gas(2_000_000_000, 60, 8, &b);
        assert_eq!(plan.effective_users, 30);
        assert!(plan.downscaled);
    }

    #[test]
    fn test_throttle_no_downscale_when_funded() {
        let b = GasBudget::default();
        // 230 SUI (the real Devnet operator) easily covers 60 users + 8 assets.
        let plan = plan_gas(230_000_000_000, 60, 8, &b);
        assert_eq!(plan.effective_users, 60);
        assert_eq!(plan.effective_assets, 8);
        assert!(!plan.downscaled);
    }

    #[test]
    fn test_throttle_assets_drawn_after_users() {
        let b = GasBudget::default();
        // Exactly enough for the users' grants + 2 assets, no more.
        let bal = b.operator_reserve_mist + 10 * b.per_user_grant_mist + 2 * b.per_asset_mist;
        let plan = plan_gas(bal, 10, 8, &b);
        assert_eq!(plan.effective_users, 10);
        assert_eq!(plan.effective_assets, 2); // requested 8, only 2 affordable
        assert!(plan.downscaled);
    }

    #[test]
    fn test_throttle_starved_balance_zero_users() {
        let b = GasBudget::default();
        // Below the reserve ⇒ nothing spendable ⇒ 0 users (no unfunded txs attempted).
        assert_eq!(affordable_users(100_000_000, 60, &b), 0);
    }

    #[test]
    fn test_gas_source_parse() {
        assert_eq!(GasSource::parse("operator"), GasSource::Operator);
        assert_eq!(GasSource::parse("WALLET"), GasSource::Operator);
        assert_eq!(GasSource::parse("faucet"), GasSource::Faucet);
        assert_eq!(GasSource::parse("anything-else"), GasSource::Faucet);
    }
}
