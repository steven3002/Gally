//! `--showcase`: a CURATED, judge-facing dataset (distinct from the random `--daemon`
//! soak and the one-per-state `--seed-all` genesis). Built deterministically:
//!
//!   • K validators with a reputation spread (two are later slashed by upheld disputes);
//!   • `HEADLINE` assets, each fully funded by ≥`INVESTORS_PER_HEADLINE` DISTINCT cohort
//!     investors (the entity/creator — the operator — never invests), milestone proof
//!     approved + the tranche disbursed (OPERATIONAL), revenue deposited; then most
//!     investors convert receipts → deeds, some claim yield, some wrap into Coin<T>
//!     (unclaimed yield + unconverted receipts are left behind on purpose);
//!   • `OPEN` assets with an Oct-1-2026 deadline, partially pre-funded so judges can
//!     fund the rest and watch the bar move;
//!   • 6 disputes — 2 REJECTED, 2 UPHELD (validator slashed), 2 left OPEN (voting);
//!   • a governance param tweak + a pause→resume, for the governance page.
//!
//! Reuses the operator + cohort + PTB primitives. Each finalized asset consumes one
//! pooled entity token (SIM-D4): the pool must hold ≥ (HEADLINE + DISPUTE_COUNT) unused
//! tokens, or seeding aborts with a clear message. Idempotent at the run level
//! (`sim_state.showcase_done`); per-tick failures are contained (logged, never panic).

use std::thread::sleep;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use tracing::{info, warn};

use crate::catalog;
use crate::config::{Config, Operational};
use crate::gas::{self, GasBudget};
use crate::keys::Keypair;
use crate::ptb;
use crate::sim_state::{EntityToken, SimState};
use crate::sui_client::{created_object_id, created_object_id_contains, SuiClient};

// --- scenario shape ----------------------------------------------------------------
const VALIDATORS: usize = 6;
const HEADLINE: usize = 5;
const INVESTORS_PER_HEADLINE: usize = 30;
const OPEN_COUNT: usize = 3;
const DISPUTE_COUNT: usize = 6; // 2 rejected, 2 upheld, 2 pending

/// Per-headline post-finalize holder activity (subsets of the 30 investors).
const CLAIM_DEEDS: usize = 20; // convert receipt → GallyShare (become holders)
const CLAIM_YIELD: usize = 8; // of the deed-holders, claim accrued yield
const WRAP: usize = 5; // of the deed-holders, wrap into Coin<T>

// --- economics (μUSDC) -------------------------------------------------------------
const HEADLINE_GOAL: u64 = 30_000_000_000; // 30k → 30 investors × 1k
const DISPUTE_GOAL: u64 = 20_000_000_000; // 20k → 2 investors × 10k (just enough to finalize)
const OPEN_GOAL: u64 = 100_000_000_000; // 100k headline goal; partially filled
const OPEN_FILL_BPS: [u64; OPEN_COUNT] = [4_000, 6_000, 8_000]; // 40% / 60% / 80%
const REVENUE_GROSS: u64 = 8_000_000_000; // 8k revenue per headline → non-zero yield index
const CHALLENGER_BOND: u64 = 1_000_000_000; // 1k (matches the jury params set below)
const REVENUE_SPLIT_BPS: u64 = 5_000; // 50% to investors
const ENTITY_COLLATERAL_BPS: u64 = 1_500; // 15% of goal (≥10% min)
const VALIDATOR_STAKE_BASE: u64 = 50_000_000_000; // 50k ≥ max(min 10k, 20% coverage)

// --- deadlines (ms) ----------------------------------------------------------------
const OCT_1_2026_MS: u64 = 1_790_812_800_000; // 2026-10-01T00:00:00Z — judge-facing open raises
const FAR_TRANCHE_MS: u64 = 4_102_448_400_000; // ~year 2100
const SHORT_WINDOW_MS: u64 = 8_000; // dispute window for the resolved disputes
const LONG_WINDOW_MS: u64 = 2_592_000_000; // 30d — the "still voting" disputes stay open for judges

// --- gas ---------------------------------------------------------------------------
const OP_GAS: u64 = 500_000_000; // operator PTB gas budget
const USER_GAS: u64 = 120_000_000; // cohort-user PTB gas budget (a contribute costs far less)
/// Per-user SUI grant target: must exceed `USER_GAS` so the CLI gas selector finds a coin
/// ≥ the declared budget (the root cause of the earlier "empty holders" bug — memory).
const USER_GAS_GRANT: u64 = 300_000_000;

/// Dispute targets get distinct names (the catalog has 8 entries; headline+open use them).
const DISPUTE_NAMES: [(&str, &str); DISPUTE_COUNT] = [
    ("Harbour Point Terminal", "HPT"),
    ("Sahel Solar Microgrid", "SSM"),
    ("Volta Textile Mill", "VTM"),
    ("Coral Bay Desalination", "CBD"),
    ("Highland Coffee Co-op", "HCC"),
    ("Riverside Grain Silos", "RGS"),
];

/// Dispute outcome to drive.
#[derive(Clone, Copy, PartialEq)]
enum Verdict {
    Rejected,
    Upheld,
    Pending,
}

struct Showcase<'a> {
    client: &'a SuiClient,
    op: &'a Operational,
    cohort: &'a [Keypair],
    config_id: String,
    admin_cap: String,
    gally: String,
    usdc: String,     // `<usdc_pkg>::usdc::USDC`
    usdc_cap: String, // TreasuryCap<USDC>
    sim_path: String,
    /// Cursor into `cohort` so each asset draws a DISJOINT slice of investors.
    cursor: usize,
    grant: GasBudget,
}

impl<'a> Showcase<'a> {
    // ---- low-level exec ----
    fn exec_op(&self, args: &[String]) -> Result<Value> {
        let bytes = ptb::build_unsigned(&self.op.address, OP_GAS, args)?;
        self.client.sign_and_execute(&bytes, &self.op.keypair)
    }
    fn exec_as(&self, kp: &Keypair, args: &[String]) -> Result<Value> {
        let bytes = ptb::build_unsigned(&kp.address, USER_GAS, args)?;
        self.client.sign_and_execute(&bytes, kp)
    }
    /// PTB fragment: operator mints `amount` Mock USDC, bound to `var`.
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

    /// Reserve the next `n` cohort users (disjoint slice) and ensure each has gas.
    fn take_investors(&mut self, n: usize) -> Vec<&'a Keypair> {
        let start = self.cursor % self.cohort.len();
        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            out.push(&self.cohort[(start + i) % self.cohort.len()]);
        }
        self.cursor += n;
        let addrs: Vec<String> = out.iter().map(|k| k.address.clone()).collect();
        gas::fund_users_from_operator(self.client, &self.op.keypair, &addrs, &self.grant);
        out
    }

    /// Operator gifts `amount` USDC to `user`, then `user` contributes it. Returns the
    /// `ContributionReceipt` id (so it can later be converted to a deed).
    fn gift_and_contribute(&self, user: &Keypair, asset: &str, amount: u64) -> Result<Option<String>> {
        let gift = self
            .mint(amount, "g")
            .into_iter()
            .chain(["--transfer-objects".into(), "[g]".into(), format!("@{}", user.address)])
            .collect::<Vec<_>>();
        self.exec_op(&gift).context("gifting USDC to investor")?;

        let coin = self
            .client
            .get_coins(&user.address, &self.usdc, 10)?
            .into_iter()
            .max_by_key(|c| c.balance)
            .ok_or_else(|| anyhow!("investor has no USDC after gift"))?;
        let r = self.exec_as(
            user,
            &[
                "--move-call".into(),
                format!("{}::asset::contribute_capital", self.gally),
                format!("@{asset}"),
                format!("@{}", self.config_id),
                "@0x6".into(),
                format!("@{}", coin.id),
                "--assign".into(),
                "change".into(),
                "--transfer-objects".into(),
                "[change]".into(),
                format!("@{}", user.address),
            ],
        )?;
        Ok(created_object_id(&r, "::asset::ContributionReceipt"))
    }

    /// Fund `asset` to `goal` across `investors`, each an equal slice (last covers the
    /// remainder). Returns the per-investor `(keypair, receipt_id)` for later conversion.
    fn fund_to_goal<'k>(
        &self,
        asset: &str,
        goal: u64,
        investors: &[&'k Keypair],
    ) -> Vec<(&'k Keypair, String)> {
        let n = investors.len() as u64;
        let mut funded = 0u64;
        let mut receipts = Vec::new();
        for (i, inv) in investors.iter().enumerate() {
            let slice = if i + 1 == investors.len() {
                goal.saturating_sub(funded)
            } else {
                goal / n
            };
            if slice == 0 {
                break;
            }
            match self.gift_and_contribute(inv, asset, slice) {
                Ok(Some(rid)) => {
                    receipts.push((*inv, rid));
                    funded += slice;
                }
                Ok(None) => {
                    funded += slice;
                    warn!("contribute returned no receipt id (continuing)");
                }
                Err(e) => warn!(error = %e, "investor contribution failed (continuing)"),
            }
        }
        receipts
    }

    // ---- validators (reputation spread) ----
    fn register_validators(&self, st: &mut SimState) -> Result<()> {
        while st.validator_pools.len() < VALIDATORS {
            let n = st.validator_pools.len();
            // Spread the stake so the validators page isn't uniform.
            let stake = VALIDATOR_STAKE_BASE + (VALIDATORS - n) as u64 * 5_000_000_000;
            let mut args = self.mint(stake, "stake");
            args.extend([
                "--move-call".into(),
                format!("{}::validator::register_validator", self.gally),
                format!("@{}", self.config_id),
                "stake".into(),
                catalog::str_literal(catalog::validator_name(n)),
                "@0x6".into(),
            ]);
            let r = self.exec_op(&args)?;
            let pool = created_object_id(&r, "::validator::ValidatorPool")
                .ok_or_else(|| anyhow!("register: no ValidatorPool"))?;
            let vcap = created_object_id(&r, "::validator::ValidatorCap")
                .ok_or_else(|| anyhow!("register: no ValidatorCap"))?;
            info!(pool = %pool, n = n + 1, "showcase validator registered");
            st.validator_pools.push(pool);
            st.validator_caps.push(vcap);
            st.save(&self.sim_path)?;
        }
        Ok(())
    }

    /// Register ONE fresh ACTIVE validator with `stake` and return its (pool, cap) ids.
    /// Used by `--extra-headlines`: the genesis validators may be FROZEN (unresolved
    /// disputes) or SLASHED, so a new asset needs a guaranteed-ACTIVE voucher with full
    /// free stake (otherwise `lock_coverage` aborts with EValidatorNotActive/202).
    fn register_one_validator(&self, st: &mut SimState, stake: u64) -> Result<(String, String)> {
        let n = st.validator_pools.len();
        let mut args = self.mint(stake, "stake");
        args.extend([
            "--move-call".into(),
            format!("{}::validator::register_validator", self.gally),
            format!("@{}", self.config_id),
            "stake".into(),
            catalog::str_literal(catalog::validator_name(n)),
            "@0x6".into(),
        ]);
        let r = self.exec_op(&args)?;
        let pool = created_object_id(&r, "::validator::ValidatorPool")
            .ok_or_else(|| anyhow!("register: no ValidatorPool"))?;
        let vcap = created_object_id(&r, "::validator::ValidatorCap")
            .ok_or_else(|| anyhow!("register: no ValidatorCap"))?;
        info!(pool = %pool, "fresh coverage validator registered");
        st.validator_pools.push(pool.clone());
        st.validator_caps.push(vcap.clone());
        st.save(&self.sim_path)?;
        Ok((pool, vcap))
    }

    // ---- create + vouch ----
    /// create_asset (single tranche = goal) with metadata, then vouch via `voucher`.
    fn create_vouched(
        &self,
        meta_args: Vec<String>,
        goal: u64,
        deadline_ms: u64,
        voucher_pool: &str,
        voucher_cap: &str,
    ) -> Result<(String, String)> {
        let collateral = goal * ENTITY_COLLATERAL_BPS / 10_000;
        let mut create = self.mint(collateral, "col");
        create.extend([
            "--move-call".into(),
            format!("{}::asset::create_asset", self.gally),
            format!("@{}", self.config_id),
            format!("{goal}u64"),
            format!("{deadline_ms}u64"),
            format!("vector[{goal}u64]"),             // single tranche = goal
            "vector[vector[80u8,49u8]]".into(),       // tranche descriptions: ["P1"]
            format!("vector[{FAR_TRANCHE_MS}u64]"),   // tranche deadline
            format!("{REVENUE_SPLIT_BPS}u64"),
        ]);
        create.extend(meta_args); // name,ticker,category,location,entity_name,blob_id,sha256
        create.extend(["col".into(), "@0x6".into()]);
        let cr = self.exec_op(&create)?;
        let asset = created_object_id(&cr, "::asset::Asset")
            .ok_or_else(|| anyhow!("create_asset: no Asset"))?;
        let entity_cap = created_object_id(&cr, "::asset::EntityCap")
            .ok_or_else(|| anyhow!("create_asset: no EntityCap"))?;

        // vouch: new_walrus_ref → make-move-vec → vouch_asset_legals (PENDING_VOUCH→FUNDING)
        self.exec_op(&[
            "--move-call".into(),
            format!("{}::asset::new_walrus_ref", self.gally),
            "vector[1u8,2u8,3u8]".into(),
            "vector[9u8,9u8,9u8]".into(),
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
            format!("@{voucher_pool}"),
            format!("@{voucher_cap}"),
            format!("@{}", self.config_id),
            "docs".into(),
        ])?;
        Ok((asset, entity_cap))
    }

    fn finalize(&self, asset: &str, tok: &EntityToken) -> Result<String> {
        let r = self.exec_op(&[
            "--move-call".into(),
            format!("{}::asset::finalize_successful_raise<{}>", self.gally, tok.type_tag()),
            format!("@{asset}"),
            format!("@{}", self.config_id),
            format!("@{}", tok.treasury_cap_id),
            format!("@{}", tok.metadata_id),
            "@0x6".into(),
        ])?;
        created_object_id_contains(&r, "::accumulator::GlobalYieldAccumulator")
            .ok_or_else(|| anyhow!("finalize: no accumulator"))
    }

    /// Submit milestone proof → approve → release the (single) tranche → OPERATIONAL.
    fn release_tranche(&self, asset: &str, entity_cap: &str, pool: &str, vcap: &str) -> Result<()> {
        self.exec_op(&[
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
        self.exec_op(&[
            "--move-call".into(),
            format!("{}::asset::approve_milestone", self.gally),
            format!("@{asset}"),
            format!("@{pool}"),
            format!("@{vcap}"),
            format!("@{}", self.config_id),
            "0u64".into(),
        ])?;
        self.exec_op(&[
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

    fn deposit_revenue(&self, asset: &str, acc: &str, tok: &EntityToken, gross: u64) -> Result<()> {
        let mut args = self.mint(gross, "rev");
        args.extend([
            "--move-call".into(),
            format!("{}::asset::deposit_revenue<{}>", self.gally, tok.type_tag()),
            format!("@{asset}"),
            format!("@{acc}"),
            format!("@{}", self.config_id),
            "rev".into(),
        ]);
        self.exec_op(&args)?;
        Ok(())
    }

    /// Convert a receipt → deed (GallyShare) for `user`. Returns the share id.
    fn claim_deed(&self, user: &Keypair, asset: &str, acc: &str, tok: &EntityToken, receipt: &str) -> Result<String> {
        let r = self.exec_as(
            user,
            &[
                "--move-call".into(),
                format!("{}::asset::claim_shares<{}>", self.gally, tok.type_tag()),
                format!("@{asset}"),
                format!("@{acc}"),
                format!("@{}", self.config_id),
                format!("@{receipt}"),
                "@0x6".into(),
                "--assign".into(),
                "sh".into(),
                "--transfer-objects".into(),
                "[sh]".into(),
                format!("@{}", user.address),
            ],
        )?;
        created_object_id(&r, "::share::GallyShare").ok_or_else(|| anyhow!("claim_shares: no GallyShare"))
    }

    fn claim_yield(&self, user: &Keypair, acc: &str, tok: &EntityToken, share: &str) -> Result<()> {
        self.exec_as(
            user,
            &[
                "--move-call".into(),
                format!("{}::accumulator::claim_rewards<{}>", self.gally, tok.type_tag()),
                format!("@{acc}"),
                format!("@{share}"),
                "--assign".into(),
                "r".into(),
                "--transfer-objects".into(),
                "[r]".into(),
                format!("@{}", user.address),
            ],
        )?;
        Ok(())
    }

    /// wrap_shares<T> returns (Coin<T>, Coin<USDC> force-claimed yield) → keep both.
    fn wrap(&self, user: &Keypair, acc: &str, tok: &EntityToken, share: &str) -> Result<()> {
        self.exec_as(
            user,
            &[
                "--move-call".into(),
                format!("{}::accumulator::wrap_shares<{}>", self.gally, tok.type_tag()),
                format!("@{acc}"),
                format!("@{}", self.config_id),
                format!("@{share}"),
                "@0x6".into(),
                "--assign".into(),
                "w".into(),
                "--transfer-objects".into(),
                "[w.0,w.1]".into(),
                format!("@{}", user.address),
            ],
        )?;
        Ok(())
    }

    // ---- disputes ----
    fn set_dispute_window(&self, window_ms: u64) -> Result<()> {
        self.exec_op(&[
            "--move-call".into(),
            format!("{}::protocol::admin_set_dispute_params", self.gally),
            format!("@{}", self.config_id),
            format!("@{}", self.admin_cap),
            format!("{CHALLENGER_BOND}u64"),
            "3u64".into(),     // jury_quorum
            "6667u64".into(),  // jury_threshold_bps
            "10000000000u64".into(), // jury_min_stake (10k)
            "1000u64".into(),  // challenger_bounty_bps
            format!("{window_ms}u64"),
            "5000u64".into(),  // compensation_grace_ms
        ])?;
        Ok(())
    }

    /// Open a dispute on `asset` (challenger = a cohort user posting the bond), have the
    /// non-target validator pools vote `guilty`, and — unless `Pending` — resolve it.
    #[allow(clippy::too_many_arguments)]
    fn run_dispute(
        &self,
        asset: &str,
        acc: &str,
        tok: &EntityToken,
        target_idx: usize,
        st: &SimState,
        challenger: &Keypair,
        verdict: Verdict,
        reason: &str,
    ) -> Result<()> {
        let target_pool = st.validator_pools[target_idx].clone();
        // bond → challenger, then challenger opens the dispute with evidence.
        let gift = self
            .mint(CHALLENGER_BOND, "b")
            .into_iter()
            .chain(["--transfer-objects".into(), "[b]".into(), format!("@{}", challenger.address)])
            .collect::<Vec<_>>();
        self.exec_op(&gift)?;
        let bond = self
            .client
            .get_coins(&challenger.address, &self.usdc, 10)?
            .into_iter()
            .find(|c| c.balance >= CHALLENGER_BOND)
            .ok_or_else(|| anyhow!("challenger has no bond coin"))?;
        let open = self.exec_as(
            challenger,
            &[
                "--move-call".into(),
                format!("{}::asset::new_walrus_ref", self.gally),
                "vector[7u8,7u8,7u8]".into(),
                "vector[8u8,8u8,8u8]".into(),
                "--assign".into(),
                "ev".into(),
                "--move-call".into(),
                format!("{}::dispute::initialize_dispute<{}>", self.gally, tok.type_tag()),
                format!("@{asset}"),
                format!("@{target_pool}"),
                format!("@{acc}"),
                format!("@{}", self.config_id),
                format!("@{}", bond.id),
                "ev".into(),
                catalog::str_literal(reason),
                "@0x6".into(),
            ],
        )?;
        let dispute = created_object_id(&open, "::dispute::Dispute")
            .ok_or_else(|| anyhow!("dispute: no Dispute created"))?;
        info!(dispute = %dispute, target = target_idx, "dispute opened");

        // Jurors: every other validator pool votes. Upheld ⇒ guilty, Rejected ⇒ innocent.
        // Pending ⇒ a single early vote, then leave open (window is long).
        let guilty = matches!(verdict, Verdict::Upheld);
        let mut votes = 0;
        for (i, pool) in st.validator_pools.iter().enumerate() {
            if i == target_idx {
                continue;
            }
            if verdict == Verdict::Pending && votes >= 1 {
                break; // keep it visibly "in progress"
            }
            let r = self.exec_op(&[
                "--move-call".into(),
                format!("{}::dispute::vote_on_dispute", self.gally),
                format!("@{dispute}"),
                format!("@{pool}"),
                format!("@{}", st.validator_caps[i]),
                format!("@{}", self.config_id),
                format!("{guilty}"),
                "@0x6".into(),
            ]);
            match r {
                Ok(_) => votes += 1,
                Err(e) => warn!(error = %e, "juror vote failed (continuing)"),
            }
            if votes >= 4 {
                break;
            }
        }

        if verdict == Verdict::Pending {
            info!(dispute = %dispute, votes, "dispute left OPEN (voting)");
            return Ok(());
        }

        // Wait out the short window, then resolve (permissionless).
        sleep(Duration::from_millis(SHORT_WINDOW_MS + 2_000));
        self.exec_op(&[
            "--move-call".into(),
            format!("{}::dispute::resolve_dispute<{}>", self.gally, tok.type_tag()),
            format!("@{dispute}"),
            format!("@{target_pool}"),
            format!("@{asset}"),
            format!("@{acc}"),
            format!("@{}", self.config_id),
            "@0x6".into(),
        ])?;
        let outcome = if guilty { "UPHELD" } else { "REJECTED" };
        info!(dispute = %dispute, outcome, votes, "dispute resolved");
        Ok(())
    }
}

/// Fresh names for `--extra-headlines` (distinct from the catalog's headline/open/dispute
/// projects, so the explorer shows no confusing duplicates).
const EXTRA_NAMES: [(&str, &str); 6] = [
    ("Marina Bay Residences", "MBR"),
    ("Ogun Ceramics Plant", "OCP"),
    ("Niger Delta Logistics", "NDL"),
    ("Plateau Dairy Farms", "PDF"),
    ("Cross River Hydro", "CRH"),
    ("Lagos Metro Depot", "LMD"),
];

/// Entry point for `--extra-headlines`: append OPERATIONAL assets whose ENTIRE investor
/// set converts receipts → deeds, so each asset shows ≥`EXTRA_INVESTORS` holders (the
/// ledger counts deed owners). Distinct from `run_showcase` (which caps deed-claims at
/// `CLAIM_DEEDS`) and NOT gated by `showcase_done` — it appends to the existing dataset,
/// reusing the validators + the entity-token pool. Per-tick failures are contained.
pub fn run_extra_headlines(client: &SuiClient, cfg: &Config) -> Result<()> {
    let op = cfg.operator().context("operator context for extra headlines")?;
    let config_id = cfg
        .protocol_config_id
        .clone()
        .ok_or_else(|| anyhow!("PROTOCOL_CONFIG_ID unset"))?;
    let admin_cap = cfg.admin_cap_id.clone().ok_or_else(|| anyhow!("ADMIN_CAP_ID unset"))?;

    let mut st = SimState::load(&cfg.sim_state_path);
    let cohort = crate::keys::load_or_generate_users(&cfg.user_keys_path, cfg.user_count)?;

    let name_offset = env_usize("EXTRA_NAME_OFFSET", 0);
    let count = env_usize("EXTRA_HEADLINES", 3).min(EXTRA_NAMES.len().saturating_sub(name_offset));
    let investors = env_usize("EXTRA_INVESTORS", 42);
    let claim_yield = env_usize("EXTRA_CLAIM_YIELD", 12);
    let wrap = env_usize("EXTRA_WRAP", 0); // default 0: keep every deed (guarantee holder count)
    info!(count, investors, name_offset, cohort = cohort.len(), "extra-headlines scale");

    let grant = GasBudget {
        per_user_grant_mist: USER_GAS_GRANT,
        operator_reserve_mist: 2_000_000_000,
        per_asset_mist: 0,
    };

    let mut sc = Showcase {
        client,
        op: &op,
        cohort: &cohort,
        config_id,
        admin_cap,
        gally: op.gally_package_id.clone(),
        usdc: format!("{}::usdc::USDC", op.usdc_package_id),
        usdc_cap: op.usdc_treasury_cap_id.clone(),
        sim_path: cfg.sim_state_path.clone(),
        cursor: 0,
        grant,
    };

    if cohort.len() < investors {
        return Err(anyhow!("cohort too small ({}); set USER_COUNT ≥ {investors}", cohort.len()));
    }
    let tokens_left = st.entity_tokens.len().saturating_sub(st.entity_tokens_used);
    if tokens_left < count {
        return Err(anyhow!(
            "extra-headlines needs {count} unused entity tokens but only {tokens_left} remain — \
             publish more entity_token_template copies and append them to sim_state"
        ));
    }

    // Short min-wrap so any wraps land in-session.
    sc.exec_op(&[
        "--move-call".into(),
        format!("{}::protocol::admin_set_min_wrap_duration_ms", sc.gally),
        format!("@{}", sc.config_id),
        format!("@{}", sc.admin_cap),
        "1000u64".into(),
    ])
    .ok();

    let goal: u64 = investors as u64 * 1_000_000_000; // 1k USDC each → exactly N distinct investors
    for (k, &(name, ticker)) in EXTRA_NAMES.iter().skip(name_offset).take(count).enumerate() {
        let meta = metadata_named(name_offset + k, name, ticker);
        info!(n = k + 1, name, "extra headline: register voucher + create + vouch");
        // Each new asset gets a FRESH ACTIVE validator as its voucher — the genesis
        // validators may be FROZEN (open disputes) or SLASHED, which aborts lock_coverage.
        let (pool, vcap) = sc.register_one_validator(&mut st, VALIDATOR_STAKE_BASE * 3)?;
        // Funding deadline must be strictly before the (internal) tranche deadline
        // (FAR_TRANCHE_MS), or create_asset aborts with EInvalidTrancheSchedule (308).
        let (asset, entity_cap) = sc.create_vouched(meta, goal, OCT_1_2026_MS, &pool, &vcap)?;
        st.showcase_assets.push(asset.clone());
        st.save(&sc.sim_path)?;

        let inv_slice = sc.take_investors(investors);
        let receipts = sc.fund_to_goal(&asset, goal, &inv_slice);
        info!(asset = %asset, contributors = receipts.len(), "extra headline funded");

        let tok = st.take_token().ok_or_else(|| anyhow!("entity token pool exhausted"))?;
        st.save(&sc.sim_path)?;
        let acc = sc.finalize(&asset, &tok)?;

        // The point of this pass: EVERY investor converts receipt → deed BEFORE revenue,
        // so the holder ledger shows the full cohort and they accrue claimable yield.
        let mut shares: Vec<(&Keypair, String)> = Vec::new();
        for (inv, rid) in receipts.iter() {
            match sc.claim_deed(inv, &asset, &acc, &tok, rid) {
                Ok(sid) => shares.push((inv, sid)),
                Err(e) => warn!(error = %e, "claim_shares failed (continuing)"),
            }
        }
        sc.release_tranche(&asset, &entity_cap, &pool, &vcap)?;
        sc.deposit_revenue(&asset, &acc, &tok, REVENUE_GROSS)?;

        // Some holders claim accrued yield (keeps the deed); optional wraps leave deeds.
        for (inv, sid) in shares.iter().take(claim_yield.min(shares.len())) {
            sc.claim_yield(inv, &acc, &tok, sid).unwrap_or_else(|e| warn!(error = %e, "claim_yield failed"));
        }
        if wrap > 0 {
            sleep(Duration::from_millis(1_200));
            for (inv, sid) in shares.iter().skip(claim_yield).take(wrap) {
                sc.wrap(inv, &acc, &tok, sid).unwrap_or_else(|e| warn!(error = %e, "wrap failed"));
            }
        }
        info!(asset = %asset, holders = shares.len(), "extra headline OPERATIONAL with deeds");
    }

    st.save(&sc.sim_path)?;
    info!(added = count, "✅ extra-headlines seeding complete");
    Ok(())
}

/// Read a `usize` scale knob from the environment (defaults keep the full scenario).
fn env_usize(key: &str, default: usize) -> usize {
    std::env::var(key).ok().and_then(|v| v.trim().parse().ok()).unwrap_or(default)
}

/// Build distinct metadata args from catalog entry `ordinal`, overriding name + ticker.
fn metadata_named(ordinal: usize, name: &str, ticker: &str) -> Vec<String> {
    let p = catalog::project(ordinal);
    let mut a = catalog::metadata_args(p); // [name,ticker,category,location,entity_name,blob_id,sha256]
    a[0] = catalog::str_literal(name);
    a[1] = catalog::str_literal(ticker);
    a
}

/// Entry point for `--showcase`.
pub fn run_showcase(client: &SuiClient, cfg: &Config) -> Result<()> {
    let op = cfg.operator().context("operator context for showcase")?;
    let config_id = cfg
        .protocol_config_id
        .clone()
        .ok_or_else(|| anyhow!("PROTOCOL_CONFIG_ID unset"))?;
    let admin_cap = cfg.admin_cap_id.clone().ok_or_else(|| anyhow!("ADMIN_CAP_ID unset"))?;

    let mut st = SimState::load(&cfg.sim_state_path);
    if st.showcase_done {
        info!("showcase already seeded (sim_state.showcase_done) — skipping");
        return Ok(());
    }

    let cohort = crate::keys::load_or_generate_users(&cfg.user_keys_path, cfg.user_count)?;
    info!(cohort = cohort.len(), "showcase cohort loaded");

    // Scenario scale — env-tunable so a fast smoke run can exercise every path, and an
    // operator can scale on devnet. Defaults reproduce the full curated dataset.
    let headline = env_usize("SHOWCASE_HEADLINE", HEADLINE);
    let investors = env_usize("SHOWCASE_INVESTORS", INVESTORS_PER_HEADLINE);
    let opens = env_usize("SHOWCASE_OPEN", OPEN_COUNT).min(OPEN_FILL_BPS.len());
    let disputes = env_usize("SHOWCASE_DISPUTES", DISPUTE_COUNT).min(DISPUTE_COUNT);
    info!(headline, investors, opens, disputes, "showcase scale");

    let grant = GasBudget {
        per_user_grant_mist: USER_GAS_GRANT,
        operator_reserve_mist: 2_000_000_000,
        per_asset_mist: 0,
    };

    let mut sc = Showcase {
        client,
        op: &op,
        cohort: &cohort,
        config_id,
        admin_cap,
        gally: op.gally_package_id.clone(),
        usdc: format!("{}::usdc::USDC", op.usdc_package_id),
        usdc_cap: op.usdc_treasury_cap_id.clone(),
        sim_path: cfg.sim_state_path.clone(),
        cursor: 0,
        grant,
    };

    // Token-pool capacity check (one per finalized asset).
    let need = headline + disputes;
    let have = sc.cohort.len();
    let tokens_left = st.entity_tokens.len().saturating_sub(st.entity_tokens_used);
    if tokens_left < need {
        return Err(anyhow!(
            "showcase needs {need} unused entity tokens but only {tokens_left} remain — publish more \
             entity_token_template copies (run_devnet.sh ENTITY_POOL_SIZE) and append them to sim_state"
        ));
    }
    if have < investors {
        return Err(anyhow!("cohort too small ({have}); set USER_COUNT ≥ {investors}"));
    }

    // Accelerate windows (short min-wrap so wraps land in-session; short vouch/grace).
    sc.exec_op(&[
        "--move-call".into(),
        format!("{}::protocol::admin_set_min_wrap_duration_ms", sc.gally),
        format!("@{}", sc.config_id),
        format!("@{}", sc.admin_cap),
        "1000u64".into(),
    ])
    .ok();
    sc.set_dispute_window(SHORT_WINDOW_MS).ok();

    sc.register_validators(&mut st)?;

    // ---- 1. headline assets (fully funded by ≥30 distinct investors) ----
    for i in 0..headline {
        let voucher = i % 2; // V0/V1 vouch the clean headline assets
        let p = catalog::project(i);
        let meta = catalog::metadata_args(p);
        info!(n = i + 1, "headline asset: create + vouch");
        let (asset, entity_cap) = sc.create_vouched(
            meta,
            HEADLINE_GOAL,
            OCT_1_2026_MS, // far enough; these finalize immediately anyway
            &st.validator_pools[voucher],
            &st.validator_caps[voucher],
        )?;
        st.showcase_assets.push(asset.clone());
        st.save(&sc.sim_path)?;

        let inv_slice = sc.take_investors(investors);
        let receipts = sc.fund_to_goal(&asset, HEADLINE_GOAL, &inv_slice);
        info!(asset = %asset, investors = receipts.len(), "headline funded");

        let tok = st.take_token().ok_or_else(|| anyhow!("entity token pool exhausted"))?;
        st.save(&sc.sim_path)?;
        let acc = sc.finalize(&asset, &tok)?;

        // Convert most receipts → deeds BEFORE revenue so they accrue claimable yield.
        let mut shares: Vec<(&Keypair, String)> = Vec::new();
        for (inv, rid) in receipts.iter().take(CLAIM_DEEDS) {
            match sc.claim_deed(inv, &asset, &acc, &tok, rid) {
                Ok(sid) => shares.push((inv, sid)),
                Err(e) => warn!(error = %e, "claim_shares failed (continuing)"),
            }
        }
        sc.release_tranche(&asset, &entity_cap, &st.validator_pools[voucher], &st.validator_caps[voucher])?;
        sc.deposit_revenue(&asset, &acc, &tok, REVENUE_GROSS)?;

        // Some holders claim yield; some wrap into Coin<T>; the rest leave it unclaimed.
        for (inv, sid) in shares.iter().take(CLAIM_YIELD) {
            sc.claim_yield(inv, &acc, &tok, sid).unwrap_or_else(|e| warn!(error = %e, "claim_yield failed"));
        }
        sleep(Duration::from_millis(1_200)); // min-wrap cooldown
        for (inv, sid) in shares.iter().skip(CLAIM_YIELD).take(WRAP) {
            sc.wrap(inv, &acc, &tok, sid).unwrap_or_else(|e| warn!(error = %e, "wrap failed"));
        }
        info!(asset = %asset, deeds = shares.len(), "headline operational + yield distributed");
    }

    // ---- 2. open assets (Oct-1 deadline, partially funded for judges) ----
    for (i, fill_bps) in OPEN_FILL_BPS.iter().take(opens).enumerate() {
        let p = catalog::project(HEADLINE + i);
        let voucher = i % 2;
        let meta = catalog::metadata_args(p);
        let (asset, _cap) = sc.create_vouched(
            meta,
            OPEN_GOAL,
            OCT_1_2026_MS,
            &st.validator_pools[voucher],
            &st.validator_caps[voucher],
        )?;
        st.showcase_assets.push(asset.clone());
        st.save(&sc.sim_path)?;
        let target = OPEN_GOAL * fill_bps / 10_000;
        // ~8 distinct backers per open asset.
        let backers = sc.take_investors(8);
        sc.fund_to_goal(&asset, target, &backers);
        info!(asset = %asset, fill_bps = *fill_bps, "open asset partially funded");
    }

    // ---- 3. disputes: 2 rejected, 2 upheld (slash), then 2 pending ----
    let plan = [
        (Verdict::Rejected, 2usize),
        (Verdict::Rejected, 3usize),
        (Verdict::Upheld, 4usize),
        (Verdict::Upheld, 5usize),
        (Verdict::Pending, 2usize),
        (Verdict::Pending, 3usize),
    ];
    for (di, (verdict, target_idx)) in plan.iter().take(disputes).enumerate() {
        // The two PENDING disputes must stay open for judges → widen the window first.
        if *verdict == Verdict::Pending {
            sc.set_dispute_window(LONG_WINDOW_MS).ok();
        }
        let (name, ticker) = DISPUTE_NAMES[di];
        let meta = metadata_named(di, name, ticker);
        let (asset, entity_cap) = sc.create_vouched(
            meta,
            DISPUTE_GOAL,
            OCT_1_2026_MS,
            &st.validator_pools[*target_idx],
            &st.validator_caps[*target_idx],
        )?;
        st.showcase_assets.push(asset.clone());
        st.save(&sc.sim_path)?;
        // Fund to goal with 2 backers, finalize → EXECUTING (coverage locked, disputable).
        let backers = sc.take_investors(2);
        sc.fund_to_goal(&asset, DISPUTE_GOAL, &backers);
        let tok = st.take_token().ok_or_else(|| anyhow!("entity token pool exhausted (disputes)"))?;
        st.save(&sc.sim_path)?;
        let acc = sc.finalize(&asset, &tok)?;
        let _ = entity_cap; // dispute targets stay EXECUTING (no tranche release)

        let challenger = sc.take_investors(1)[0];
        let reason = catalog::dispute_reason(di);
        if let Err(e) = sc.run_dispute(&asset, &acc, &tok, *target_idx, &st, challenger, *verdict, reason) {
            warn!(error = %e, "dispute flow failed (continuing)");
        }
    }

    // ---- 4. governance liveliness: a param tweak + pause→resume ----
    sc.exec_op(&[
        "--move-call".into(),
        format!("{}::protocol::admin_set_min_wrap_duration_ms", sc.gally),
        format!("@{}", sc.config_id),
        format!("@{}", sc.admin_cap),
        "2000u64".into(),
    ])
    .ok();
    sc.exec_op(&[
        "--move-call".into(),
        format!("{}::protocol::admin_emergency_stop", sc.gally),
        format!("@{}", sc.config_id),
        format!("@{}", sc.admin_cap),
    ])
    .ok();
    sc.exec_op(&[
        "--move-call".into(),
        format!("{}::protocol::admin_resume", sc.gally),
        format!("@{}", sc.config_id),
        format!("@{}", sc.admin_cap),
    ])
    .ok();

    st.showcase_done = true;
    st.save(&sc.sim_path)?;
    info!(assets = st.showcase_assets.len(), "✅ showcase seeding complete");
    Ok(())
}
