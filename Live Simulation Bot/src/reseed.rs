//! The lazy re-seed loop (`protocol_flow.md §10`, SIM-M2). Each tick: read the
//! `MockFaucet`; if the reservoir is below the low-water mark, the operator mints
//! `RESEED_AMOUNT` Mock USDC (via `TreasuryCap<USDC>`, SIM-D2) and `refill`s the
//! faucet. Idempotent and lazy — a healthy reservoir is a logged no-op.

use anyhow::{anyhow, Result};
use serde_json::json;
use tracing::{info, warn};

use crate::config::Config;
use crate::gas::GasFaucet;
use crate::sui_client::{first_created_owned_object, SuiClient};

/// Re-seed exactly when the reservoir has dropped below the low-water mark.
pub fn should_reseed(reservoir: u64, low_water_mark: u64) -> bool {
    reservoir < low_water_mark
}

/// μUSDC minted per re-seed.
pub fn reseed_amount(cfg: &Config) -> u64 {
    cfg.reseed_amount
}

/// One re-seed tick. Lazy: reads first, acts only if low. Self-correcting: any
/// precondition failure is surfaced as an `Err` for the caller to log + continue.
pub fn tick(client: &SuiClient, _gas: &GasFaucet, cfg: &Config) -> Result<()> {
    let faucet_id = match &cfg.mock_faucet_id {
        Some(id) => id,
        None => {
            warn!("MOCK_FAUCET_ID unset — read-only mode, skipping re-seed");
            return Ok(());
        }
    };

    let state = client.read_faucet(faucet_id)?;
    if !should_reseed(state.reservoir, state.low_water_mark) {
        info!(
            reservoir = state.reservoir,
            low_water_mark = state.low_water_mark,
            "faucet healthy — no-op"
        );
        return Ok(());
    }

    info!(
        reservoir = state.reservoir,
        low_water_mark = state.low_water_mark,
        "reservoir low — re-seeding"
    );

    let op = cfg.operator()?; // clear error if operator key / IDs are absent
    let amount = reseed_amount(cfg);

    // 1. mint RESEED_AMOUNT Mock USDC to the operator (entry fn — no leftover value).
    let mint = client.move_call_signed(
        &op.keypair,
        &op.address,
        "0x2",
        "coin",
        "mint_and_transfer",
        vec![format!("{}::usdc::USDC", op.gally_package_id)],
        vec![
            json!(op.usdc_treasury_cap_id),
            json!(amount.to_string()),
            json!(op.address),
        ],
        100_000_000,
    )?;
    let coin_id = first_created_owned_object(&mint)
        .ok_or_else(|| anyhow!("mint: no created owned coin in effects"))?;

    // 2. refill the faucet with the freshly minted coin.
    client.move_call_signed(
        &op.keypair,
        &op.address,
        &op.faucet_package_id,
        "faucet",
        "refill",
        vec![],
        vec![json!(faucet_id), json!(coin_id)],
        100_000_000,
    )?;

    let after = client.read_faucet(faucet_id)?;
    info!(minted = amount, reservoir_after = after.reservoir, "re-seed complete");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn test_reseed_decision() {
        assert!(should_reseed(10, 20));
        assert!(!should_reseed(20, 20)); // exactly at the mark is healthy
        assert!(!should_reseed(30, 20));
    }

    #[test]
    fn test_reseed_amount() {
        let cfg = Config::from_map(&BTreeMap::new(), None, None).unwrap();
        assert_eq!(reseed_amount(&cfg), crate::config::DEFAULT_RESEED_AMOUNT);

        let mut map = BTreeMap::new();
        map.insert("RESEED_AMOUNT".to_string(), "250_000_000".to_string());
        let cfg = Config::from_map(&map, None, None).unwrap();
        assert_eq!(reseed_amount(&cfg), 250_000_000);
    }
}
