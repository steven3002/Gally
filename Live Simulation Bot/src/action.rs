//! The mock-transaction activity catalog (SIM-M4 / `protocol_flow.md §8`, §13).
//!
//! This module owns the **pure** parts of the activity generator: the action
//! enum, the §8 weight table + weighted selection, the per-action target
//! **precondition predicates** (so a selector only ever returns a target that
//! satisfies the action's `[CORE]` state requirement), and the governance
//! pause→resume pairing rule. The live executors that build + submit PTBs live
//! in `daemon.rs`; keeping selection/filtering pure here makes them unit-testable
//! with no chain (the SIM-M4 test matrix).

use crate::rng::Rng;
use crate::sui_client::{AccumulatorView, AssetView};

// `[CORE] §4` asset-state bytes.
pub const ST_PENDING_VOUCH: u8 = 0;
pub const ST_FUNDING: u8 = 1;
pub const ST_FAILED: u8 = 2;
pub const ST_CANCELLED: u8 = 3;
pub const ST_EXECUTING: u8 = 4;
pub const ST_OPERATIONAL: u8 = 5;
pub const ST_COMPENSATING: u8 = 6;
pub const ST_CLOSED: u8 = 7;

/// One weighted action the bot can take per tick. Each maps to one or more real
/// `[CORE]` entry calls (`§13`); see `daemon.rs` for the executor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Action {
    /// A user funds a FUNDING asset (faucet-claim path, then operator-gift path).
    Contribute,
    /// The operator lists + vouches a fresh FUNDING asset (keeps targets fresh).
    ListAsset,
    /// A finalized asset receives revenue (advances the yield index).
    DepositRevenue,
    /// A shareholder pulls yield (zero payout is a successful no-op — exit path).
    ClaimYield,
    /// A receipt holder converts to a `GallyShare` on a post-finalize asset.
    ClaimShares,
    /// A fully-funded raise is finalized, consuming one pooled entity token.
    Finalize,
    /// One tranche step (submit proof → approve → release) on an EXECUTING asset.
    TrancheCycle,
    /// A holder wraps a share to `Coin<T>` or unwraps it back (exit path).
    WrapUnwrap,
    /// A validator tops up / withdraws free stake.
    Stake,
    /// Permissionless rescue of parked rollover revenue.
    SweepRollover,
    /// Full dispute lifecycle (open → jurors vote → resolve) — accelerated only.
    Dispute,
    /// Permissionless default on an EXECUTING asset past its tranche deadline.
    FlagDefault,
    /// Permissionless close of a swept COMPENSATING asset.
    Close,
    /// Occasional governance: a param tweak, or a paired emergency-stop+resume.
    Governance,
    /// Permissionless distribution of restitution after the grace window.
    SweepCompensation,
    /// A holder burns a deed on a CLOSED accumulator for final settlement.
    Redeem,
}

impl Action {
    /// Compact log/identifier name.
    pub fn name(self) -> &'static str {
        match self {
            Action::Contribute => "contribute",
            Action::ListAsset => "list_asset",
            Action::DepositRevenue => "deposit_revenue",
            Action::ClaimYield => "claim_yield",
            Action::ClaimShares => "claim_shares",
            Action::Finalize => "finalize",
            Action::TrancheCycle => "tranche_cycle",
            Action::WrapUnwrap => "wrap_unwrap",
            Action::Stake => "stake",
            Action::SweepRollover => "sweep_rollover",
            Action::Dispute => "dispute",
            Action::FlagDefault => "flag_default",
            Action::Close => "close",
            Action::Governance => "governance",
            Action::SweepCompensation => "sweep_compensation",
            Action::Redeem => "redeem",
        }
    }
}

/// The §8 weight table. Biases toward the common, event-rich operations; every
/// catalogued action has a **non-zero** weight so rare paths still fire over a
/// soak. Legend → weight: ●●●●=10, ●●●=7, ●●=5, ●=2–4, ○=1.
pub const WEIGHTS: &[(Action, u32)] = &[
    (Action::Contribute, 10),       // ●●●●
    (Action::DepositRevenue, 7),    // ●●●
    (Action::ClaimYield, 7),        // ●●●
    (Action::ClaimShares, 5),       // ●●
    (Action::Finalize, 5),          // ●●
    (Action::TrancheCycle, 5),      // ●●
    (Action::WrapUnwrap, 5),        // ●●
    (Action::ListAsset, 4),         // ● (keeps FUNDING targets fresh)
    (Action::Stake, 3),             // ●
    (Action::SweepRollover, 2),     // ●
    (Action::Dispute, 2),           // ●
    (Action::FlagDefault, 1),       // ○
    (Action::Close, 1),             // ○
    (Action::Governance, 1),        // ○
    (Action::SweepCompensation, 1), // ○
    (Action::Redeem, 1),            // ○
];

/// The weight of an action (0 if somehow absent — never expected).
pub fn weight(a: Action) -> u32 {
    WEIGHTS.iter().find(|(x, _)| *x == a).map(|(_, w)| *w).unwrap_or(0)
}

/// Human name for an `[CORE] §4` asset-state byte (for the daemon's state
/// census log).
pub fn state_name(state: u8) -> &'static str {
    match state {
        ST_PENDING_VOUCH => "pending_vouch",
        ST_FUNDING => "funding",
        ST_FAILED => "failed",
        ST_CANCELLED => "cancelled",
        ST_EXECUTING => "executing",
        ST_OPERATIONAL => "operational",
        ST_COMPENSATING => "compensating",
        ST_CLOSED => "closed",
        _ => "unknown",
    }
}

/// Pick one action by weight (`§8`: one action per tick).
pub fn select(rng: &mut Rng) -> Action {
    let total: u32 = WEIGHTS.iter().map(|(_, w)| *w).sum();
    let mut roll = rng.below(total as u64) as u32;
    for (a, w) in WEIGHTS {
        if roll < *w {
            return *a;
        }
        roll -= *w;
    }
    // Unreachable (roll < total), but stay total.
    Action::Contribute
}

// === Pure target-precondition predicates (the selector filters) ===
//
// Each mirrors the `[CORE]` assertion the corresponding entry call makes, so a
// candidate that passes here will not trivially abort on a state check (the
// chain may still move between read and submit — that's the lazy skip in §6/R5).

/// Contribute target: FUNDING with room left (`raised < goal`).
pub fn can_contribute(v: &AssetView) -> bool {
    v.state == ST_FUNDING && v.raised < v.funding_goal
}

/// Finalize target: FUNDING, exactly at goal.
pub fn can_finalize(v: &AssetView) -> bool {
    v.state == ST_FUNDING && v.funding_goal > 0 && v.raised == v.funding_goal
}

/// Revenue target: OPERATIONAL (has an accumulator by construction).
pub fn can_deposit_revenue(v: &AssetView) -> bool {
    v.state == ST_OPERATIONAL && v.accumulator_id.is_some()
}

/// Tranche-cycle target: EXECUTING, not disputed, with an unreleased tranche.
pub fn can_run_tranche(v: &AssetView) -> bool {
    v.state == ST_EXECUTING
        && !v.disputed
        && (v.next_tranche as usize) < v.tranches.len()
        && !v
            .tranches
            .get(v.next_tranche as usize)
            .map(|t| t.released)
            .unwrap_or(true)
}

/// Default target: EXECUTING, next tranche past its deadline and unapproved.
pub fn can_flag_default(v: &AssetView, now_ms: u64) -> bool {
    v.state == ST_EXECUTING
        && v.accumulator_id.is_some()
        && v
            .tranches
            .get(v.next_tranche as usize)
            .map(|t| !t.approved && now_ms > t.deadline_ms)
            .unwrap_or(false)
}

/// Dispute target: a slashable, accumulator-backed asset with live coverage and
/// no open dispute (`[CORE]` dispute.move amendment 2).
pub fn can_open_dispute(v: &AssetView) -> bool {
    (v.state == ST_EXECUTING || v.state == ST_OPERATIONAL)
        && v.coverage_locked > 0
        && !v.disputed
        && v.accumulator_id.is_some()
        && v.validator_pool_id.is_some()
}

/// close_after_compensation target: COMPENSATING, pool already swept, grace
/// elapsed.
pub fn can_close_after_compensation(v: &AssetView, acc: &AccumulatorView, now_ms: u64) -> bool {
    v.state == ST_COMPENSATING
        && acc.compensation_pool == 0
        && now_ms >= acc.compensation_unlock_ms
}

/// sweep_compensation target: a non-closed accumulator holding restitution past
/// its grace window.
pub fn can_sweep_compensation(acc: &AccumulatorView, now_ms: u64) -> bool {
    !acc.closed && acc.compensation_pool > 0 && now_ms >= acc.compensation_unlock_ms
}

/// sweep_rollover target: parked reserve with a non-zero unwrapped denominator.
pub fn can_sweep_rollover(acc: &AccumulatorView) -> bool {
    acc.rollover_reserve > 0 && acc.unwrapped_supply() > 0
}

/// redeem target: the accumulator is CLOSED (deeds settle and exit).
pub fn can_redeem(acc: &AccumulatorView) -> bool {
    acc.closed
}

// === Governance plan (pause must always be paired with resume) ===

/// One governance step. A pause is ALWAYS emitted together with its resume so
/// the protocol can never get stuck paused (SIM-M4 invariant; `[CORE]` D6: exit
/// paths are unaffected by pause, but capital entry must come back).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GovStep {
    EmergencyStop,
    Resume,
    SetMinWrapMs(u64),
    SetFeeBps(u64),
}

/// Build a governance action's step list. `use_pause` → a paired stop+resume;
/// otherwise a single reversible param tweak. The pause variant is the only one
/// that could strand the protocol, so it is the one we keep paired by
/// construction.
pub fn governance_plan(use_pause: bool, knob: u64) -> Vec<GovStep> {
    if use_pause {
        vec![GovStep::EmergencyStop, GovStep::Resume]
    } else if knob & 1 == 0 {
        vec![GovStep::SetMinWrapMs(5_000)]
    } else {
        vec![GovStep::SetFeeBps(100)]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sui_client::{AccumulatorView, AssetView, TrancheView};

    fn asset(state: u8, raised: u64, goal: u64) -> AssetView {
        AssetView {
            state,
            raised,
            funding_goal: goal,
            coverage_locked: 0,
            disputed: false,
            next_tranche: 0,
            accumulator_id: None,
            validator_pool_id: None,
            tranches: Vec::new(),
        }
    }

    fn acc() -> AccumulatorView {
        AccumulatorView {
            total_minted_shares: 0,
            total_wrapped_shares: 0,
            rollover_reserve: 0,
            compensation_pool: 0,
            compensation_unlock_ms: 0,
            closed: false,
        }
    }

    #[test]
    fn test_state_name_covers_all() {
        for s in 0u8..=7 {
            assert_ne!(state_name(s), "unknown", "state {s} should be named");
        }
        assert_eq!(state_name(99), "unknown");
    }

    // PASS CRITERIA TEST: the weighted selector returns each catalogued action
    // with non-zero probability and respects the relative ordering of weights.
    #[test]
    fn test_action_weighting() {
        // every catalogued action has a strictly positive weight
        let all = [
            Action::Contribute, Action::ListAsset, Action::DepositRevenue, Action::ClaimYield,
            Action::ClaimShares, Action::Finalize, Action::TrancheCycle, Action::WrapUnwrap,
            Action::Stake, Action::SweepRollover, Action::Dispute, Action::FlagDefault,
            Action::Close, Action::Governance, Action::SweepCompensation, Action::Redeem,
        ];
        for a in all {
            assert!(weight(a) > 0, "{} must have a non-zero weight", a.name());
        }
        // relative ordering: most-frequent ≥ mid ≥ rare
        assert!(weight(Action::Contribute) >= weight(Action::DepositRevenue));
        assert!(weight(Action::DepositRevenue) >= weight(Action::ClaimShares));
        assert!(weight(Action::ClaimShares) >= weight(Action::Dispute));
        assert!(weight(Action::Dispute) >= weight(Action::Redeem));
        assert!(weight(Action::Contribute) == WEIGHTS.iter().map(|(_, w)| *w).max().unwrap());

        // over many draws the selector actually returns every action
        let mut rng = Rng::new(0xC0FFEE);
        let mut counts = std::collections::HashMap::new();
        for _ in 0..20_000 {
            *counts.entry(select(&mut rng)).or_insert(0u32) += 1;
        }
        for a in all {
            assert!(counts.get(&a).copied().unwrap_or(0) > 0, "{} never selected", a.name());
        }
        // the heaviest action is drawn more often than a rare one
        assert!(counts[&Action::Contribute] > counts[&Action::Redeem]);
    }

    // PASS CRITERIA TEST: a target whose state no longer matches is filtered out
    // (the selector returns no candidate → the executor will report "skipped",
    // never an error).
    #[test]
    fn test_skip_on_state_mismatch() {
        // a CLOSED asset is not a contribute target
        let closed = asset(ST_CLOSED, 0, 100);
        assert!(!can_contribute(&closed));
        // simulate the live selector: filter a candidate list, get nothing back
        let candidates = vec![asset(ST_CLOSED, 0, 100), asset(ST_OPERATIONAL, 0, 100)];
        let picked: Vec<_> = candidates.iter().filter(|v| can_contribute(v)).collect();
        assert!(picked.is_empty(), "no FUNDING target → selector yields none");
    }

    // PASS CRITERIA TEST: selectors only return assets/accumulators that satisfy
    // the action's precondition.
    #[test]
    fn test_target_selection_filters() {
        // contribute: FUNDING with room only
        assert!(can_contribute(&asset(ST_FUNDING, 40, 100)));
        assert!(!can_contribute(&asset(ST_FUNDING, 100, 100))); // full
        assert!(!can_contribute(&asset(ST_EXECUTING, 40, 100))); // wrong state

        // finalize: FUNDING exactly at goal
        assert!(can_finalize(&asset(ST_FUNDING, 100, 100)));
        assert!(!can_finalize(&asset(ST_FUNDING, 99, 100)));
        assert!(!can_finalize(&asset(ST_FUNDING, 0, 0)));

        // deposit revenue: OPERATIONAL with an accumulator
        let mut op = asset(ST_OPERATIONAL, 100, 100);
        assert!(!can_deposit_revenue(&op)); // no accumulator id yet
        op.accumulator_id = Some("0xacc".into());
        assert!(can_deposit_revenue(&op));
        assert!(!can_deposit_revenue(&asset(ST_FUNDING, 100, 100)));

        // tranche cycle: EXECUTING, undisputed, unreleased tranche
        let mut ex = asset(ST_EXECUTING, 100, 100);
        ex.tranches = vec![TrancheView { deadline_ms: 0, released: false, has_proof: false, approved: false }];
        assert!(can_run_tranche(&ex));
        ex.disputed = true;
        assert!(!can_run_tranche(&ex));
        ex.disputed = false;
        ex.tranches[0].released = true;
        assert!(!can_run_tranche(&ex));

        // flag default: EXECUTING, deadline passed, unapproved
        let mut df = asset(ST_EXECUTING, 100, 100);
        df.accumulator_id = Some("0xacc".into());
        df.tranches = vec![TrancheView { deadline_ms: 1_000, released: false, has_proof: true, approved: false }];
        assert!(can_flag_default(&df, 2_000));
        assert!(!can_flag_default(&df, 500)); // not yet past deadline
        df.tranches[0].approved = true;
        assert!(!can_flag_default(&df, 2_000)); // approved ⇒ not a default

        // open dispute: EXECUTING/OPERATIONAL with coverage, ids, undisputed
        let mut dp = asset(ST_OPERATIONAL, 100, 100);
        dp.coverage_locked = 20;
        dp.accumulator_id = Some("0xacc".into());
        dp.validator_pool_id = Some("0xpool".into());
        assert!(can_open_dispute(&dp));
        dp.coverage_locked = 0;
        assert!(!can_open_dispute(&dp));

        // accumulator-keyed selectors
        let mut a = acc();
        a.rollover_reserve = 10;
        a.total_minted_shares = 100; // unwrapped = 100 > 0
        assert!(can_sweep_rollover(&a));
        a.total_wrapped_shares = 100; // unwrapped = 0
        assert!(!can_sweep_rollover(&a));

        let mut c = acc();
        c.compensation_pool = 50;
        c.compensation_unlock_ms = 1_000;
        assert!(can_sweep_compensation(&c, 2_000));
        assert!(!can_sweep_compensation(&c, 500)); // grace not elapsed
        c.closed = true;
        assert!(!can_sweep_compensation(&c, 2_000));

        let mut r = acc();
        assert!(!can_redeem(&r));
        r.closed = true;
        assert!(can_redeem(&r));
    }

    // PASS CRITERIA TEST: a governance pause action always pairs with a resume,
    // so the protocol never gets stuck paused.
    #[test]
    fn test_pause_then_resume_pairs() {
        let plan = governance_plan(true, 0);
        assert!(plan.contains(&GovStep::EmergencyStop));
        let stop_at = plan.iter().position(|s| *s == GovStep::EmergencyStop).unwrap();
        let resume_at = plan.iter().position(|s| *s == GovStep::Resume);
        assert!(resume_at.is_some(), "a pause plan must contain a resume");
        assert!(resume_at.unwrap() > stop_at, "resume must follow the stop");

        // the non-pause plan is a single reversible tweak — never leaves a pause
        for knob in 0..4 {
            let p = governance_plan(false, knob);
            assert!(!p.contains(&GovStep::EmergencyStop));
            assert!(!p.is_empty());
        }
    }
}
