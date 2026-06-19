//! SIM-M3 full genesis: drive a fresh `gally_core` asset into **every** lifecycle
//! state ([CORE] §4) so the explorer shows a believable, fully-populated protocol.
//!
//! Each transition is one operator PTB (built by `ptb.rs`, signed in-process).
//! The whole thing is idempotent (SI-5): every step is gated on the `sim_state.json`
//! cache and skipped if already present.
//!
//! **AdminCap time-warp (R9):** at genesis the operator shrinks the *config* time
//! windows (dispute window, compensation grace, vouch timeout) via `AdminCap`, so
//! the bytecode stays production-identical while compensation/grace gates clear in
//! seconds. The two **per-asset** deadlines that gate FAILED (funding deadline) and
//! COMPENSATING (tranche deadline) are not config params — they are set short on
//! those assets and waited out against the real `0x6` clock (R8: no fast-forward).
//!
//! **Entity tokens (SIM-D4):** finalize consumes one pooled virgin `TreasuryCap<T>`
//! + `CoinMetadata<T>` from `sim_state.entity_tokens` (pre-published by the runbook).

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::{info, warn};

use crate::config::{Config, Operational};
use crate::ptb;
use crate::sim_state::{EntityToken, LifecycleAsset, SimState};
use crate::sui_client::{created_object_id, created_object_id_contains, SuiClient};

const GOAL: u64 = 100_000_000_000; // 100k μUSDC (= one tranche)
const COLLATERAL: u64 = 10_000_000_000; // 10% of goal
const STAKE_VOUCHER: u64 = 300_000_000_000; // pool[0] vouches all (≥ 6×20k coverage)
const STAKE_EXTRA: u64 = 50_000_000_000; // pools[1..] exist for the K count
const REVENUE_SPLIT_BPS: u64 = 5_000; // 50% of net revenue to investors
const REVENUE_GROSS: u64 = 10_000_000_000; // 10k revenue deposit (→ non-zero index)
const TERM_GOAL: u64 = 1_000_000_000; // 1k μUSDC — small so one revenue deposit clears the return target
const GAS: u64 = 400_000_000;
const FAR_FUNDING_MS: u64 = 4_102_444_800_000; // ~year 2100
const FAR_TRANCHE_MS: u64 = 4_102_448_400_000; // strictly after funding
// Short, real-clock per-asset deadlines for the deadline-gated states (R8).
const FAILED_WINDOW_MS: u64 = 8_000;
const COMPENSATING_FUND_MS: u64 = 22_000;
const COMPENSATING_TRANCHE_MS: u64 = 28_000;

/// The 8 [CORE] §4 lifecycle states this genesis covers, paired with the on-chain
/// `Asset.state` byte each must reach. The seeder seeds exactly one asset per entry
/// (its `ensure` key is the `.0` here).
pub const LIFECYCLE_PLAN: [(&str, u8); 9] = [
    ("pending_vouch", 0),
    ("funding", 1),
    ("failed", 2),
    ("cancelled", 3),
    ("executing", 4),
    ("operational", 5),
    ("compensating", 6),
    ("closed", 7),
    // SIM-M6: a term asset that reaches CLOSED via close_at_return_target (reason 1).
    ("closed_term", 7),
];

/// Plan states whose seeding consumes one pooled entity token at finalize (SIM-D4).
pub const FINALIZED_STATES: [&str; 5] =
    ["executing", "operational", "compensating", "closed", "closed_term"];

/// Plan states not yet recorded in the cache — the seeder's idempotency basis (SI-5).
pub fn remaining_states(st: &SimState) -> Vec<&'static str> {
    LIFECYCLE_PLAN
        .iter()
        .map(|(k, _)| *k)
        .filter(|k| !st.lifecycle.contains_key(*k))
        .collect()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Busy-wait against the wall clock until `target_ms` (+1s buffer) has passed.
fn wait_until(target_ms: u64, why: &str) {
    let now = now_ms();
    if target_ms + 1_000 > now {
        let ms = target_ms + 1_000 - now;
        info!(wait_ms = ms, why, "waiting out a real-clock deadline");
        std::thread::sleep(Duration::from_millis(ms));
    }
}

struct Seeder<'a> {
    client: &'a SuiClient,
    op: &'a Operational,
    config_id: String,
    admin_cap: String,
    gally: String,
    usdc: String,     // `<gally>::usdc::USDC`
    usdc_cap: String, // TreasuryCap<USDC> id
    sim_path: String,
}

impl<'a> Seeder<'a> {
    fn exec(&self, args: &[String]) -> Result<Value> {
        let bytes = ptb::build_unsigned(&self.op.address, GAS, args)?;
        self.client.sign_and_execute(&bytes, &self.op.keypair)
    }

    /// PTB fragment: mint `amount` Mock USDC and bind it to `var`.
    fn mint(&self, amount: u64, var: &str) -> Vec<String> {
        vec![
            "--move-call".into(),
            format!("0x2::coin::mint<{}>", self.usdc),
            format!("@{}", self.usdc_cap),
            format!("{amount}u64"),
            "--assign".into(),
            var.into(),
        ]
    }

    // --- 0. AdminCap time-warp ---------------------------------------------
    fn time_warp(&self, st: &mut SimState) -> Result<()> {
        if st.time_warped {
            return Ok(());
        }
        // admin_set_dispute_params(config, &AdminCap, bond, quorum, threshold_bps,
        //   jury_min_stake, bounty_bps, dispute_window_ms, compensation_grace_ms)
        self.exec(&[
            "--move-call".into(),
            format!("{}::protocol::admin_set_dispute_params", self.gally),
            format!("@{}", self.config_id),
            format!("@{}", self.admin_cap),
            "1000000000u64".into(), // challenger_bond (1k, default)
            "3u64".into(),          // jury_quorum
            "6667u64".into(),       // jury_threshold_bps
            "10000000000u64".into(),// jury_min_stake
            "1000u64".into(),       // challenger_bounty_bps
            "5000u64".into(),       // dispute_window_ms → 5s
            "5000u64".into(),       // compensation_grace_ms → 5s
        ])?;
        self.exec(&[
            "--move-call".into(),
            format!("{}::protocol::admin_set_vouch_timeout_ms", self.gally),
            format!("@{}", self.config_id),
            format!("@{}", self.admin_cap),
            "5000u64".into(),
        ])?;
        // Shrink the wrap cooldown too (SIM-D8 lists min_wrap_duration_ms among the
        // accelerated time params) so the SIM-M4 daemon can wrap freshly-acquired
        // shares within the soak instead of waiting the 1-hour production default.
        self.exec(&[
            "--move-call".into(),
            format!("{}::protocol::admin_set_min_wrap_duration_ms", self.gally),
            format!("@{}", self.config_id),
            format!("@{}", self.admin_cap),
            "5000u64".into(),
        ])?;
        st.time_warped = true;
        st.save(&self.sim_path)?;
        info!("AdminCap time-warp applied: dispute window / compensation grace / vouch timeout / min-wrap → 5s");
        Ok(())
    }

    // --- 1. K validators ----------------------------------------------------
    fn register_validators(&self, st: &mut SimState, k: usize) -> Result<()> {
        while st.validator_pools.len() < k {
            let stake = if st.validator_pools.is_empty() { STAKE_VOUCHER } else { STAKE_EXTRA };
            let mut args = self.mint(stake, "stake");
            args.extend([
                "--move-call".into(),
                format!("{}::validator::register_validator", self.gally),
                format!("@{}", self.config_id),
                "stake".into(),
                // SIM-M6 / LI-D6: each pool gets a self-asserted display name.
                crate::catalog::str_literal(crate::catalog::validator_name(st.validator_pools.len())),
                "@0x6".into(),
            ]);
            let r = self.exec(&args)?;
            let pool = created_object_id(&r, "::validator::ValidatorPool")
                .ok_or_else(|| anyhow!("register: no ValidatorPool"))?;
            let vcap = created_object_id(&r, "::validator::ValidatorCap")
                .ok_or_else(|| anyhow!("register: no ValidatorCap"))?;
            info!(pool = %pool, n = st.validator_pools.len() + 1, "validator registered");
            st.validator_pools.push(pool);
            st.validator_caps.push(vcap);
            st.save(&self.sim_path)?;
        }
        Ok(())
    }

    // --- transition primitives ---------------------------------------------
    /// create_asset (single tranche = goal) with the catalog metadata for `ordinal` (SIM-M6, LI-D3).
    /// Single-tranche on purpose for the states that later release/default — the tuned release and
    /// flag_default mechanics fire on the first/only tranche. Returns (asset_id, entity_cap_id).
    fn create_asset(&self, ordinal: usize, funding_deadline: u64, tranche_deadline: u64)
        -> Result<(String, String)>
    {
        let p = crate::catalog::project(ordinal);
        let desc = crate::catalog::str_literal(&format!("Phase 1/1: {} milestone", p.ticker));
        let mut args = self.mint(COLLATERAL, "col");
        args.extend([
            "--move-call".into(),
            format!("{}::asset::create_asset", self.gally),
            format!("@{}", self.config_id),
            format!("{GOAL}u64"),
            format!("{funding_deadline}u64"),
            format!("vector[{GOAL}u64]"),
            format!("vector[{desc}]"),
            format!("vector[{tranche_deadline}u64]"),
            format!("{REVENUE_SPLIT_BPS}u64"),
        ]);
        args.extend(crate::catalog::metadata_args(p));
        args.extend(["col".into(), "@0x6".into()]);
        let r = self.exec(&args)?;
        let asset = created_object_id(&r, "::asset::Asset")
            .ok_or_else(|| anyhow!("create_asset: no Asset created"))?;
        let cap = created_object_id(&r, "::asset::EntityCap")
            .ok_or_else(|| anyhow!("create_asset: no EntityCap created"))?;
        Ok((asset, cap))
    }

    /// create_asset with the catalog's **multi-tranche** schedule (2–3 tranches, LI-D8). For states
    /// that never release a tranche (PENDING_VOUCH / FUNDING / CANCELLED), so the explorer shows real
    /// unreleased schedules without disturbing the release/default machine. `step` staggers the
    /// deadlines past `funding_deadline` (far-future here — these never lapse).
    fn create_asset_multi(&self, ordinal: usize, funding_deadline: u64, step: u64)
        -> Result<(String, String)>
    {
        let p = crate::catalog::project(ordinal);
        let (amounts, descs, deadlines) =
            crate::catalog::tranche_schedule_literals(p, GOAL, funding_deadline, step);
        let mut args = self.mint(COLLATERAL, "col");
        args.extend([
            "--move-call".into(),
            format!("{}::asset::create_asset", self.gally),
            format!("@{}", self.config_id),
            format!("{GOAL}u64"),
            format!("{funding_deadline}u64"),
            amounts,
            descs,
            deadlines,
            format!("{REVENUE_SPLIT_BPS}u64"),
        ]);
        args.extend(crate::catalog::metadata_args(p));
        args.extend(["col".into(), "@0x6".into()]);
        let r = self.exec(&args)?;
        let asset = created_object_id(&r, "::asset::Asset")
            .ok_or_else(|| anyhow!("create_asset_multi: no Asset created"))?;
        let cap = created_object_id(&r, "::asset::EntityCap")
            .ok_or_else(|| anyhow!("create_asset_multi: no EntityCap created"))?;
        Ok((asset, cap))
    }

    /// create_term_asset (single tranche) with a fixed `return_target` ≥ goal (LI-D12). Used to drive
    /// a term-style CLOSED (reason 1) via `close_at_return_target`. `goal` is small so one revenue
    /// deposit clears the target.
    fn create_term_asset(&self, ordinal: usize, goal: u64, funding_deadline: u64, tranche_deadline: u64)
        -> Result<(String, String)>
    {
        let p = crate::catalog::project(ordinal);
        let collateral = goal / 10 + 1; // ≥ entity_collateral_bps floor (10%)
        let return_target = crate::catalog::term_return_target(goal);
        let desc = crate::catalog::str_literal(&format!("Phase 1/1: {} delivery", p.ticker));
        let mut args = self.mint(collateral, "col");
        args.extend([
            "--move-call".into(),
            format!("{}::asset::create_term_asset", self.gally),
            format!("@{}", self.config_id),
            format!("{goal}u64"),
            format!("{funding_deadline}u64"),
            format!("vector[{goal}u64]"),
            format!("vector[{desc}]"),
            format!("vector[{tranche_deadline}u64]"),
            format!("{REVENUE_SPLIT_BPS}u64"),
        ]);
        args.extend(crate::catalog::metadata_args(p));
        // create_term_asset inserts `return_target` right before `collateral` (guard_rails R2).
        args.extend([format!("{return_target}u64"), "col".into(), "@0x6".into()]);
        let r = self.exec(&args)?;
        let asset = created_object_id(&r, "::asset::Asset")
            .ok_or_else(|| anyhow!("create_term_asset: no Asset created"))?;
        let cap = created_object_id(&r, "::asset::EntityCap")
            .ok_or_else(|| anyhow!("create_term_asset: no EntityCap created"))?;
        Ok((asset, cap))
    }

    fn vouch(&self, asset: &str, pool: &str, vcap: &str) -> Result<()> {
        self.exec(&[
            "--move-call".into(),
            format!("{}::asset::new_walrus_ref", self.gally),
            "vector[1u8,2u8,3u8,4u8]".into(),
            "vector[9u8,9u8,9u8,9u8]".into(),
            "--assign".into(),
            "wref".into(),
            "--make-move-vec".into(),
            format!("<{}::asset::WalrusRef>", self.gally),
            "[wref]".into(),
            "--assign".into(),
            "docs".into(),
            "--move-call".into(),
            format!("{}::asset::vouch_asset_legals", self.gally),
            format!("@{asset}"),
            format!("@{pool}"),
            format!("@{vcap}"),
            format!("@{}", self.config_id),
            "docs".into(),
        ])?;
        Ok(())
    }

    /// Operator self-funds the asset to its goal in one PTB (mint → contribute → keep change).
    fn fund_full(&self, asset: &str) -> Result<()> {
        let mut args = self.mint(GOAL, "pay");
        args.extend([
            "--move-call".into(),
            format!("{}::asset::contribute_capital", self.gally),
            format!("@{asset}"),
            format!("@{}", self.config_id),
            "@0x6".into(),
            "pay".into(),
            "--assign".into(),
            "change".into(),
            "--transfer-objects".into(),
            "[change]".into(),
            format!("@{}", self.op.address),
        ]);
        self.exec(&args)?;
        Ok(())
    }

    /// finalize_successful_raise<T> → returns the created accumulator id. FUNDING→EXECUTING.
    fn finalize(&self, asset: &str, tok: &EntityToken) -> Result<String> {
        let r = self.exec(&[
            "--move-call".into(),
            format!("{}::asset::finalize_successful_raise<{}>", self.gally, tok.type_tag()),
            format!("@{asset}"),
            format!("@{}", self.config_id),
            format!("@{}", tok.treasury_cap_id),
            format!("@{}", tok.metadata_id),
            "@0x6".into(),
        ])?;
        created_object_id_contains(&r, "::accumulator::GlobalYieldAccumulator")
            .ok_or_else(|| anyhow!("finalize: no GlobalYieldAccumulator created"))
    }

    /// One tranche: submit proof → approve → release. Final release flips OPERATIONAL.
    fn release_one_tranche(&self, asset: &str, entity_cap: &str, pool: &str, vcap: &str) -> Result<()> {
        // proof + submit
        self.exec(&[
            "--move-call".into(),
            format!("{}::asset::new_walrus_ref", self.gally),
            "vector[5u8,5u8]".into(),
            "vector[6u8,6u8]".into(),
            "--assign".into(),
            "pr".into(),
            "--move-call".into(),
            format!("{}::asset::submit_milestone_proof", self.gally),
            format!("@{asset}"),
            format!("@{entity_cap}"),
            format!("@{}", self.config_id),
            "0u64".into(),
            "pr".into(),
        ])?;
        // validator approves
        self.exec(&[
            "--move-call".into(),
            format!("{}::asset::approve_milestone", self.gally),
            format!("@{asset}"),
            format!("@{pool}"),
            format!("@{vcap}"),
            format!("@{}", self.config_id),
            "0u64".into(),
        ])?;
        // entity pulls (returns the tranche coin → keep)
        self.exec(&[
            "--move-call".into(),
            format!("{}::asset::release_funding_tranche", self.gally),
            format!("@{asset}"),
            format!("@{entity_cap}"),
            format!("@{}", self.config_id),
            "0u64".into(),
            "--assign".into(),
            "pay".into(),
            "--transfer-objects".into(),
            "[pay]".into(),
            format!("@{}", self.op.address),
        ])?;
        Ok(())
    }

    fn deposit_revenue(&self, asset: &str, acc: &str, type_tag: &str) -> Result<()> {
        self.deposit_revenue_amount(asset, acc, type_tag, REVENUE_GROSS)
    }

    /// `deposit_revenue` with an explicit gross amount (SIM-M6: drive a term asset past its return
    /// target in one drop).
    fn deposit_revenue_amount(&self, asset: &str, acc: &str, type_tag: &str, gross: u64) -> Result<()> {
        let mut args = self.mint(gross, "rev");
        args.extend([
            "--move-call".into(),
            format!("{}::asset::deposit_revenue<{type_tag}>", self.gally),
            format!("@{asset}"),
            format!("@{acc}"),
            format!("@{}", self.config_id),
            "rev".into(),
        ]);
        self.exec(&args)?;
        Ok(())
    }

    /// Fund an asset to an explicit `goal` (SIM-M6 term assets use a small goal). Mirrors
    /// `fund_full` but for a caller-chosen amount.
    fn fund_term(&self, asset: &str, goal: u64) -> Result<()> {
        let mut args = self.mint(goal, "pay");
        args.extend([
            "--move-call".into(),
            format!("{}::asset::contribute_capital", self.gally),
            format!("@{asset}"),
            format!("@{}", self.config_id),
            "@0x6".into(),
            "pay".into(),
            "--assign".into(),
            "change".into(),
            "--transfer-objects".into(),
            "[change]".into(),
            format!("@{}", self.op.address),
        ]);
        self.exec(&args)?;
        Ok(())
    }

    // --- 2. per-state seeders (idempotent) ---------------------------------
    fn ensure(
        &self,
        st: &mut SimState,
        key: &str,
        build: impl FnOnce(&Self) -> Result<LifecycleAsset>,
    ) -> Result<()> {
        if st.lifecycle.contains_key(key) {
            return Ok(());
        }
        let la = build(self).with_context(|| format!("seeding {key} asset"))?;
        info!(state = key, asset = %la.asset_id, "lifecycle asset seeded");
        st.lifecycle.insert(key.to_string(), la);
        st.save(&self.sim_path)?;
        Ok(())
    }

    fn next_token(&self, st: &mut SimState) -> Result<EntityToken> {
        let tok = st
            .take_token()
            .ok_or_else(|| anyhow!("entity-token pool exhausted (SIM-D4): publish more copies"))?;
        st.save(&self.sim_path)?;
        Ok(tok)
    }
}

/// Seed every lifecycle state. Returns a (state → asset id) summary.
pub fn seed_lifecycle(client: &SuiClient, cfg: &Config) -> Result<()> {
    let op = cfg.operator().context("operator context")?;
    let config_id = cfg
        .protocol_config_id
        .clone()
        .ok_or_else(|| anyhow!("PROTOCOL_CONFIG_ID unset"))?;
    let admin_cap = cfg
        .admin_cap_id
        .clone()
        .ok_or_else(|| anyhow!("ADMIN_CAP_ID unset — required for the time-warp + close_wind_down"))?;
    let s = Seeder {
        client,
        op: &op,
        config_id,
        admin_cap: admin_cap.clone(),
        gally: op.gally_package_id.clone(),
        usdc: format!("{}::usdc::USDC", op.usdc_package_id),
        usdc_cap: op.usdc_treasury_cap_id.clone(),
        sim_path: cfg.sim_state_path.clone(),
    };

    let mut st = SimState::load(&cfg.sim_state_path);

    // SIM-D4 pool sufficiency: each not-yet-seeded finalized state will consume one
    // pooled virgin TreasuryCap<T>. Warn early if the pool can't cover them.
    let need = FINALIZED_STATES
        .iter()
        .filter(|s| !st.lifecycle.contains_key(**s))
        .count();
    let avail = st.entity_tokens.len().saturating_sub(st.entity_tokens_used);
    if avail < need {
        warn!(need, avail, "entity-token pool too small for the remaining finalized states (SIM-D4): publish more copies");
    }

    s.time_warp(&mut st)?;
    s.register_validators(&mut st, 3)?;
    let pool = st.validator_pools[0].clone();
    let vcap = st.validator_caps[0].clone();

    // PENDING_VOUCH — create (multi-tranche, never released), do not vouch.
    s.ensure(&mut st, "pending_vouch", |s| {
        let (asset, cap) = s.create_asset_multi(0, FAR_FUNDING_MS, 3_600_000)?;
        Ok(LifecycleAsset { asset_id: asset, entity_cap_id: Some(cap), ..Default::default() })
    })?;

    // CANCELLED — create (multi-tranche), entity cancels before any vouch.
    s.ensure(&mut st, "cancelled", |s| {
        let (asset, cap) = s.create_asset_multi(1, FAR_FUNDING_MS, 3_600_000)?;
        s.exec(&[
            "--move-call".into(),
            format!("{}::asset::cancel_unvouched_by_entity", s.gally),
            format!("@{asset}"),
            format!("@{cap}"),
            "--assign".into(),
            "col".into(),
            "--transfer-objects".into(),
            "[col]".into(),
            format!("@{}", s.op.address),
        ])?;
        Ok(LifecycleAsset { asset_id: asset, entity_cap_id: Some(cap), ..Default::default() })
    })?;

    // FUNDING — create (multi-tranche) + vouch, leave raised = 0.
    s.ensure(&mut st, "funding", |s| {
        let (asset, cap) = s.create_asset_multi(2, FAR_FUNDING_MS, 3_600_000)?;
        s.vouch(&asset, &pool, &vcap)?;
        Ok(LifecycleAsset { asset_id: asset, entity_cap_id: Some(cap), ..Default::default() })
    })?;

    // EXECUTING — create + vouch + fund + finalize<T> (leave tranche unreleased).
    {
        let tok = if st.lifecycle.contains_key("executing") { None } else { Some(s.next_token(&mut st)?) };
        s.ensure(&mut st, "executing", |s| {
            let tok = tok.unwrap();
            let (asset, cap) = s.create_asset(3, FAR_FUNDING_MS, FAR_TRANCHE_MS)?;
            s.vouch(&asset, &pool, &vcap)?;
            s.fund_full(&asset)?;
            let acc = s.finalize(&asset, &tok)?;
            Ok(LifecycleAsset { asset_id: asset, entity_cap_id: Some(cap), accumulator_id: Some(acc), token_type: Some(tok.type_tag()) })
        })?;
    }

    // OPERATIONAL — finalize + release the (single) tranche + deposit revenue (non-zero index).
    {
        let tok = if st.lifecycle.contains_key("operational") { None } else { Some(s.next_token(&mut st)?) };
        s.ensure(&mut st, "operational", |s| {
            let tok = tok.unwrap();
            let (asset, cap) = s.create_asset(4, FAR_FUNDING_MS, FAR_TRANCHE_MS)?;
            s.vouch(&asset, &pool, &vcap)?;
            s.fund_full(&asset)?;
            let acc = s.finalize(&asset, &tok)?;
            s.release_one_tranche(&asset, &cap, &pool, &vcap)?; // → OPERATIONAL
            s.deposit_revenue(&asset, &acc, &tok.type_tag())?;  // → non-zero cumulative_yield_index
            Ok(LifecycleAsset { asset_id: asset, entity_cap_id: Some(cap), accumulator_id: Some(acc), token_type: Some(tok.type_tag()) })
        })?;
    }

    // CLOSED — operational, then admin+entity co-signed wind-down.
    {
        let tok = if st.lifecycle.contains_key("closed") { None } else { Some(s.next_token(&mut st)?) };
        s.ensure(&mut st, "closed", |s| {
            let tok = tok.unwrap();
            let (asset, cap) = s.create_asset(5, FAR_FUNDING_MS, FAR_TRANCHE_MS)?;
            s.vouch(&asset, &pool, &vcap)?;
            s.fund_full(&asset)?;
            let acc = s.finalize(&asset, &tok)?;
            s.release_one_tranche(&asset, &cap, &pool, &vcap)?; // → OPERATIONAL
            s.exec(&[
                "--move-call".into(),
                format!("{}::asset::close_wind_down<{}>", s.gally, tok.type_tag()),
                format!("@{asset}"),
                format!("@{acc}"),
                format!("@{}", s.config_id),
                format!("@{}", s.admin_cap),
                format!("@{cap}"),
            ])?;
            Ok(LifecycleAsset { asset_id: asset, entity_cap_id: Some(cap), accumulator_id: Some(acc), token_type: Some(tok.type_tag()) })
        })?;
    }

    // CLOSED (term) — SIM-M6: a create_term_asset driven to CLOSED **reason 1** via
    // close_at_return_target (not the admin wind-down above). A small goal lets one revenue deposit
    // push lifetime_investor_revenue past the return target.
    {
        let tok = if st.lifecycle.contains_key("closed_term") { None } else { Some(s.next_token(&mut st)?) };
        s.ensure(&mut st, "closed_term", |s| {
            let tok = tok.unwrap();
            let goal = TERM_GOAL;
            let ord = crate::catalog::first_term_ordinal(); // catalog's term project (Trade Finance)
            let (asset, cap) = s.create_term_asset(ord, goal, FAR_FUNDING_MS, FAR_TRANCHE_MS)?;
            s.vouch(&asset, &pool, &vcap)?;
            s.fund_term(&asset, goal)?;
            let acc = s.finalize(&asset, &tok)?;
            s.release_one_tranche(&asset, &cap, &pool, &vcap)?; // → OPERATIONAL
            // Deposit revenue large enough that lifetime_investor_revenue ≥ return_target (goal×1.15).
            s.deposit_revenue_amount(&asset, &acc, &tok.type_tag(), goal * 4)?;
            s.exec(&[
                "--move-call".into(),
                format!("{}::asset::close_at_return_target<{}>", s.gally, tok.type_tag()),
                format!("@{asset}"),
                format!("@{acc}"),
                format!("@{}", s.config_id),
            ])?; // → CLOSED (reason 1)
            Ok(LifecycleAsset { asset_id: asset, entity_cap_id: Some(cap), accumulator_id: Some(acc), token_type: Some(tok.type_tag()) })
        })?;
    }

    // FAILED — create with a short funding window, vouch, wait it out, abort.
    s.ensure(&mut st, "failed", |s| {
        let fd = now_ms() + FAILED_WINDOW_MS;
        let (asset, cap) = s.create_asset(6, fd, fd + 4_000)?;
        s.vouch(&asset, &pool, &vcap)?;
        wait_until(fd, "FAILED funding deadline");
        s.exec(&[
            "--move-call".into(),
            format!("{}::asset::abort_failed_raise", s.gally),
            format!("@{asset}"),
            format!("@{pool}"),
            format!("@{}", s.config_id),
            "@0x6".into(),
        ])?;
        Ok(LifecycleAsset { asset_id: asset, entity_cap_id: Some(cap), ..Default::default() })
    })?;

    // COMPENSATING — finalize, then let the (short) tranche deadline lapse and default.
    {
        let tok = if st.lifecycle.contains_key("compensating") { None } else { Some(s.next_token(&mut st)?) };
        s.ensure(&mut st, "compensating", |s| {
            let tok = tok.unwrap();
            let base = now_ms();
            let fd = base + COMPENSATING_FUND_MS;
            let td = base + COMPENSATING_TRANCHE_MS;
            let (asset, cap) = s.create_asset(7, fd, td)?;
            s.vouch(&asset, &pool, &vcap)?;
            s.fund_full(&asset)?;
            let acc = s.finalize(&asset, &tok)?; // EXECUTING (before fd)
            wait_until(td, "COMPENSATING tranche deadline");
            s.exec(&[
                "--move-call".into(),
                format!("{}::asset::flag_default<{}>", s.gally, tok.type_tag()),
                format!("@{asset}"),
                format!("@{acc}"),
                format!("@{}", s.config_id),
                "@0x6".into(),
            ])?; // → COMPENSATING
            Ok(LifecycleAsset { asset_id: asset, entity_cap_id: Some(cap), accumulator_id: Some(acc), token_type: Some(tok.type_tag()) })
        })?;
    }

    let still_missing = remaining_states(&st);
    if !still_missing.is_empty() {
        warn!(missing = ?still_missing, "some lifecycle states were not seeded");
    }
    if !st.entity_tokens.is_empty() && st.entity_tokens_used > st.entity_tokens.len() {
        warn!("entity-token pool oversubscribed — check pool size");
    }
    let states: Vec<&str> = st.lifecycle.keys().map(|k| k.as_str()).collect();
    info!(states = ?states, pools = st.validator_pools.len(), tokens_used = st.entity_tokens_used, "lifecycle seeding complete");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sim_state::{EntityToken, LifecycleAsset, SimState};

    #[test]
    fn test_lifecycle_plan_covers_all_states() {
        // Every [CORE] §4 state byte 0..=7 is covered. SIM-M6 adds a second CLOSED entry
        // (`closed_term`, reason 1) so byte 7 appears twice — the rest exactly once.
        let mut distinct: Vec<u8> = LIFECYCLE_PLAN.iter().map(|(_, b)| *b).collect();
        distinct.sort();
        distinct.dedup();
        assert_eq!(distinct, (0u8..=7).collect::<Vec<_>>(), "plan must cover each lifecycle state");
        assert_eq!(
            LIFECYCLE_PLAN.iter().filter(|(_, b)| *b == 7).count(),
            2,
            "two CLOSED assets: admin wind-down (reason 3) + term return-target (reason 1)"
        );
        // finalized states are a subset of the plan
        for s in FINALIZED_STATES {
            assert!(LIFECYCLE_PLAN.iter().any(|(k, _)| *k == s), "{s} missing from plan");
        }
    }

    #[test]
    fn test_seed_is_idempotent() {
        // fresh cache: every plan state is outstanding
        let mut st = SimState::default();
        assert_eq!(remaining_states(&st).len(), LIFECYCLE_PLAN.len());
        // with the seed marker present for all states, the seeder is a no-op
        for (k, _) in LIFECYCLE_PLAN {
            st.lifecycle.insert(k.to_string(), LifecycleAsset::default());
        }
        assert!(remaining_states(&st).is_empty(), "all states present → nothing left to seed");
    }

    #[test]
    fn test_entity_token_pool_assignment() {
        let mk = |n: u8| EntityToken {
            package_id: format!("0xpkg{n}"),
            module: "entity_token".into(),
            witness: "ENTITY_TOKEN".into(),
            treasury_cap_id: format!("0xcap{n}"),
            metadata_id: format!("0xmeta{n}"),
        };
        // SIM-M6: 5 finalized states now (added closed_term) → the pool must hold ≥5.
        let mut st = SimState {
            entity_tokens: vec![mk(1), mk(2), mk(3), mk(4), mk(5)],
            ..Default::default()
        };
        // one finalize per finalized state, each consuming a DISTINCT pooled T
        let mut tags = Vec::new();
        for _ in 0..FINALIZED_STATES.len() {
            tags.push(st.take_token().expect("pool must cover the finalized states").type_tag());
        }
        let mut uniq = tags.clone();
        uniq.sort();
        uniq.dedup();
        assert_eq!(uniq.len(), tags.len(), "each finalize must consume a distinct T");
        assert_eq!(st.entity_tokens_used, FINALIZED_STATES.len());
        // not over-subscribable: an exhausted pool yields None and does not advance
        assert!(st.take_token().is_none());
        assert_eq!(st.entity_tokens_used, FINALIZED_STATES.len());
    }
}
