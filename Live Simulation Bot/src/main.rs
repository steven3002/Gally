//! Gally Root Simulator bot — SIM-M2 (`milestone/live-simulation/m2.md`).
//!
//! BOOT → connect to the node → load/generate fake-user keys → ENSURE_GAS →
//! TICK loop running **only** the lazy re-seed (`protocol_flow.md §6`). Activity
//! generation (SIM-M4) and genesis seeding (SIM-M3) are out of scope here.
//!
//! The bot runs **no server** (SIM-D7): the chain is the only IPC.

mod action;
mod activity;
mod catalog;
mod cli;
mod config;
mod daemon;
mod gas;
mod keys;
mod lifecycle;
mod pace;
mod ptb;
mod reseed;
mod rng;
mod seed;
mod showcase;
mod sim_state;
mod walrus;
mod sui_client;

use anyhow::{Context, Result};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn};

/// SIM-M5 graceful shutdown: a shared flag flipped by a Ctrl-C (SIGINT) handler. The long-running
/// loops poll it and exit cleanly — finishing the current tick and flushing `sim_state.json` — so a
/// soak can be stopped without orphaned work or a corrupt cache (Pass Criteria 3).
fn install_shutdown() -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    let handler_flag = flag.clone();
    if let Err(e) = ctrlc::set_handler(move || {
        handler_flag.store(true, Ordering::Relaxed);
        eprintln!("\n[sim] shutdown requested — finishing the current tick and flushing state…");
    }) {
        warn!(error = %e, "could not install Ctrl-C handler — shutdown will be abrupt");
    }
    flag
}

fn main() -> Result<()> {
    init_tracing();
    let shutdown = install_shutdown();

    let cli = cli::Cli::parse(std::env::args().skip(1))?;
    let mut cfg = config::Config::load(&cli).context("loading configuration")?;
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

    // DEV-G1 gas throttle (operator-funded / Devnet): read the operator's live SUI balance
    // and cap the cohort to what it can fund BEFORE any keys/txs are generated — overriding
    // the requested USER_COUNT so no transaction is ever attempted unfunded (no OOG panics).
    const REQUESTED_ASSETS: usize = 9; // genesis seeds one asset per lifecycle state
    if cfg.gas_source == gas::GasSource::Operator {
        match cfg.operator_address() {
            Some(op) => {
                let plan = gas::preflight_throttle(&client, &op, cfg.user_count, REQUESTED_ASSETS, &cfg.gas_budget);
                cfg.user_count = plan.effective_users; // override the requested input
            }
            None => warn!("GAS_SOURCE=operator but OPERATOR_KEY unset — cannot throttle/fund the cohort"),
        }
    }

    // Fake-user cohort — stable addresses across restarts (SI-5), sized by the throttle.
    let users = keys::load_or_generate_users(&cfg.user_keys_path, cfg.user_count)
        .context("loading fake-user keypairs")?;
    info!(
        count = users.len(),
        first = users.first().map(|u| u.address.as_str()).unwrap_or("-"),
        "fake-user cohort ready"
    );

    // GAS — fund the operator + cohort: faucet (localnet) or operator-funded (Devnet, DEV-G1).
    let gasf = gas::GasFaucet::new(&cfg.faucet_url);
    match cfg.gas_source {
        gas::GasSource::Faucet => {
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
        }
        gas::GasSource::Operator => {
            // Devnet: the operator IS the funded recovery-phrase wallet; it funds the cohort
            // from its own SUI (no faucet). The throttle above guarantees this can't run dry.
            match cfg.operator() {
                Ok(op) => {
                    info!(operator = %op.address, "operator (recovery-phrase wallet) loaded — funding cohort from its SUI");
                    let addrs: Vec<String> = users.iter().map(|u| u.address.clone()).collect();
                    let funded = gas::fund_users_from_operator(&client, &op.keypair, &addrs, &cfg.gas_budget);
                    info!(funded, cohort = users.len(), "DEV-G1 operator-funded cohort gas");
                }
                Err(e) => warn!(error = %e, "GAS_SOURCE=operator but operator context invalid — cohort unfunded"),
            }
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

    // --showcase: curated, judge-facing dataset — headline assets fully funded by 30+
    // distinct cohort investors, milestones + tranches disbursed, 3 open raises, 6
    // disputes (2 rejected / 2 upheld / 2 voting), yields claimed/wrapped, gov events.
    if cli.showcase {
        showcase::run_showcase(&client, &cfg).context("seeding the judge showcase")?;
        info!("showcase seeding pass complete");
        return Ok(());
    }

    // --extra-headlines: append N OPERATIONAL assets, each fully funded by EXTRA_INVESTORS
    // distinct investors who ALL claim their deeds (≥40 holders/asset). One pass.
    if cli.extra_headlines {
        showcase::run_extra_headlines(&client, &cfg).context("seeding extra headline assets")?;
        info!("extra-headlines seeding pass complete");
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

    // --daemon: SIM-M4 activity generator — RESEED + one weighted-random action
    // per tick (the continuous traffic loop). Requires a seeded genesis.
    if cli.daemon {
        daemon::run(&client, &gasf, &cfg, &users, cli.cycles, &shutdown)
            .context("running the activity daemon")?;
        return Ok(());
    }

    // TICK loop — RESEED + SLEEP only (SIM-M2). Honors the same graceful-shutdown flag.
    let tick = Duration::from_millis(cfg.tick_interval_ms);
    info!(once = cli.once, tick_ms = cfg.tick_interval_ms, "entering re-seed tick loop");
    loop {
        if shutdown.load(Ordering::Relaxed) {
            info!("shutdown signal received — exiting re-seed loop");
            break;
        }
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
