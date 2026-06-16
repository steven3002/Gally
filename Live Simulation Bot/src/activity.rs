//! SIM-M3 funding loop: the simulated user cohort funds a real `gally_core`
//! asset. Each user runs **one PTB** that claims its Mock USDC allocation from the
//! `MockFaucet` and immediately contributes it — claim and contribute are bundled
//! so there is no inter-tx race and the change coin is routed back to the user:
//!
//! ```text
//! faucet::claim(@faucet)            -> c            (Coin<USDC>, ~25k)
//! asset::contribute_capital(@asset, @config, @0x6, c) -> change
//! transfer-objects([change], @user)
//! ```
//!
//! Pacing honours the Dual-State Engine (`--pace`): the bot sleeps
//! `tick_interval_ms` between users (accelerated ≈ 2s, real-world ≈ 30s). The loop
//! reads `Asset.raised` before each user and stops once the goal is met — so it
//! never issues a doomed `EGoalAlreadyMet` tx and re-running is a no-op (SI-5).

use anyhow::Result;
use std::time::Duration;
use tracing::{info, warn};

use crate::config::Config;
use crate::keys::Keypair;
use crate::ptb;
use crate::sui_client::SuiClient;

/// `Asset.state` byte for FUNDING (`[CORE] §4`).
const STATE_FUNDING: u8 = 1;
const FUND_GAS_BUDGET: u64 = 200_000_000;

/// Drive the cohort to fund `asset_id`. Returns the final `raised` amount.
pub fn fund_asset(
    client: &SuiClient,
    cfg: &Config,
    users: &[Keypair],
    faucet_id: &str,
    asset_id: &str,
    config_id: &str,
) -> Result<u64> {
    let tick = Duration::from_millis(cfg.tick_interval_ms);
    let faucet_pkg = cfg
        .faucet_package_id
        .clone()
        .expect("faucet package id checked by caller");
    let gally = cfg
        .gally_package_id
        .clone()
        .expect("gally package id checked by caller");

    let (state0, raised0, goal) = client.asset_view(asset_id)?;
    info!(asset = %asset_id, state = state0, raised = raised0, goal, "funding loop start");
    if state0 != STATE_FUNDING {
        warn!(state = state0, "asset is not in FUNDING — nothing to fund");
        return Ok(raised0);
    }

    let mut last_raised = raised0;
    for (i, user) in users.iter().enumerate() {
        let (state, raised, goal) = client.asset_view(asset_id)?;
        last_raised = raised;
        if state != STATE_FUNDING || raised >= goal {
            info!(raised, goal, "goal reached (or left FUNDING) — stopping funding loop");
            break;
        }

        let args = [
            "--move-call".to_string(),
            format!("{faucet_pkg}::faucet::claim"),
            format!("@{faucet_id}"),
            "--assign".to_string(),
            "c".to_string(),
            "--move-call".to_string(),
            format!("{gally}::asset::contribute_capital"),
            format!("@{asset_id}"),
            format!("@{config_id}"),
            "@0x6".to_string(),
            "c".to_string(),
            "--assign".to_string(),
            "change".to_string(),
            "--transfer-objects".to_string(),
            "[change]".to_string(),
            format!("@{}", user.address),
        ];

        match ptb::build_unsigned(&user.address, FUND_GAS_BUDGET, &args)
            .and_then(|bytes| client.sign_and_execute(&bytes, user))
        {
            Ok(_) => {
                let after = client.asset_view(asset_id).map(|v| v.1).unwrap_or(raised);
                last_raised = after;
                info!(
                    user = i,
                    address = %user.address,
                    raised_after = after,
                    goal,
                    "user claimed + contributed"
                );
            }
            // Lazy + self-correcting (R5): a precondition failure (already claimed,
            // chain moved) is logged and skipped, not retried blindly.
            Err(e) => warn!(user = i, address = %user.address, error = %e, "claim+contribute failed — skipping user"),
        }

        std::thread::sleep(tick);
    }

    info!(raised = last_raised, goal, funded = (last_raised >= goal), "funding loop complete");
    Ok(last_raised)
}
