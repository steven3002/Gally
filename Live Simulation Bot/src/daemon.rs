//! SIM-M4 — The Activity Daemon (`protocol_flow.md §6, §8, §13`).
//!
//! The continuous traffic generator. Each tick: re-seed the faucet (lazy),
//! then perform ONE weighted-random action from the `[CORE]` activity catalog
//! against objects seeded in SIM-M3 (and assets the daemon itself lists),
//! driving real `gally_core` entry functions from the fake-user cohort + the
//! operator. The emitted events are logged cleanly so the traffic is visible,
//! and an event-coverage tracker reports which `[CORE] §18` families have been
//! produced over the run.
//!
//! Lazy + self-correcting (SIM-D6 / R5): every action re-reads its target's
//! on-chain state before acting; if no valid target exists, or the chain moved
//! under the bot, the action is **logged and skipped** — never a panic, never a
//! blind retry. Exit paths (`claim_rewards`, `unwrap_coins`, `redeem_share`)
//! keep firing even while the protocol is paused (D6).

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::collections::{BTreeSet, HashSet};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::{info, warn};

use crate::action::{self, Action, GovStep};
use crate::config::{Config, Operational};
use crate::gas::GasFaucet;
use crate::keys::Keypair;
use crate::pace::Pace;
use crate::ptb;
use crate::sim_state::{EntityToken, SimState};
use crate::sui_client::{
    created_object_id, created_object_id_contains, event_types, SuiClient,
};

const GAS: u64 = 500_000_000;
const FAR_MS: u64 = 4_102_444_800_000; // ~year 2100
const CONTRIB_CHUNK: u64 = 25_000_000_000; // 25k μUSDC per contribution
const REVENUE_CHUNK: u64 = 8_000_000_000; // 8k μUSDC per revenue deposit
const STAKE_CHUNK: u64 = 5_000_000_000; // 5k μUSDC per stake top-up
const REVENUE_SPLIT_BPS: u64 = 5_000; // 50% to investors

/// The full `[CORE] §18` event family set + the faucet feed — the coverage goal
/// for the soak (Pass Criteria 2). Short struct names (after the last `::`).
pub const EXPECTED_FAMILIES: &[&str] = &[
    // governance
    "ProtocolParamChangedEvent",
    "EmergencyStopTriggeredEvent",
    "ProtocolResumedEvent",
    // validator registry
    "ValidatorRegisteredEvent",
    "StakeAddedEvent",
    "StakeWithdrawnEvent",
    "ValidatorStatusChangedEvent",
    // asset lifecycle
    "AssetCreatedEvent",
    "AssetVouchedEvent",
    "AssetStateChangedEvent",
    "MilestoneProofSubmittedEvent",
    "MilestoneApprovedEvent",
    "TrancheReleasedEvent",
    "AssetOperationalEvent",
    "EntityDefaultedEvent",
    "AssetClosedEvent",
    // position ledger
    "CapitalContributedEvent",
    "SharesClaimedEvent",
    "SharesWrappedEvent",
    "SharesUnwrappedEvent",
    "YieldClaimedEvent",
    "ShareRedeemedEvent",
    // revenue / index
    "RaiseFinalizedEvent",
    "RevenueDepositedEvent",
    "RolloverSweptEvent",
    "CompensationSweptEvent",
    // disputes
    "DisputeOpenedEvent",
    "JurorVotedEvent",
    "DisputeResolvedEvent",
    // faucet feed
    "FaucetClaimedEvent",
    "FaucetRefilledEvent",
];

/// An asset the daemon knows about (cache; re-derivable from events, SIM-D6).
#[derive(Clone)]
struct KnownAsset {
    id: String,
    accumulator_id: Option<String>,
    token_type: Option<String>,
    entity_cap_id: Option<String>,
    /// Listed with a short tranche deadline so it defaults if not released in time.
    doomed: bool,
}

/// Live-traffic event coverage tracker (what the daemon itself has emitted).
#[derive(Default)]
struct Coverage {
    seen: BTreeSet<String>,
}

impl Coverage {
    fn observe(&mut self, evs: &[String]) {
        for e in evs {
            self.seen.insert(e.clone());
        }
    }
    fn missing(&self) -> Vec<&'static str> {
        EXPECTED_FAMILIES
            .iter()
            .copied()
            .filter(|f| !self.seen.contains(*f))
            .collect()
    }
}

/// The outcome of one activity attempt.
enum Outcome {
    Acted { detail: String, events: Vec<String> },
    Skipped(String),
}

pub struct Daemon<'a> {
    client: &'a SuiClient,
    gasf: &'a GasFaucet,
    cfg: &'a Config,
    op: Operational,
    users: &'a [Keypair],
    config_id: String,
    faucet_id: Option<String>,
    gally: String,
    usdc_type: String,
    coin_t_needle: String,
    rng: crate::rng::Rng,
    coverage: Coverage,
    sim: SimState,
    assets: Vec<KnownAsset>,
    pools: Vec<String>,
    caps: Vec<String>,
    claimed: HashSet<String>,
    tick: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Entry point for `--daemon`. Runs the activity loop until `cycles` ticks
/// elapse (`None` = forever).
pub fn run(
    client: &SuiClient,
    gasf: &GasFaucet,
    cfg: &Config,
    users: &[Keypair],
    cycles: Option<u64>,
) -> Result<()> {
    let op = cfg.operator().context("operator context for the activity daemon")?;
    let config_id = cfg
        .protocol_config_id
        .clone()
        .ok_or_else(|| anyhow!("PROTOCOL_CONFIG_ID unset — required for the activity daemon"))?;

    let sim = SimState::load(&cfg.sim_state_path);
    let mut assets: Vec<KnownAsset> = Vec::new();
    // Seed registry from SIM-M3 state (the funding slice + every lifecycle asset).
    if let Some(id) = &sim.asset_id {
        assets.push(KnownAsset {
            id: id.clone(),
            accumulator_id: None,
            token_type: None,
            entity_cap_id: sim.entity_cap_id.clone(),
            doomed: false,
        });
    }
    for la in sim.lifecycle.values() {
        assets.push(KnownAsset {
            id: la.asset_id.clone(),
            accumulator_id: la.accumulator_id.clone(),
            token_type: la.token_type.clone(),
            entity_cap_id: la.entity_cap_id.clone(),
            doomed: false,
        });
    }
    let pools = sim.validator_pools.clone();
    let caps = sim.validator_caps.clone();
    if pools.is_empty() {
        warn!("no validator pools in sim_state — run `--seed-all` first; some actions will skip");
    }

    let usdc_type = format!("{}::usdc::USDC", op.gally_package_id);
    let coin_t_needle = "::coin::Coin<".to_string();
    let mut d = Daemon {
        client,
        gasf,
        cfg,
        gally: op.gally_package_id.clone(),
        op,
        users,
        config_id,
        faucet_id: cfg.mock_faucet_id.clone(),
        usdc_type,
        coin_t_needle,
        rng: crate::rng::Rng::from_os(),
        coverage: Coverage::default(),
        sim,
        assets,
        pools,
        caps,
        claimed: HashSet::new(),
        tick: 0,
    };

    let interval = Duration::from_millis(cfg.tick_interval_ms);
    info!(
        pace = cfg.pace.as_str(),
        tick_ms = cfg.tick_interval_ms,
        users = users.len(),
        assets = d.assets.len(),
        pools = d.pools.len(),
        cycles = ?cycles,
        "activity daemon starting"
    );

    loop {
        d.tick += 1;

        // 1. RESEED first (lazy) — keep the faucet fundable (§6).
        if let Err(e) = crate::reseed::tick(client, gasf, cfg) {
            warn!(error = %e, "re-seed tick failed (continuing)");
        }
        // periodic gas top-up for the whole cast
        if d.tick % 15 == 1 {
            d.ensure_all_gas();
        }

        // 2. ACTIVITY — one weighted-random action.
        let chosen = action::select(&mut d.rng);
        let w = action::weight(chosen);
        match d.act(chosen) {
            Ok(Outcome::Acted { detail, events }) => {
                d.coverage.observe(&events);
                info!(
                    tick = d.tick,
                    action = chosen.name(),
                    weight = w,
                    events = %fmt_events(&events),
                    "{detail}"
                );
            }
            Ok(Outcome::Skipped(why)) => {
                info!(tick = d.tick, action = chosen.name(), weight = w, "skipped: {why}");
            }
            Err(e) => {
                // A submitted tx aborted (the chain moved under us, a precondition
                // no longer holds): log + continue, never panic (Pass Criteria 3).
                warn!(tick = d.tick, action = chosen.name(), error = %e, "action failed — skipping");
            }
        }

        // 3a. periodic asset-state census (shows the lifecycle distribution).
        if d.tick % 20 == 0 {
            d.log_state_census();
        }

        // 3. periodic coverage report.
        if d.tick % 10 == 0 {
            let missing = d.coverage.missing();
            info!(
                tick = d.tick,
                seen = d.coverage.seen.len(),
                of = EXPECTED_FAMILIES.len(),
                missing = %fmt_events(&missing.iter().map(|s| s.to_string()).collect::<Vec<_>>()),
                "live event coverage so far"
            );
        }

        if let Some(c) = cycles {
            if d.tick >= c {
                break;
            }
        }
        std::thread::sleep(interval);
    }

    let missing = d.coverage.missing();
    info!(
        ticks = d.tick,
        seen = d.coverage.seen.len(),
        of = EXPECTED_FAMILIES.len(),
        missing = %fmt_events(&missing.iter().map(|s| s.to_string()).collect::<Vec<_>>()),
        "activity daemon finished — live coverage summary"
    );

    // On-chain coverage cross-check (Pass Criteria 2): query the node for every
    // event family across all modules (including SIM-M3 seed events).
    d.report_onchain_coverage();
    Ok(())
}

fn fmt_events(evs: &[String]) -> String {
    if evs.is_empty() {
        "-".to_string()
    } else {
        evs.join(",")
    }
}

impl<'a> Daemon<'a> {
    // ---- actor helpers (idx 0 = operator, 1..=N = users) ----
    fn actor_addr(&self, idx: usize) -> &str {
        if idx == 0 {
            &self.op.address
        } else {
            &self.users[idx - 1].address
        }
    }
    fn actor_key(&self, idx: usize) -> &Keypair {
        if idx == 0 {
            &self.op.keypair
        } else {
            &self.users[idx - 1]
        }
    }
    fn actor_label(&self, idx: usize) -> String {
        if idx == 0 {
            "operator".to_string()
        } else {
            format!("user{}", idx - 1)
        }
    }
    fn actor_count(&self) -> usize {
        self.users.len() + 1
    }

    /// Log how many known assets sit in each `[CORE] §4` state (lifecycle pulse).
    fn log_state_census(&self) {
        let mut counts: std::collections::BTreeMap<&'static str, u32> = Default::default();
        for a in &self.assets {
            if let Ok(v) = self.client.asset_full_view(&a.id) {
                *counts.entry(action::state_name(v.state)).or_default() += 1;
            }
        }
        let census = counts
            .iter()
            .map(|(k, n)| format!("{k}={n}"))
            .collect::<Vec<_>>()
            .join(" ");
        info!(tick = self.tick, "asset state census: {census}");
    }

    /// Query the node for every event family it has ever emitted (seed + soak)
    /// and report which `[CORE] §18` families are present on chain. This is the
    /// automated Pass-Criteria-2 measure.
    fn report_onchain_coverage(&self) {
        let mut seen: BTreeSet<String> = BTreeSet::new();
        let gally_modules = ["protocol", "validator", "asset", "accumulator", "dispute"];
        for m in gally_modules {
            if let Ok(types) = self.client.query_event_types(&self.gally, m, 200) {
                seen.extend(types);
            }
        }
        if let Some(fp) = &self.cfg.faucet_package_id {
            if let Ok(types) = self.client.query_event_types(fp, "faucet", 200) {
                seen.extend(types);
            }
        }
        let missing: Vec<&str> = EXPECTED_FAMILIES
            .iter()
            .copied()
            .filter(|f| !seen.contains(*f))
            .collect();
        info!(
            on_chain = seen.len(),
            of = EXPECTED_FAMILIES.len(),
            missing = %fmt_events(&missing.iter().map(|s| s.to_string()).collect::<Vec<_>>()),
            "ON-CHAIN event coverage (seed + soak)"
        );
    }

    fn ensure_all_gas(&self) {
        let _ = self
            .gasf
            .ensure_gas(self.client, &self.op.address, self.cfg.gas_threshold_mist);
        for u in self.users {
            let _ = self
                .gasf
                .ensure_gas(self.client, &u.address, self.cfg.gas_threshold_mist);
        }
    }

    fn exec_op(&self, args: &[String]) -> Result<Value> {
        let bytes = ptb::build_unsigned(&self.op.address, GAS, args)?;
        self.client.sign_and_execute(&bytes, &self.op.keypair)
    }
    fn exec_as(&self, idx: usize, args: &[String]) -> Result<Value> {
        let bytes = ptb::build_unsigned(self.actor_addr(idx), GAS, args)?;
        self.client.sign_and_execute(&bytes, self.actor_key(idx))
    }

    /// PTB fragment: operator mints `amount` Mock USDC, bound to `var`.
    fn mint(&self, amount: u64, var: &str) -> Vec<String> {
        vec![
            "--move-call".into(),
            format!("0x2::coin::mint<{}>", self.usdc_type),
            format!("@{}", self.op.usdc_treasury_cap_id),
            format!("{amount}u64"),
            "--assign".into(),
            var.into(),
        ]
    }

    /// PTB fragment: build a single `WalrusRef` bound to `var` (e.g. a milestone
    /// proof — `submit_milestone_proof` takes one ref, not a vector).
    fn walrus_ref(&self, var: &str) -> Vec<String> {
        vec![
            "--move-call".into(),
            format!("{}::asset::new_walrus_ref", self.gally),
            "vector[5u8,5u8]".into(),
            "vector[6u8,6u8]".into(),
            "--assign".into(),
            var.into(),
        ]
    }

    /// PTB fragment: build a one-element `vector<WalrusRef>` bound to `var`.
    fn docs_vec(&self, var: &str) -> Vec<String> {
        vec![
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
            var.into(),
        ]
    }

    // ---- registry helpers ----
    fn acc_token_for(&self, asset_id: &str) -> Option<(String, String)> {
        let a = self.assets.iter().find(|a| a.id == asset_id)?;
        match (&a.accumulator_id, &a.token_type) {
            (Some(acc), Some(t)) => Some((acc.clone(), t.clone())),
            _ => None,
        }
    }

    /// Snapshot the live view of every known asset (one read each). Assets that
    /// fail to read (deleted/moved) are dropped from the snapshot.
    fn snapshot(&self) -> Vec<(usize, crate::sui_client::AssetView)> {
        let mut out = Vec::new();
        for (i, a) in self.assets.iter().enumerate() {
            if let Ok(v) = self.client.asset_full_view(&a.id) {
                out.push((i, v));
            }
        }
        out
    }

    /// Owned objects of every actor whose type contains `needle` → `(actor_idx, id)`.
    fn scan(&self, needle: &str) -> Vec<(usize, String)> {
        let mut out = Vec::new();
        for idx in 0..self.actor_count() {
            if let Ok(objs) = self.client.owned_objects(self.actor_addr(idx), 50) {
                for o in objs {
                    if o.type_.contains(needle) {
                        out.push((idx, o.id));
                    }
                }
            }
        }
        out
    }

    /// Read a `GallyShare`/`ContributionReceipt`'s `asset_id` field.
    fn object_asset_id(&self, id: &str) -> Option<String> {
        self.client
            .get_object_fields(id)
            .ok()?
            .get("asset_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }

    // ================= the dispatcher =================
    fn act(&mut self, action: Action) -> Result<Outcome> {
        let assets = self.snapshot();
        match action {
            Action::Contribute => self.do_contribute(&assets),
            Action::ListAsset => self.do_list_asset(),
            Action::DepositRevenue => self.do_deposit_revenue(&assets),
            Action::ClaimYield => self.do_claim_yield(),
            Action::ClaimShares => self.do_claim_shares(&assets),
            Action::Finalize => self.do_finalize(&assets),
            Action::TrancheCycle => self.do_tranche_cycle(&assets),
            Action::WrapUnwrap => self.do_wrap_unwrap(),
            Action::Stake => self.do_stake(),
            Action::SweepRollover => self.do_sweep_rollover(),
            Action::Dispute => self.do_dispute(&assets),
            Action::FlagDefault => self.do_flag_default(&assets),
            Action::Close => self.do_close(&assets),
            Action::Governance => self.do_governance(),
            Action::SweepCompensation => self.do_sweep_compensation(),
            Action::Redeem => self.do_redeem(),
        }
    }

    // ---- contribute (user) ----
    fn do_contribute(&mut self, assets: &[(usize, crate::sui_client::AssetView)]) -> Result<Outcome> {
        let cands: Vec<&(usize, crate::sui_client::AssetView)> =
            assets.iter().filter(|(_, v)| action::can_contribute(v)).collect();
        if cands.is_empty() {
            return Ok(Outcome::Skipped("no FUNDING asset with room".into()));
        }
        let (ai, view) = cands[self.rng.pick_index(cands.len()).unwrap()];
        let asset_id = self.assets[*ai].id.clone();
        let uidx = 1 + self.rng.pick_index(self.users.len()).unwrap();
        let user = self.actor_addr(uidx).to_string();
        let open = view.funding_goal - view.raised;
        let amount = open.min(CONTRIB_CHUNK);

        // First contribution per user goes through the faucet (emits FaucetClaimed);
        // afterwards the operator gifts working capital (§4: claim OR operator gift).
        if !self.claimed.contains(&user) {
            if let Some(faucet) = self.faucet_id.clone() {
                let args = vec![
                    "--move-call".into(),
                    format!("{}::faucet::claim", self.faucet_pkg()?),
                    format!("@{faucet}"),
                    "--assign".into(),
                    "c".into(),
                    "--move-call".into(),
                    format!("{}::asset::contribute_capital", self.gally),
                    format!("@{asset_id}"),
                    format!("@{}", self.config_id),
                    "@0x6".into(),
                    "c".into(),
                    "--assign".into(),
                    "change".into(),
                    "--transfer-objects".into(),
                    "[change]".into(),
                    format!("@{user}"),
                ];
                match self.exec_as(uidx, &args) {
                    Ok(r) => {
                        self.claimed.insert(user.clone());
                        return Ok(Outcome::Acted {
                            detail: format!("{} claimed+contributed to {}", self.actor_label(uidx), short(&asset_id)),
                            events: event_types(&r),
                        });
                    }
                    Err(_) => {
                        // already claimed / chain moved — fall through to the gift path.
                        self.claimed.insert(user.clone());
                    }
                }
            }
        }

        // Gift path: operator mints working capital to the user, user contributes it.
        let gift = self.mint(amount, "g").into_iter().chain([
            "--transfer-objects".into(),
            "[g]".into(),
            format!("@{user}"),
        ]).collect::<Vec<_>>();
        self.exec_op(&gift).context("gifting USDC to user")?;

        let coin = self
            .client
            .get_coins(&user, &self.usdc_type, 10)?
            .into_iter()
            .max_by_key(|c| c.balance)
            .ok_or_else(|| anyhow!("user has no USDC after gift"))?;
        let args = vec![
            "--move-call".into(),
            format!("{}::asset::contribute_capital", self.gally),
            format!("@{asset_id}"),
            format!("@{}", self.config_id),
            "@0x6".into(),
            format!("@{}", coin.id),
            "--assign".into(),
            "change".into(),
            "--transfer-objects".into(),
            "[change]".into(),
            format!("@{user}"),
        ];
        let r = self.exec_as(uidx, &args)?;
        Ok(Outcome::Acted {
            detail: format!("{} contributed to {}", self.actor_label(uidx), short(&asset_id)),
            events: event_types(&r),
        })
    }

    fn faucet_pkg(&self) -> Result<String> {
        self.cfg
            .faucet_package_id
            .clone()
            .ok_or_else(|| anyhow!("FAUCET_PACKAGE_ID unset"))
    }

    // ---- list a fresh vouched FUNDING asset (operator) ----
    fn do_list_asset(&mut self) -> Result<Outcome> {
        if self.pools.is_empty() {
            return Ok(Outcome::Skipped("no validator pool to vouch with".into()));
        }
        let goal = 80_000_000_000; // 80k μUSDC — fillable in a few contributions
        let collateral = goal / 10;
        // Far deadlines: the asset rides the success pipeline (fund → finalize →
        // tranche → operational). EntityDefaulted is covered by the seeded
        // COMPENSATING asset, so the daemon does not list doomed assets.
        let mut args = self.mint(collateral, "col");
        args.extend([
            "--move-call".into(),
            format!("{}::asset::create_asset", self.gally),
            format!("@{}", self.config_id),
            format!("{goal}u64"),
            format!("{FAR_MS}u64"),
            format!("vector[{goal}u64]"),
            "vector[vector[77u8,49u8]]".into(),
            // tranche deadline strictly after the funding deadline (E308).
            format!("vector[{}u64]", FAR_MS + 3_600_000),
            format!("{REVENUE_SPLIT_BPS}u64"),
            "col".into(),
            "@0x6".into(),
        ]);
        let create = self.exec_op(&args)?;
        let asset_id = created_object_id(&create, "::asset::Asset")
            .ok_or_else(|| anyhow!("create_asset: no Asset created"))?;
        let entity_cap = created_object_id(&create, "::asset::EntityCap");
        let mut events = event_types(&create);

        // vouch with pool[0].
        let pool = self.pools[0].clone();
        let cap = self.caps[0].clone();
        let mut vargs = self.docs_vec("docs");
        vargs.extend([
            "--move-call".into(),
            format!("{}::asset::vouch_asset_legals", self.gally),
            format!("@{asset_id}"),
            format!("@{pool}"),
            format!("@{cap}"),
            format!("@{}", self.config_id),
            "docs".into(),
        ]);
        match self.exec_op(&vargs) {
            Ok(v) => events.extend(event_types(&v)),
            Err(e) => warn!(error = %e, "vouch failed — asset stays PENDING_VOUCH"),
        }

        self.assets.push(KnownAsset {
            id: asset_id.clone(),
            accumulator_id: None,
            token_type: None,
            entity_cap_id: entity_cap,
            doomed: false,
        });
        Ok(Outcome::Acted {
            detail: format!("listed asset {}", short(&asset_id)),
            events,
        })
    }

    // ---- deposit revenue (operator) ----
    fn do_deposit_revenue(&mut self, assets: &[(usize, crate::sui_client::AssetView)]) -> Result<Outcome> {
        let cands: Vec<usize> = assets
            .iter()
            .filter(|(_, v)| action::can_deposit_revenue(v))
            .map(|(i, _)| *i)
            .filter(|i| self.acc_token_for(&self.assets[*i].id).is_some())
            .collect();
        if cands.is_empty() {
            return Ok(Outcome::Skipped("no OPERATIONAL asset with a known accumulator".into()));
        }
        let ai = cands[self.rng.pick_index(cands.len()).unwrap()];
        let asset_id = self.assets[ai].id.clone();
        let (acc, t) = self.acc_token_for(&asset_id).unwrap();
        let gross = REVENUE_CHUNK;
        let mut args = self.mint(gross, "rev");
        args.extend([
            "--move-call".into(),
            format!("{}::asset::deposit_revenue<{t}>", self.gally),
            format!("@{asset_id}"),
            format!("@{acc}"),
            format!("@{}", self.config_id),
            "rev".into(),
        ]);
        let r = self.exec_op(&args)?;
        Ok(Outcome::Acted {
            detail: format!("deposited {gross} revenue to {}", short(&asset_id)),
            events: event_types(&r),
        })
    }

    // ---- claim yield (any shareholder) ----
    fn do_claim_yield(&mut self) -> Result<Outcome> {
        let shares = self.scan("::share::GallyShare");
        // resolve each share to (actor, share_id, acc, T)
        let mut cands = Vec::new();
        for (idx, sid) in shares {
            if let Some(aid) = self.object_asset_id(&sid) {
                if let Some((acc, t)) = self.acc_token_for(&aid) {
                    cands.push((idx, sid, acc, t));
                }
            }
        }
        if cands.is_empty() {
            return Ok(Outcome::Skipped("no shareholder with a known accumulator".into()));
        }
        let (idx, sid, acc, t) = cands[self.rng.pick_index(cands.len()).unwrap()].clone();
        let addr = self.actor_addr(idx).to_string();
        let args = vec![
            "--move-call".into(),
            format!("{}::accumulator::claim_rewards<{t}>", self.gally),
            format!("@{acc}"),
            format!("@{sid}"),
            "--assign".into(),
            "r".into(),
            "--transfer-objects".into(),
            "[r]".into(),
            format!("@{addr}"),
        ];
        let r = self.exec_as(idx, &args)?;
        Ok(Outcome::Acted {
            detail: format!("{} claimed yield", self.actor_label(idx)),
            events: event_types(&r),
        })
    }

    // ---- convert receipt → share (receipt holder) ----
    fn do_claim_shares(&mut self, _assets: &[(usize, crate::sui_client::AssetView)]) -> Result<Outcome> {
        let receipts = self.scan("::asset::ContributionReceipt");
        let mut cands = Vec::new();
        for (idx, rid) in receipts {
            if let Some(aid) = self.object_asset_id(&rid) {
                if let Some((acc, t)) = self.acc_token_for(&aid) {
                    cands.push((idx, rid, aid, acc, t));
                }
            }
        }
        if cands.is_empty() {
            return Ok(Outcome::Skipped("no receipt on a finalized asset".into()));
        }
        let (idx, rid, aid, acc, t) = cands[self.rng.pick_index(cands.len()).unwrap()].clone();
        let addr = self.actor_addr(idx).to_string();
        let args = vec![
            "--move-call".into(),
            format!("{}::asset::claim_shares<{t}>", self.gally),
            format!("@{aid}"),
            format!("@{acc}"),
            format!("@{}", self.config_id),
            format!("@{rid}"),
            "@0x6".into(),
            "--assign".into(),
            "sh".into(),
            "--transfer-objects".into(),
            "[sh]".into(),
            format!("@{addr}"),
        ];
        let r = self.exec_as(idx, &args)?;
        Ok(Outcome::Acted {
            detail: format!("{} converted receipt → share on {}", self.actor_label(idx), short(&aid)),
            events: event_types(&r),
        })
    }

    // ---- finalize a fully-funded raise (operator, consumes a pooled token) ----
    fn do_finalize(&mut self, assets: &[(usize, crate::sui_client::AssetView)]) -> Result<Outcome> {
        let cands: Vec<usize> = assets
            .iter()
            .filter(|(_, v)| action::can_finalize(v))
            .map(|(i, _)| *i)
            .collect();
        if cands.is_empty() {
            return Ok(Outcome::Skipped("no fully-funded FUNDING asset".into()));
        }
        let token = match self.sim.take_token() {
            Some(t) => t,
            None => return Ok(Outcome::Skipped("entity-token pool exhausted (publish more copies)".into())),
        };
        self.sim.save(&self.cfg.sim_state_path)?;
        let ai = cands[self.rng.pick_index(cands.len()).unwrap()];
        let asset_id = self.assets[ai].id.clone();
        let r = self.finalize_tx(&asset_id, &token)?;
        let acc = created_object_id_contains(&r, "::accumulator::GlobalYieldAccumulator")
            .ok_or_else(|| anyhow!("finalize: no accumulator created"))?;
        self.assets[ai].accumulator_id = Some(acc.clone());
        self.assets[ai].token_type = Some(token.type_tag());
        Ok(Outcome::Acted {
            detail: format!("finalized {} → EXECUTING (acc {})", short(&asset_id), short(&acc)),
            events: event_types(&r),
        })
    }

    fn finalize_tx(&self, asset_id: &str, token: &EntityToken) -> Result<Value> {
        let args = vec![
            "--move-call".into(),
            format!("{}::asset::finalize_successful_raise<{}>", self.gally, token.type_tag()),
            format!("@{asset_id}"),
            format!("@{}", self.config_id),
            format!("@{}", token.treasury_cap_id),
            format!("@{}", token.metadata_id),
            "@0x6".into(),
        ];
        self.exec_op(&args)
    }

    // ---- tranche cycle (operator): submit → approve → release ----
    fn do_tranche_cycle(&mut self, assets: &[(usize, crate::sui_client::AssetView)]) -> Result<Outcome> {
        // Skip doomed assets — they exist to be defaulted.
        let cands: Vec<usize> = assets
            .iter()
            .filter(|(i, v)| action::can_run_tranche(v) && !self.assets[*i].doomed)
            .map(|(i, _)| *i)
            .filter(|i| self.assets[*i].entity_cap_id.is_some())
            .collect();
        if cands.is_empty() {
            return Ok(Outcome::Skipped("no EXECUTING asset with a releasable tranche".into()));
        }
        let ai = cands[self.rng.pick_index(cands.len()).unwrap()];
        let asset_id = self.assets[ai].id.clone();
        let cap = self.assets[ai].entity_cap_id.clone().unwrap();
        let pool = self.pools[0].clone();
        let vcap = self.caps[0].clone();
        let mut events = Vec::new();

        // Read the next tranche's sub-state so we only run the missing steps —
        // re-running a completed step would abort (EProofAlreadySubmitted / …).
        let (idx, view) = assets.iter().find(|(i, _)| *i == ai).unwrap();
        debug_assert_eq!(*idx, ai);
        let tr = view.tranches.get(view.next_tranche as usize);
        let has_proof = tr.map(|t| t.has_proof).unwrap_or(false);
        let approved = tr.map(|t| t.approved).unwrap_or(false);

        // 1. submit proof (if not yet submitted).
        if !has_proof {
            let mut a1 = self.walrus_ref("pr");
            a1.extend([
                "--move-call".into(),
                format!("{}::asset::submit_milestone_proof", self.gally),
                format!("@{asset_id}"),
                format!("@{cap}"),
                format!("@{}", self.config_id),
                "0u64".into(),
                "pr".into(),
            ]);
            events.extend(event_types(&self.exec_op(&a1)?));
        }

        // 2. approve (if not yet approved).
        if !approved {
            let a2 = vec![
                "--move-call".into(),
                format!("{}::asset::approve_milestone", self.gally),
                format!("@{asset_id}"),
                format!("@{pool}"),
                format!("@{vcap}"),
                format!("@{}", self.config_id),
                "0u64".into(),
            ];
            events.extend(event_types(&self.exec_op(&a2)?));
        }

        // 3. release (→ OPERATIONAL).
        let a3 = vec![
            "--move-call".into(),
            format!("{}::asset::release_funding_tranche", self.gally),
            format!("@{asset_id}"),
            format!("@{cap}"),
            format!("@{}", self.config_id),
            "0u64".into(),
            "--assign".into(),
            "pay".into(),
            "--transfer-objects".into(),
            "[pay]".into(),
            format!("@{}", self.op.address),
        ];
        events.extend(event_types(&self.exec_op(&a3)?));

        Ok(Outcome::Acted {
            detail: format!("ran tranche cycle on {} → OPERATIONAL", short(&asset_id)),
            events,
        })
    }

    // ---- wrap / unwrap (any holder) ----
    fn do_wrap_unwrap(&mut self) -> Result<Outcome> {
        if self.rng.flip() {
            self.do_wrap()
        } else {
            self.do_unwrap()
        }
    }

    fn do_wrap(&mut self) -> Result<Outcome> {
        let shares = self.scan("::share::GallyShare");
        let mut cands = Vec::new();
        for (idx, sid) in shares {
            if let Some(aid) = self.object_asset_id(&sid) {
                if let Some((acc, t)) = self.acc_token_for(&aid) {
                    cands.push((idx, sid, acc, t));
                }
            }
        }
        if cands.is_empty() {
            return Ok(Outcome::Skipped("no wrappable share".into()));
        }
        let (idx, sid, acc, t) = cands[self.rng.pick_index(cands.len()).unwrap()].clone();
        let addr = self.actor_addr(idx).to_string();
        // wrap_shares<T> returns (Coin<T>, Coin<USDC> force-claimed yield).
        let args = vec![
            "--move-call".into(),
            format!("{}::accumulator::wrap_shares<{t}>", self.gally),
            format!("@{acc}"),
            format!("@{}", self.config_id),
            format!("@{sid}"),
            "@0x6".into(),
            "--assign".into(),
            "w".into(),
            "--transfer-objects".into(),
            "[w.0,w.1]".into(),
            format!("@{addr}"),
        ];
        let r = self.exec_as(idx, &args)?;
        Ok(Outcome::Acted {
            detail: format!("{} wrapped a share → Coin<T>", self.actor_label(idx)),
            events: event_types(&r),
        })
    }

    fn do_unwrap(&mut self) -> Result<Outcome> {
        // Find any actor-held Coin<T> for a known token type.
        let mut cands = Vec::new();
        for idx in 0..self.actor_count() {
            if let Ok(objs) = self.client.owned_objects(self.actor_addr(idx), 50) {
                for o in objs {
                    if !o.type_.contains(&self.coin_t_needle) {
                        continue;
                    }
                    // match the inner T to a known token type → its accumulator.
                    if let Some(a) = self
                        .assets
                        .iter()
                        .find(|a| a.token_type.as_deref().map(|t| o.type_.contains(t)).unwrap_or(false))
                    {
                        if let (Some(acc), Some(t)) = (&a.accumulator_id, &a.token_type) {
                            cands.push((idx, o.id.clone(), acc.clone(), t.clone()));
                        }
                    }
                }
            }
        }
        if cands.is_empty() {
            return Ok(Outcome::Skipped("no Coin<T> to unwrap".into()));
        }
        let (idx, coin, acc, t) = cands[self.rng.pick_index(cands.len()).unwrap()].clone();
        let addr = self.actor_addr(idx).to_string();
        let args = vec![
            "--move-call".into(),
            format!("{}::accumulator::unwrap_coins<{t}>", self.gally),
            format!("@{acc}"),
            format!("@{coin}"),
            "@0x6".into(),
            "--assign".into(),
            "sh".into(),
            "--transfer-objects".into(),
            "[sh]".into(),
            format!("@{addr}"),
        ];
        let r = self.exec_as(idx, &args)?;
        Ok(Outcome::Acted {
            detail: format!("{} unwrapped Coin<T> → share", self.actor_label(idx)),
            events: event_types(&r),
        })
    }

    // ---- stake top-up / withdraw (operator) ----
    fn do_stake(&mut self) -> Result<Outcome> {
        if self.pools.is_empty() {
            return Ok(Outcome::Skipped("no validator pool".into()));
        }
        let p = self.rng.pick_index(self.pools.len()).unwrap();
        let pool = self.pools[p].clone();

        // Withdraw only from a non-vouching, active pool (simple free-stake math).
        if self.rng.flip() {
            if let Ok(v) = self.client.pool_view(&pool) {
                // ACTIVE, no vouches, with free stake above the chunk (`free =
                // stake − locked`, I-V1) — keeps the withdraw within the floor.
                let free = v.stake.saturating_sub(v.locked);
                if v.status == 0 && v.active_vouches == 0 && free > STAKE_CHUNK {
                    let cap = self.caps[p].clone();
                    let args = vec![
                        "--move-call".into(),
                        format!("{}::validator::withdraw_stake", self.gally),
                        format!("@{pool}"),
                        format!("@{cap}"),
                        format!("@{}", self.config_id),
                        format!("{}u64", STAKE_CHUNK),
                        "--assign".into(),
                        "w".into(),
                        "--transfer-objects".into(),
                        "[w]".into(),
                        format!("@{}", self.op.address),
                    ];
                    let r = self.exec_op(&args)?;
                    return Ok(Outcome::Acted {
                        detail: format!("withdrew {STAKE_CHUNK} from pool {}", short(&pool)),
                        events: event_types(&r),
                    });
                }
            }
        }
        // Otherwise add stake (always safe, permissionless).
        let mut args = self.mint(STAKE_CHUNK, "s");
        args.extend([
            "--move-call".into(),
            format!("{}::validator::add_stake", self.gally),
            format!("@{pool}"),
            "s".into(),
        ]);
        let r = self.exec_op(&args)?;
        Ok(Outcome::Acted {
            detail: format!("added {STAKE_CHUNK} stake to pool {}", short(&pool)),
            events: event_types(&r),
        })
    }

    // ---- sweep rollover (permissionless) ----
    fn do_sweep_rollover(&mut self) -> Result<Outcome> {
        for a in self.assets.clone() {
            if let (Some(acc), Some(t)) = (&a.accumulator_id, &a.token_type) {
                if let Ok(v) = self.client.accumulator_view(acc) {
                    if action::can_sweep_rollover(&v) {
                        let args = vec![
                            "--move-call".into(),
                            format!("{}::accumulator::sweep_rollover<{t}>", self.gally),
                            format!("@{acc}"),
                        ];
                        let r = self.exec_op(&args)?;
                        return Ok(Outcome::Acted {
                            detail: format!("swept rollover on {}", short(&a.id)),
                            events: event_types(&r),
                        });
                    }
                }
            }
        }
        Ok(Outcome::Skipped("no accumulator with parked rollover".into()))
    }

    // ---- sweep compensation (permissionless, after grace) ----
    fn do_sweep_compensation(&mut self) -> Result<Outcome> {
        let now = now_ms();
        for a in self.assets.clone() {
            if let (Some(acc), Some(t)) = (&a.accumulator_id, &a.token_type) {
                if let Ok(v) = self.client.accumulator_view(acc) {
                    if action::can_sweep_compensation(&v, now) {
                        let args = vec![
                            "--move-call".into(),
                            format!("{}::accumulator::sweep_compensation<{t}>", self.gally),
                            format!("@{acc}"),
                            "@0x6".into(),
                        ];
                        let r = self.exec_op(&args)?;
                        return Ok(Outcome::Acted {
                            detail: format!("swept compensation on {}", short(&a.id)),
                            events: event_types(&r),
                        });
                    }
                }
            }
        }
        Ok(Outcome::Skipped("no compensation pool past its grace window".into()))
    }

    // ---- flag default (permissionless) ----
    fn do_flag_default(&mut self, assets: &[(usize, crate::sui_client::AssetView)]) -> Result<Outcome> {
        let now = now_ms();
        let cands: Vec<usize> = assets
            .iter()
            .filter(|(_, v)| action::can_flag_default(v, now))
            .map(|(i, _)| *i)
            .filter(|i| self.acc_token_for(&self.assets[*i].id).is_some())
            .collect();
        if cands.is_empty() {
            return Ok(Outcome::Skipped("no EXECUTING asset past its tranche deadline".into()));
        }
        let ai = cands[self.rng.pick_index(cands.len()).unwrap()];
        let asset_id = self.assets[ai].id.clone();
        let (acc, t) = self.acc_token_for(&asset_id).unwrap();
        let args = vec![
            "--move-call".into(),
            format!("{}::asset::flag_default<{t}>", self.gally),
            format!("@{asset_id}"),
            format!("@{acc}"),
            format!("@{}", self.config_id),
            "@0x6".into(),
        ];
        let r = self.exec_op(&args)?;
        Ok(Outcome::Acted {
            detail: format!("flagged default on {} → COMPENSATING", short(&asset_id)),
            events: event_types(&r),
        })
    }

    // ---- close a swept COMPENSATING asset (permissionless) ----
    fn do_close(&mut self, assets: &[(usize, crate::sui_client::AssetView)]) -> Result<Outcome> {
        let now = now_ms();
        for (i, v) in assets {
            if v.state != action::ST_COMPENSATING {
                continue;
            }
            if let Some((acc, t)) = self.acc_token_for(&self.assets[*i].id) {
                if let Ok(av) = self.client.accumulator_view(&acc) {
                    if action::can_close_after_compensation(v, &av, now) {
                        let asset_id = self.assets[*i].id.clone();
                        let args = vec![
                            "--move-call".into(),
                            format!("{}::asset::close_after_compensation<{t}>", self.gally),
                            format!("@{asset_id}"),
                            format!("@{acc}"),
                            format!("@{}", self.config_id),
                            "@0x6".into(),
                        ];
                        let r = self.exec_op(&args)?;
                        return Ok(Outcome::Acted {
                            detail: format!("closed {} (post-compensation)", short(&asset_id)),
                            events: event_types(&r),
                        });
                    }
                }
            }
        }

        // Fallback: end-of-life wind-down (admin + entity co-sign) of an
        // OPERATIONAL asset on which some actor already holds a GallyShare — this
        // is the only path that leaves a redeemable deed on a CLOSED accumulator,
        // so `redeem_share` (ShareRedeemed) becomes reachable afterwards.
        if let Some(admin) = self.cfg.admin_cap_id.clone() {
            let operational: BTreeSet<String> = assets
                .iter()
                .filter(|(_, v)| v.state == action::ST_OPERATIONAL)
                .map(|(i, _)| self.assets[*i].id.clone())
                .collect();
            for (idx, sid) in self.scan("::share::GallyShare") {
                let _ = idx;
                let aid = match self.object_asset_id(&sid) {
                    Some(a) => a,
                    None => continue,
                };
                if !operational.contains(&aid) {
                    continue;
                }
                let ai = match self.assets.iter().position(|a| a.id == aid) {
                    Some(i) => i,
                    None => continue,
                };
                let cap = match &self.assets[ai].entity_cap_id {
                    Some(c) => c.clone(),
                    None => continue,
                };
                let (acc, t) = match self.acc_token_for(&aid) {
                    Some(x) => x,
                    None => continue,
                };
                let args = vec![
                    "--move-call".into(),
                    format!("{}::asset::close_wind_down<{t}>", self.gally),
                    format!("@{aid}"),
                    format!("@{acc}"),
                    format!("@{}", self.config_id),
                    format!("@{admin}"),
                    format!("@{cap}"),
                ];
                let r = self.exec_op(&args)?;
                return Ok(Outcome::Acted {
                    detail: format!("wound down {} (held deed now redeemable)", short(&aid)),
                    events: event_types(&r),
                });
            }
        }
        Ok(Outcome::Skipped("no swept COMPENSATING or wind-downable asset to close".into()))
    }

    // ---- governance (operator AdminCap) ----
    fn do_governance(&mut self) -> Result<Outcome> {
        let admin = match &self.cfg.admin_cap_id {
            Some(a) => a.clone(),
            None => return Ok(Outcome::Skipped("ADMIN_CAP_ID unset".into())),
        };
        let use_pause = self.rng.below(3) == 0; // ~1/3 of the time, a paired stop+resume
        let plan = action::governance_plan(use_pause, self.rng.next_u64());
        let mut events = Vec::new();
        for step in plan {
            let args = match step {
                GovStep::EmergencyStop => vec![
                    "--move-call".into(),
                    format!("{}::protocol::admin_emergency_stop", self.gally),
                    format!("@{}", self.config_id),
                    format!("@{admin}"),
                ],
                GovStep::Resume => vec![
                    "--move-call".into(),
                    format!("{}::protocol::admin_resume", self.gally),
                    format!("@{}", self.config_id),
                    format!("@{admin}"),
                ],
                GovStep::SetMinWrapMs(ms) => vec![
                    "--move-call".into(),
                    format!("{}::protocol::admin_set_min_wrap_duration_ms", self.gally),
                    format!("@{}", self.config_id),
                    format!("@{admin}"),
                    format!("{ms}u64"),
                ],
                GovStep::SetFeeBps(bps) => vec![
                    "--move-call".into(),
                    format!("{}::protocol::admin_set_fee_bps", self.gally),
                    format!("@{}", self.config_id),
                    format!("@{admin}"),
                    format!("{bps}u64"),
                ],
            };
            events.extend(event_types(&self.exec_op(&args)?));
        }
        Ok(Outcome::Acted {
            detail: if use_pause { "governance: emergency-stop + resume".into() } else { "governance: param tweak".into() },
            events,
        })
    }

    // ---- redeem a share on a CLOSED accumulator (holder) ----
    fn do_redeem(&mut self) -> Result<Outcome> {
        let shares = self.scan("::share::GallyShare");
        for (idx, sid) in shares {
            if let Some(aid) = self.object_asset_id(&sid) {
                if let Some((acc, t)) = self.acc_token_for(&aid) {
                    if self
                        .client
                        .accumulator_view(&acc)
                        .map(|v| action::can_redeem(&v))
                        .unwrap_or(false)
                    {
                        let addr = self.actor_addr(idx).to_string();
                        let args = vec![
                            "--move-call".into(),
                            format!("{}::accumulator::redeem_share<{t}>", self.gally),
                            format!("@{acc}"),
                            format!("@{sid}"),
                            "--assign".into(),
                            "r".into(),
                            "--transfer-objects".into(),
                            "[r]".into(),
                            format!("@{addr}"),
                        ];
                        let r = self.exec_as(idx, &args)?;
                        return Ok(Outcome::Acted {
                            detail: format!("{} redeemed a share on closed {}", self.actor_label(idx), short(&aid)),
                            events: event_types(&r),
                        });
                    }
                }
            }
        }
        Ok(Outcome::Skipped("no share on a CLOSED accumulator".into()))
    }

    // ---- dispute lifecycle (accelerated only — synchronous open→vote→resolve) ----
    fn do_dispute(&mut self, assets: &[(usize, crate::sui_client::AssetView)]) -> Result<Outcome> {
        if self.cfg.pace != Pace::Accelerated {
            return Ok(Outcome::Skipped(
                "disputes only in --pace accelerated (the window would freeze the voucher for days)".into(),
            ));
        }
        let cands: Vec<usize> = assets
            .iter()
            .filter(|(_, v)| action::can_open_dispute(v))
            .map(|(i, _)| *i)
            .filter(|i| self.acc_token_for(&self.assets[*i].id).is_some())
            .collect();
        if cands.is_empty() {
            return Ok(Outcome::Skipped("no disputable asset with coverage".into()));
        }
        let ai = cands[self.rng.pick_index(cands.len()).unwrap()];
        let asset_id = self.assets[ai].id.clone();
        let (acc, t) = self.acc_token_for(&asset_id).unwrap();
        let view = &assets.iter().find(|(i, _)| *i == ai).unwrap().1;
        let target_pool = view.validator_pool_id.clone().unwrap();

        // read the bond amount from config.
        let bond = self
            .client
            .get_object_fields(&self.config_id)?
            .get("challenger_bond")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(1_000_000_000);

        // challenger = a random user; operator gifts the exact bond.
        let uidx = 1 + self.rng.pick_index(self.users.len()).unwrap();
        let user = self.actor_addr(uidx).to_string();
        let gift = self
            .mint(bond, "b")
            .into_iter()
            .chain(["--transfer-objects".into(), "[b]".into(), format!("@{user}")])
            .collect::<Vec<_>>();
        self.exec_op(&gift)?;
        let bond_coin = self
            .client
            .get_coins(&user, &self.usdc_type, 20)?
            .into_iter()
            .find(|c| c.balance == bond)
            .ok_or_else(|| anyhow!("no exact-bond coin after gift"))?;

        // 1. open (user as challenger).
        let mut events = Vec::new();
        let mut oargs = vec![
            "--move-call".into(),
            format!("{}::asset::new_walrus_ref", self.gally),
            "vector[7u8,7u8]".into(),
            "vector[8u8,8u8]".into(),
            "--assign".into(),
            "ev".into(),
        ];
        oargs.extend([
            "--move-call".into(),
            format!("{}::dispute::initialize_dispute<{t}>", self.gally),
            format!("@{asset_id}"),
            format!("@{target_pool}"),
            format!("@{acc}"),
            format!("@{}", self.config_id),
            format!("@{}", bond_coin.id),
            "ev".into(),
            "@0x6".into(),
        ]);
        let open = self.exec_as(uidx, &oargs)?;
        events.extend(event_types(&open));
        let dispute_id = created_object_id(&open, "::dispute::Dispute")
            .ok_or_else(|| anyhow!("dispute open: no Dispute created"))?;

        // 2. jurors (operator pools that are NOT the target) vote.
        for (p, pool) in self.pools.clone().iter().enumerate() {
            if *pool == target_pool {
                continue;
            }
            let vcap = self.caps[p].clone();
            let args = vec![
                "--move-call".into(),
                format!("{}::dispute::vote_on_dispute", self.gally),
                format!("@{dispute_id}"),
                format!("@{pool}"),
                format!("@{vcap}"),
                format!("@{}", self.config_id),
                "true".into(),
                "@0x6".into(),
            ];
            match self.exec_op(&args) {
                Ok(v) => events.extend(event_types(&v)),
                Err(e) => warn!(error = %e, "juror vote failed — continuing"),
            }
        }

        // 3. wait out the (short, accelerated) window, then resolve (permissionless).
        let window = self
            .client
            .get_object_fields(&self.config_id)?
            .get("dispute_window_ms")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(5_000);
        std::thread::sleep(Duration::from_millis(window + 2_000));
        let rargs = vec![
            "--move-call".into(),
            format!("{}::dispute::resolve_dispute<{t}>", self.gally),
            format!("@{dispute_id}"),
            format!("@{target_pool}"),
            format!("@{asset_id}"),
            format!("@{acc}"),
            format!("@{}", self.config_id),
            "@0x6".into(),
        ];
        events.extend(event_types(&self.exec_op(&rargs)?));

        Ok(Outcome::Acted {
            detail: format!("ran dispute lifecycle on {} ({} jurors)", short(&asset_id), self.pools.len().saturating_sub(1)),
            events,
        })
    }
}

/// Short id form for logs (`0x1234… abcd` → `0x1234…`).
fn short(id: &str) -> String {
    if id.len() > 10 {
        format!("{}…", &id[..10])
    } else {
        id.to_string()
    }
}
