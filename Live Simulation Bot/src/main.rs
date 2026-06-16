//! Gally Root Simulator bot — SIM-M2 (`milestone/live-simulation/m2.md`).
//!
//! BOOT → connect to the node → load/generate fake-user keys → ENSURE_GAS →
//! TICK loop running **only** the lazy re-seed (`protocol_flow.md §6`). Activity
//! generation (SIM-M4) and genesis seeding (SIM-M3) are out of scope here.
//!
//! The bot runs **no server** (SIM-D7): the chain is the only IPC.

mod cli;
mod config;
mod gas;
mod keys;
mod pace;
mod reseed;
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
