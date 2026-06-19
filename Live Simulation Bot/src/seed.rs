//! Minimal genesis seed for the SIM-M3 funding slice: the operator registers one
//! validator and lists one vouched asset in **FUNDING**, so the simulated user
//! cohort has a real `gally_core` target to fund (`activity.rs`).
//!
//! Idempotent (SI-5 / R5): if `sim_state.json` already names an on-chain asset, we
//! reuse it and skip seeding. All ids are recovered from each tx's `objectChanges`
//! and cached — the cache is never the source of truth.
//!
//! Every step is a multi-command PTB built by the CLI (`ptb::build_unsigned`) and
//! signed in-process: `coin::mint → register_validator`, `coin::mint →
//! create_asset`, and `new_walrus_ref → make-move-vec → vouch_asset_legals` (the
//! last two can't be a single `unsafe_moveCall` — see `ptb.rs`).
//!
//! Economics (read from `gally_core` defaults, protocol.move): a 100,000-USDC goal
//! needs ≥10% (10k) entity collateral and ≥20% (20k) validator coverage; we stake
//! 50k (≥ both the 10k min stake and the 20k coverage). Amounts are μUSDC.

use anyhow::{anyhow, Context, Result};
use tracing::info;

use crate::catalog;
use crate::config::Config;
use crate::ptb;
use crate::sim_state::SimState;
use crate::sui_client::{created_object_id, SuiClient};
use crate::walrus;

/// Demo asset funding goal (μUSDC) — 4 × 25k faucet claims fund it exactly.
pub const DEMO_FUNDING_GOAL: u64 = 100_000_000_000;
const VALIDATOR_STAKE: u64 = 50_000_000_000; // 50k ≥ max(10k min, 20k coverage)
const ENTITY_COLLATERAL: u64 = 10_000_000_000; // 10% of the 100k goal
const REVENUE_SPLIT_BPS: u64 = 500; // 5% revenue share
// Far-future funding deadline (year ~2100); the multi-tranche deadlines step strictly after it.
const FUNDING_DEADLINE_MS: u64 = 4_102_444_800_000;
const SEED_GAS_BUDGET: u64 = 200_000_000;

/// The seeded objects the funding loop needs.
pub struct Seeded {
    pub asset_id: String,
    pub validator_pool_id: String,
}

/// Ensure a vouched FUNDING asset exists, seeding one if the cache has none on
/// chain. Returns its id (+ the validator pool that vouched it).
pub fn ensure_seed(client: &SuiClient, cfg: &Config) -> Result<Seeded> {
    let op = cfg.operator().context("operator context for seeding")?;
    let config_id = cfg
        .protocol_config_id
        .clone()
        .ok_or_else(|| anyhow!("PROTOCOL_CONFIG_ID unset — required for SIM-M3 seeding"))?;
    let gally = &op.gally_package_id;
    let usdc_type = format!("{}::usdc::USDC", op.usdc_package_id);

    let mut state = SimState::load(&cfg.sim_state_path);

    // Idempotency: reuse an existing on-chain asset (SI-5).
    if let (Some(asset_id), Some(pool_id)) = (&state.asset_id, &state.validator_pool_id) {
        if let Ok((st, raised, goal)) = client.asset_view(asset_id) {
            info!(asset = %asset_id, state = st, raised, goal, "existing seed found — skipping genesis");
            return Ok(Seeded {
                asset_id: asset_id.clone(),
                validator_pool_id: pool_id.clone(),
            });
        }
    }

    info!("no on-chain seed cached — registering validator + listing a vouched asset");

    // 1. mint stake → register_validator (pool + ValidatorCap created).
    let reg = client.sign_and_execute(
        &ptb::build_unsigned(
            &op.address,
            SEED_GAS_BUDGET,
            &[
                "--move-call".into(),
                format!("0x2::coin::mint<{usdc_type}>"),
                format!("@{}", op.usdc_treasury_cap_id),
                format!("{VALIDATOR_STAKE}u64"),
                "--assign".into(),
                "stake".into(),
                "--move-call".into(),
                format!("{gally}::validator::register_validator"),
                format!("@{config_id}"),
                "stake".into(),
                catalog::str_literal(catalog::validator_name(0)), // BI-M8 / LI-D6: named validator
                "@0x6".into(),
            ],
        )?,
        &op.keypair,
    )?;
    let pool_id = created_object_id(&reg, "::validator::ValidatorPool")
        .ok_or_else(|| anyhow!("register: no ValidatorPool created"))?;
    let vcap_id = created_object_id(&reg, "::validator::ValidatorCap")
        .ok_or_else(|| anyhow!("register: no ValidatorCap created"))?;
    info!(pool = %pool_id, "validator registered");

    // 2. mint collateral → create_asset (Asset + EntityCap created; PENDING_VOUCH).
    // SIM-M6: real catalog metadata + a multi-tranche schedule (LI-D3/D8). The funding-slice asset
    // is catalog entry 0 (Lekki Coastal Homes, Housing, 3 tranches).
    let project = catalog::project(0);
    let (tranche_amounts, tranche_descs, tranche_deadlines) =
        catalog::tranche_schedule_literals(project, DEMO_FUNDING_GOAL, FUNDING_DEADLINE_MS, 3_600_000);
    let mut create_args = vec![
        "--move-call".into(),
        format!("0x2::coin::mint<{usdc_type}>"),
        format!("@{}", op.usdc_treasury_cap_id),
        format!("{ENTITY_COLLATERAL}u64"),
        "--assign".into(),
        "col".into(),
        "--move-call".into(),
        format!("{gally}::asset::create_asset"),
        format!("@{config_id}"),
        format!("{DEMO_FUNDING_GOAL}u64"),
        format!("{FUNDING_DEADLINE_MS}u64"),
        tranche_amounts,
        tranche_descs,
        tranche_deadlines,
        format!("{REVENUE_SPLIT_BPS}u64"),
    ];
    create_args.extend(catalog::metadata_args(project)); // name,ticker,category,location,entity_name,blob_id,sha256
    create_args.extend(["col".into(), "@0x6".into()]);
    let create = client.sign_and_execute(
        &ptb::build_unsigned(&op.address, SEED_GAS_BUDGET, &create_args)?,
        &op.keypair,
    )?;
    let asset_id = created_object_id(&create, "::asset::Asset")
        .ok_or_else(|| anyhow!("create_asset: no Asset created"))?;
    let entity_cap_id = created_object_id(&create, "::asset::EntityCap");
    info!(asset = %asset_id, "asset listed (PENDING_VOUCH)");

    // 3. new_walrus_ref → make-move-vec → vouch (PENDING_VOUCH → FUNDING).
    client.sign_and_execute(
        &ptb::build_unsigned(
            &op.address,
            SEED_GAS_BUDGET,
            &[
                "--move-call".into(),
                format!("{gally}::asset::new_walrus_ref"),
                "vector[1u8,2u8,3u8,4u8]".into(),     // mock Walrus blob id
                "vector[9u8,9u8,9u8,9u8]".into(),     // mock sha256
                "--assign".into(),
                "wref".into(),
                "--make-move-vec".into(),
                format!("<{gally}::asset::WalrusRef>"),
                "[wref]".into(),
                "--assign".into(),
                "docs".into(),
                "--move-call".into(),
                format!("{gally}::asset::vouch_asset_legals"),
                format!("@{asset_id}"),
                format!("@{pool_id}"),
                format!("@{vcap_id}"),
                format!("@{config_id}"),
                "docs".into(),
            ],
        )?,
        &op.keypair,
    )?;
    info!(asset = %asset_id, "asset vouched → FUNDING");

    state.validator_pool_id = Some(pool_id.clone());
    state.validator_cap_id = Some(vcap_id);
    state.asset_id = Some(asset_id.clone());
    state.entity_cap_id = entity_cap_id;
    state.save(&cfg.sim_state_path)?;

    // SIM-M6 / LI-Q3: emit the deterministic mock-Walrus blob map so the frontend resolves +
    // sha256-verifies asset metadata docs in sim mode (idempotent — identical bytes each run).
    let blobs_path =
        std::path::Path::new(&cfg.sim_state_path).with_file_name("walrus_blobs.json");
    if let Err(e) = walrus::write_blob_map(&blobs_path) {
        info!(error = %e, "could not write walrus_blobs.json (non-fatal)");
    }

    Ok(Seeded {
        asset_id,
        validator_pool_id: pool_id,
    })
}
