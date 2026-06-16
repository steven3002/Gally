//! Gally Root Simulator bot — SIM-M2 (`milestone/live-simulation/m2.md`).
//!
//! BOOT → connect to the node → load/generate fake-user keys → ENSURE_GAS →
//! TICK loop running **only** the lazy re-seed (`protocol_flow.md §6`). Activity
//! generation (SIM-M4) and genesis seeding (SIM-M3) are out of scope here.
//!
//! The bot runs **no server** (SIM-D7): the chain is the only IPC.

mod activity;
mod cli;
mod config;
mod gas;
mod keys;
mod lifecycle;
mod pace;
mod ptb;
mod reseed;
mod seed;
mod sim_state;
mod sui_client;

use anyhow::{Context, Result};
use std::time::Duration;
use tracing::{info, warn};

fn main() -> Result<()> {
    init_tracing();

    let cli = cli::Cli::parse(std::env::args().skip(1))?;
    let cfg = config::Config::load(&cli).context("loading configuration")?;
    let prof = cfg.pace.profile();
    info!(
        pace = cfg.pace.as_str(),
        tick_ms = cfg.tick_interval_ms,
        traffic = prof.traffic,
        time_regime = prof.time_regime,
        "Dual-State Engine profile selected"
    );

    // BOOT — verify the node connection up front.
    let client = sui_client::SuiClient::new(&cfg.rpc_url);
    let chain = client
        .chain_identifier()
        .with_context(|| format!("connecting to local node at {}", cfg.rpc_url))?;
    info!(rpc = %cfg.rpc_url, chain_id = %chain, "connected to local node");

    // Fake-user cohort — stable addresses across restarts (SI-5).
    let users = keys::load_or_generate_users(&cfg.user_keys_path, cfg.user_count)
        .context("loading fake-user keypairs")?;
    info!(
        count = users.len(),
        first = users.first().map(|u| u.address.as_str()).unwrap_or("-"),
        "fake-user cohort ready"
    );

    // ENSURE_GAS — top up operator (if configured) + all users from the SUI faucet.
    let gasf = gas::GasFaucet::new(&cfg.faucet_url);
    match cfg.operator_address() {
        Some(op) => {
            info!(operator = %op, "operator key loaded");
            if let Err(e) = gasf.ensure_gas(&client, &op, cfg.gas_threshold_mist) {
                warn!(error = %e, "operator gas top-up failed");
            }
        }
        None => warn!(
            "OPERATOR_KEY not set — running read-only (no re-seed). Set OPERATOR_KEY + the \
             post-publish IDs to enable live re-seed."
        ),
    }
    for u in &users {
        if let Err(e) = gasf.ensure_gas(&client, &u.address, cfg.gas_threshold_mist) {
            warn!(address = %u.address, error = %e, "user gas top-up failed");
        }
    }

    // --check: connectivity smoke test — read the faucet, report, exit.
    if cli.check {
        match &cfg.mock_faucet_id {
            Some(fid) => {
                let st = client.read_faucet(fid).context("reading MockFaucet")?;
                info!(
                    reservoir = st.reservoir,
                    allocation = st.allocation,
                    low_water_mark = st.low_water_mark,
                    claim_count = st.claim_count,
                    total_claimed = st.total_claimed,
                    would_reseed = reseed::should_reseed(st.reservoir, st.low_water_mark),
                    "MockFaucet read OK"
                );
            }
            None => warn!("MOCK_FAUCET_ID unset — skipped faucet read"),
        }
        info!("base-architecture check complete");
        return Ok(());
    }

    // --seed-all: SIM-M3 full genesis — an asset in every lifecycle state, K
    // validators, AdminCap time-warp, non-zero yield index. One pass, idempotent.
    if cli.seed_all {
        reseed::tick(&client, &gasf, &cfg).context("re-seeding faucet before genesis")?;
        lifecycle::seed_lifecycle(&client, &cfg).context("seeding all lifecycle states")?;
        info!("SIM-M3 full genesis pass complete");
        return Ok(());
    }

    // --fund: SIM-M3 funding slice — ensure the faucet has USDC, seed a vouched
    // FUNDING asset, then drive the user cohort to claim + contribute. One pass.
    if cli.fund {
        let faucet_id = cfg
            .mock_faucet_id
            .clone()
            .context("--fund requires MOCK_FAUCET_ID")?;
        let config_id = cfg
            .protocol_config_id
            .clone()
            .context("--fund requires PROTOCOL_CONFIG_ID")?;
        cfg.faucet_package_id
            .as_ref()
            .context("--fund requires FAUCET_PACKAGE_ID")?;
        cfg.gally_package_id
            .as_ref()
            .context("--fund requires GALLY_PACKAGE_ID")?;

        // 1. make sure the faucet can satisfy the cohort's claims.
        reseed::tick(&client, &gasf, &cfg).context("re-seeding faucet before funding")?;
        // 2. ensure a vouched FUNDING asset exists (idempotent).
        let seeded = seed::ensure_seed(&client, &cfg).context("seeding the demo asset")?;
        // 3. drive the user cohort to fund it, paced by --pace.
        let raised = activity::fund_asset(
            &client,
            &cfg,
            &users,
            &faucet_id,
            &seeded.asset_id,
            &config_id,
        )
        .context("running the funding loop")?;
        info!(
            asset = %seeded.asset_id,
            validator_pool = %seeded.validator_pool_id,
            raised,
            goal = seed::DEMO_FUNDING_GOAL,
            funded = (raised >= seed::DEMO_FUNDING_GOAL),
            "SIM-M3 funding pass complete"
        );
        return Ok(());
    }

    // TICK loop — RESEED + SLEEP only (SIM-M2).
    let tick = Duration::from_millis(cfg.tick_interval_ms);
    info!(once = cli.once, tick_ms = cfg.tick_interval_ms, "entering re-seed tick loop");
    loop {
        if let Err(e) = reseed::tick(&client, &gasf, &cfg) {
            warn!(error = %e, "re-seed tick failed (continuing next tick)");
        }
        if cli.once {
            break;
        }
        std::thread::sleep(tick);
    }
    Ok(())
}

fn init_tracing() {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .with_target(false)
        .init();
}
