/// M3 test suite (work order: milestone/gally core/m3.md).
/// Covers: the five create_asset validations, vouching & coverage locking,
/// contribution caps & change return, permissionless finalize/abort, the
/// full refund cycle under pause (I-X1), receipt→share conversion with a
/// current-index snapshot, the three-step tranche engine with dispute
/// freeze, default seizure into the compensation pool, share splitting, and
/// a wrong-state matrix subset (full exhaustion lands in M7).
#[test_only]
module gally_core::asset_tests;

use gally_core::accumulator::{Self, GlobalYieldAccumulator};
use gally_core::asset::{Self, Asset, ContributionReceipt, EntityCap};
use gally_core::protocol::{Self, AdminCap, ProtocolConfig};
use gally_core::share;
use gally_core::usdc::USDC;
use gally_core::validator::{Self, ValidatorCap, ValidatorPool};
use sui::clock::{Self, Clock};
use sui::coin;
use sui::test_scenario as ts;

/// Witness for the test asset's wrapped-token type (M5 uses it for real).
public struct ASSET_TOKEN has drop {}

const ADMIN: address = @0xA1;
const VALIDATOR: address = @0xC3;
const VALIDATOR_2: address = @0xC4;
const ENTITY: address = @0xE5;
const ALICE: address = @0xAA;
const BOB: address = @0xBB;
const STRANGER: address = @0xD4;

// USDC raw units (6 decimals). 1 K = 1,000 USDC.
const GOAL: u64 = 100_000_000_000; // 100k USDC == 100k-share supply
const COLLATERAL: u64 = 10_000_000_000; // 10% of goal (default entity_collateral_bps)
const STAKE: u64 = 30_000_000_000; // validator stake; coverage = 20% of goal = 20k
const COVERAGE: u64 = 20_000_000_000;
const T0_AMT: u64 = 40_000_000_000;
const T1_AMT: u64 = 35_000_000_000;
const T2_AMT: u64 = 25_000_000_000;

const FUNDING_DEADLINE_MS: u64 = 10_000;
const T0_DEADLINE_MS: u64 = 20_000;
const T1_DEADLINE_MS: u64 = 30_000;
const T2_DEADLINE_MS: u64 = 40_000;

// === Helpers ===

fun make_clock(s: &mut ts::Scenario, ms: u64): Clock {
    let mut c = clock::create_for_testing(s.ctx());
    c.set_for_testing(ms);
    c
}

/// Protocol published; VALIDATOR registered with 30k stake.
fun setup(): ts::Scenario {
    let mut s = ts::begin(ADMIN);
    protocol::init_for_testing(s.ctx());

    s.next_tx(VALIDATOR);
    {
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, 0);
        let stake = coin::mint_for_testing<USDC>(STAKE, s.ctx());
        validator::register_validator(&config, stake, &clock, s.ctx());
        clock.destroy_for_testing();
        ts::return_shared(config);
    };
    s
}

/// ENTITY lists the standard 3-tranche asset at t=0.
fun create_default_asset(s: &mut ts::Scenario) {
    s.next_tx(ENTITY);
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(s, 0);
    asset::create_asset(
        &config,
        GOAL,
        FUNDING_DEADLINE_MS,
        vector[T0_AMT, T1_AMT, T2_AMT],
        vector[b"land acquisition", b"construction", b"fit-out"],
        vector[T0_DEADLINE_MS, T1_DEADLINE_MS, T2_DEADLINE_MS],
        5_000, // investors take 50% of gross revenue
        coin::mint_for_testing<USDC>(COLLATERAL, s.ctx()),
        &clock,
        s.ctx(),
    );
    clock.destroy_for_testing();
    ts::return_shared(config);
}

/// VALIDATOR vouches the (single) asset, locking 20k coverage.
fun vouch(s: &mut ts::Scenario) {
    s.next_tx(VALIDATOR);
    let mut asset = s.take_shared<Asset>();
    let mut pool = s.take_shared<ValidatorPool>();
    let vcap = s.take_from_sender<ValidatorCap>();
    let config = s.take_shared<ProtocolConfig>();

    let docs = vector[asset::new_walrus_ref(b"deed-blob", b"deed-sha256", s.ctx())];
    asset::vouch_asset_legals(&mut asset, &mut pool, &vcap, &config, docs, s.ctx());

    ts::return_shared(asset);
    ts::return_shared(pool);
    ts::return_shared(config);
    s.return_to_sender(vcap);
}

/// `who` contributes `amount` at `now_ms`; returns the change they got back.
fun contribute(s: &mut ts::Scenario, who: address, amount: u64, now_ms: u64): u64 {
    s.next_tx(who);
    let mut asset = s.take_shared<Asset>();
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(s, now_ms);

    let payment = coin::mint_for_testing<USDC>(amount, s.ctx());
    let change = asset::contribute_capital(&mut asset, &config, &clock, payment, s.ctx());
    let change_value = change.burn_for_testing();

    clock.destroy_for_testing();
    ts::return_shared(asset);
    ts::return_shared(config);
    change_value
}

/// Fills the raise exactly: ALICE 60k, BOB 40k.
fun fund_fully(s: &mut ts::Scenario) {
    contribute(s, ALICE, 60_000_000_000, 1_000);
    contribute(s, BOB, 40_000_000_000, 2_000);
}

/// STRANGER finalizes (proving permissionlessness) with a virgin cap.
fun finalize(s: &mut ts::Scenario, now_ms: u64) {
    s.next_tx(STRANGER);
    let mut asset = s.take_shared<Asset>();
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(s, now_ms);

    let cap = coin::create_treasury_cap_for_testing<ASSET_TOKEN>(s.ctx());
    asset::finalize_successful_raise<ASSET_TOKEN>(&mut asset, &config, cap, &clock, s.ctx());

    clock.destroy_for_testing();
    ts::return_shared(asset);
    ts::return_shared(config);
}

fun submit_proof(s: &mut ts::Scenario, index: u64) {
    s.next_tx(ENTITY);
    let mut asset = s.take_shared<Asset>();
    let config = s.take_shared<ProtocolConfig>();
    let ecap = s.take_from_sender<EntityCap>();
    let proof = asset::new_walrus_ref(b"proof-blob", b"proof-sha256", s.ctx());
    asset::submit_milestone_proof(&mut asset, &ecap, &config, index, proof);
    ts::return_shared(asset);
    ts::return_shared(config);
    s.return_to_sender(ecap);
}

fun approve(s: &mut ts::Scenario, index: u64) {
    s.next_tx(VALIDATOR);
    let mut asset = s.take_shared<Asset>();
    let pool = s.take_shared<ValidatorPool>();
    let vcap = s.take_from_sender<ValidatorCap>();
    let config = s.take_shared<ProtocolConfig>();
    asset::approve_milestone(&mut asset, &pool, &vcap, &config, index, s.ctx());
    ts::return_shared(asset);
    ts::return_shared(pool);
    ts::return_shared(config);
    s.return_to_sender(vcap);
}

/// Releases tranche `index` and returns the amount the entity received.
fun release(s: &mut ts::Scenario, index: u64): u64 {
    s.next_tx(ENTITY);
    let mut asset = s.take_shared<Asset>();
    let config = s.take_shared<ProtocolConfig>();
    let ecap = s.take_from_sender<EntityCap>();
    let payout = asset::release_funding_tranche(&mut asset, &ecap, &config, index, s.ctx());
    let value = payout.burn_for_testing();
    ts::return_shared(asset);
    ts::return_shared(config);
    s.return_to_sender(ecap);
    value
}

fun pause_protocol(s: &mut ts::Scenario) {
    s.next_tx(ADMIN);
    let mut config = s.take_shared<ProtocolConfig>();
    let cap = s.take_from_sender<AdminCap>();
    protocol::admin_emergency_stop(&mut config, &cap);
    ts::return_shared(config);
    s.return_to_sender(cap);
}

// === create_asset validations (spec §7) ===

#[test]
fun test_create_asset_ok_shape() {
    let mut s = setup();
    create_default_asset(&mut s);

    s.next_tx(ENTITY);
    let asset = s.take_shared<Asset>();
    assert!(asset::state(&asset) == asset::state_pending_vouch());
    assert!(asset::funding_goal(&asset) == GOAL);
    assert!(asset::collateral_value(&asset) == COLLATERAL);
    assert!(asset::tranche_count(&asset) == 3);
    assert!(asset::raised(&asset) == 0);
    ts::return_shared(asset);

    // The entity holds the cap.
    let ecap = s.take_from_sender<EntityCap>();
    s.return_to_sender(ecap);
    s.end();
}

#[test]
#[expected_failure(abort_code = asset::ETrancheSumMismatch)]
fun test_create_tranche_sum_mismatch_aborts() {
    let mut s = setup();
    s.next_tx(ENTITY);
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, 0);
    asset::create_asset(
        &config,
        GOAL,
        FUNDING_DEADLINE_MS,
        vector[T0_AMT, T1_AMT], // sums to 75k, not 100k
        vector[b"a", b"b"],
        vector[T0_DEADLINE_MS, T1_DEADLINE_MS],
        5_000,
        coin::mint_for_testing<USDC>(COLLATERAL, s.ctx()),
        &clock,
        s.ctx(),
    );
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EDeadlinePassed)]
fun test_create_past_funding_deadline_aborts() {
    let mut s = setup();
    s.next_tx(ENTITY);
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, FUNDING_DEADLINE_MS); // now == deadline: not future
    asset::create_asset(
        &config,
        GOAL,
        FUNDING_DEADLINE_MS,
        vector[GOAL],
        vector[b"a"],
        vector[T0_DEADLINE_MS],
        5_000,
        coin::mint_for_testing<USDC>(COLLATERAL, s.ctx()),
        &clock,
        s.ctx(),
    );
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EInvalidBps)]
fun test_create_zero_revenue_split_aborts() {
    let mut s = setup();
    s.next_tx(ENTITY);
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, 0);
    asset::create_asset(
        &config,
        GOAL,
        FUNDING_DEADLINE_MS,
        vector[GOAL],
        vector[b"a"],
        vector[T0_DEADLINE_MS],
        0, // investors get nothing: invalid
        coin::mint_for_testing<USDC>(COLLATERAL, s.ctx()),
        &clock,
        s.ctx(),
    );
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EInsufficientCollateral)]
fun test_create_low_collateral_aborts() {
    let mut s = setup();
    s.next_tx(ENTITY);
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, 0);
    asset::create_asset(
        &config,
        GOAL,
        FUNDING_DEADLINE_MS,
        vector[GOAL],
        vector[b"a"],
        vector[T0_DEADLINE_MS],
        5_000,
        coin::mint_for_testing<USDC>(COLLATERAL - 1, s.ctx()), // one unit short of 10%
        &clock,
        s.ctx(),
    );
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EInvalidTrancheSchedule)]
fun test_create_nonascending_tranche_deadlines_aborts() {
    let mut s = setup();
    s.next_tx(ENTITY);
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, 0);
    asset::create_asset(
        &config,
        GOAL,
        FUNDING_DEADLINE_MS,
        vector[T0_AMT, T1_AMT, T2_AMT],
        vector[b"a", b"b", b"c"],
        vector[T0_DEADLINE_MS, T0_DEADLINE_MS, T2_DEADLINE_MS], // not strictly ascending
        5_000,
        coin::mint_for_testing<USDC>(COLLATERAL, s.ctx()),
        &clock,
        s.ctx(),
    );
    abort 0
}

// === Vouching (Flow C) ===

#[test]
fun test_vouch_locks_coverage_and_opens_funding() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);

    s.next_tx(STRANGER);
    let asset = s.take_shared<Asset>();
    let pool = s.take_shared<ValidatorPool>();
    assert!(asset::state(&asset) == asset::state_funding());
    assert!(asset::coverage_locked(&asset) == COVERAGE);
    assert!(validator::locked(&pool) == COVERAGE);
    assert!(validator::active_vouches(&pool) == 1);
    assert!(asset::validator_pool_id(&asset).is_some());
    ts::return_shared(asset);
    ts::return_shared(pool);
    s.end();
}

#[test]
#[expected_failure(abort_code = validator::EInsufficientFreeStake)]
fun test_vouch_insufficient_free_stake_aborts() {
    // A validator at the bare minimum (10k) cannot cover 20% of a 100k goal.
    let mut s = ts::begin(ADMIN);
    protocol::init_for_testing(s.ctx());
    s.next_tx(VALIDATOR_2);
    {
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, 0);
        let stake = coin::mint_for_testing<USDC>(10_000_000_000, s.ctx());
        validator::register_validator(&config, stake, &clock, s.ctx());
        clock.destroy_for_testing();
        ts::return_shared(config);
    };
    create_default_asset(&mut s);

    s.next_tx(VALIDATOR_2);
    let mut asset = s.take_shared<Asset>();
    let mut pool = s.take_shared<ValidatorPool>();
    let vcap = s.take_from_sender<ValidatorCap>();
    let config = s.take_shared<ProtocolConfig>();
    let docs = vector[asset::new_walrus_ref(b"deed", b"hash", s.ctx())];
    asset::vouch_asset_legals(&mut asset, &mut pool, &vcap, &config, docs, s.ctx());
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EWrongState)]
fun test_vouch_twice_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    vouch(&mut s); // state is FUNDING now, not PENDING_VOUCH
    abort 0
}

// === Cancellation ===

#[test]
fun test_cancel_unvouched_by_entity_returns_collateral() {
    let mut s = setup();
    create_default_asset(&mut s);

    s.next_tx(ENTITY);
    {
        let mut asset = s.take_shared<Asset>();
        let ecap = s.take_from_sender<EntityCap>();
        let collateral = asset::cancel_unvouched_by_entity(&mut asset, &ecap, s.ctx());
        assert!(collateral.burn_for_testing() == COLLATERAL);
        assert!(asset::state(&asset) == asset::state_cancelled());
        ts::return_shared(asset);
        s.return_to_sender(ecap);
    };
    s.end();
}

#[test]
fun test_cancel_timeout_by_anyone() {
    let mut s = setup();
    create_default_asset(&mut s);

    // Past created_at (0) + vouch_timeout (30 days).
    s.next_tx(STRANGER);
    {
        let mut asset = s.take_shared<Asset>();
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, 2_592_000_001);
        asset::cancel_unvouched_timeout(&mut asset, &config, &clock, s.ctx());
        assert!(asset::state(&asset) == asset::state_cancelled());
        clock.destroy_for_testing();
        ts::return_shared(asset);
        ts::return_shared(config);
    };

    // Collateral went home to the entity, not to the caller.
    s.next_tx(ENTITY);
    let returned = s.take_from_sender<coin::Coin<USDC>>();
    assert!(returned.burn_for_testing() == COLLATERAL);
    s.end();
}

// === Contribution (Flow D) ===

#[test]
fun test_contribute_overshoot_returns_change() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);

    let change_alice = contribute(&mut s, ALICE, 60_000_000_000, 1_000);
    assert!(change_alice == 0);

    // BOB pays 50k into a 40k gap: exactly 10k comes back (D4).
    let change_bob = contribute(&mut s, BOB, 50_000_000_000, 2_000);
    assert!(change_bob == 10_000_000_000);

    s.next_tx(STRANGER);
    let asset = s.take_shared<Asset>();
    // I-C1 and I-C2: raised == goal == escrow.
    assert!(asset::raised(&asset) == GOAL);
    assert!(asset::escrow_value(&asset) == GOAL);
    ts::return_shared(asset);

    // Receipts carry the ACCEPTED amounts.
    s.next_tx(BOB);
    let receipt = s.take_from_sender<ContributionReceipt>();
    assert!(asset::receipt_amount(&receipt) == 40_000_000_000);
    s.return_to_sender(receipt);
    s.end();
}

#[test]
#[expected_failure(abort_code = asset::EDeadlinePassed)]
fun test_contribute_at_deadline_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    contribute(&mut s, ALICE, 1_000_000_000, FUNDING_DEADLINE_MS); // now == deadline
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EGoalAlreadyMet)]
fun test_contribute_when_goal_met_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    contribute(&mut s, STRANGER, 1_000_000_000, 3_000);
    abort 0
}

#[test]
#[expected_failure(abort_code = protocol::EPaused)]
fun test_contribute_while_paused_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    pause_protocol(&mut s);
    contribute(&mut s, ALICE, 1_000_000_000, 1_000);
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EWrongState)]
fun test_contribute_before_vouch_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    contribute(&mut s, ALICE, 1_000_000_000, 1_000); // still PENDING_VOUCH
    abort 0
}

// === Finalize (Flow D) ===

#[test]
fun test_finalize_full_flow_permissionless() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    finalize(&mut s, 3_000); // called by STRANGER

    s.next_tx(STRANGER);
    let asset = s.take_shared<Asset>();
    let acc = s.take_shared<GlobalYieldAccumulator<ASSET_TOKEN>>();
    assert!(asset::state(&asset) == asset::state_executing());
    assert!(asset::accumulator_id(&asset).is_some());
    assert!(accumulator::asset_id(&acc) == sui::object::id(&asset));
    assert!(accumulator::total_minted_shares(&acc) == GOAL);
    assert!(accumulator::total_wrapped_shares(&acc) == 0);
    assert!(accumulator::cumulative_yield_index(&acc) == 0);
    // Capital stays locked in the milestone escrow.
    assert!(asset::escrow_value(&asset) == GOAL);
    ts::return_shared(asset);
    ts::return_shared(acc);
    s.end();
}

#[test]
#[expected_failure(abort_code = asset::EGoalNotMet)]
fun test_finalize_goal_minus_one_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    contribute(&mut s, ALICE, GOAL - 1, 1_000);
    finalize(&mut s, 2_000);
    abort 0
}

#[test]
#[expected_failure(abort_code = accumulator::ECapNotVirgin)]
fun test_finalize_nonvirgin_cap_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);

    s.next_tx(STRANGER);
    let mut asset = s.take_shared<Asset>();
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, 3_000);
    let mut cap = coin::create_treasury_cap_for_testing<ASSET_TOKEN>(s.ctx());
    // Pre-mint: the cap is no longer virgin.
    let premint = cap.mint(1, s.ctx());
    premint.burn_for_testing();
    asset::finalize_successful_raise<ASSET_TOKEN>(&mut asset, &config, cap, &clock, s.ctx());
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EDeadlinePassed)]
fun test_finalize_after_deadline_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    finalize(&mut s, FUNDING_DEADLINE_MS + 1);
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EWrongState)]
fun test_finalize_twice_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    finalize(&mut s, 3_000);
    finalize(&mut s, 3_500); // state is EXECUTING now
    abort 0
}

// === Abort & refund (Flow D, D6/I-X1) ===

#[test]
fun test_abort_and_full_refund_cycle_while_paused() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    contribute(&mut s, ALICE, 60_000_000_000, 1_000); // raise falls short

    // Pause: exits must still work (I-X1).
    pause_protocol(&mut s);

    // Anyone aborts after the deadline — even while paused.
    s.next_tx(STRANGER);
    {
        let mut asset = s.take_shared<Asset>();
        let mut pool = s.take_shared<ValidatorPool>();
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, FUNDING_DEADLINE_MS + 1);
        asset::abort_failed_raise(&mut asset, &mut pool, &config, &clock, s.ctx());
        assert!(asset::state(&asset) == asset::state_failed());
        // Validator coverage released: no fault in a failed raise.
        assert!(validator::locked(&pool) == 0);
        assert!(validator::active_vouches(&pool) == 0);
        clock.destroy_for_testing();
        ts::return_shared(asset);
        ts::return_shared(pool);
        ts::return_shared(config);
    };

    // Entity collateral went home.
    s.next_tx(ENTITY);
    {
        let returned = s.take_from_sender<coin::Coin<USDC>>();
        assert!(returned.burn_for_testing() == COLLATERAL);
    };

    // ALICE refunds her full principal — still paused.
    s.next_tx(ALICE);
    {
        let mut asset = s.take_shared<Asset>();
        let config = s.take_shared<ProtocolConfig>();
        let receipt = s.take_from_sender<ContributionReceipt>();
        let refund = asset::refund_contribution(&mut asset, &config, receipt, s.ctx());
        assert!(refund.burn_for_testing() == 60_000_000_000);
        // I-C2 through the refund phase: escrow == Σ receipts == raised == 0.
        assert!(asset::escrow_value(&asset) == 0);
        assert!(asset::raised(&asset) == 0);
        ts::return_shared(asset);
        ts::return_shared(config);
    };
    s.end();
}

#[test]
#[expected_failure(abort_code = asset::EDeadlineNotReached)]
fun test_abort_before_deadline_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);

    s.next_tx(STRANGER);
    let mut asset = s.take_shared<Asset>();
    let mut pool = s.take_shared<ValidatorPool>();
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, FUNDING_DEADLINE_MS); // not strictly past
    asset::abort_failed_raise(&mut asset, &mut pool, &config, &clock, s.ctx());
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EGoalAlreadyMet)]
fun test_abort_when_goal_met_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);

    s.next_tx(STRANGER);
    let mut asset = s.take_shared<Asset>();
    let mut pool = s.take_shared<ValidatorPool>();
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, FUNDING_DEADLINE_MS + 1);
    asset::abort_failed_raise(&mut asset, &mut pool, &config, &clock, s.ctx());
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EWrongState)]
fun test_refund_while_funding_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    contribute(&mut s, ALICE, 1_000_000_000, 1_000);

    s.next_tx(ALICE);
    let mut asset = s.take_shared<Asset>();
    let config = s.take_shared<ProtocolConfig>();
    let receipt = s.take_from_sender<ContributionReceipt>();
    let refund = asset::refund_contribution(&mut asset, &config, receipt, s.ctx());
    refund.burn_for_testing();
    abort 0
}

// === Receipt → share conversion ===

#[test]
fun test_claim_shares_index_snapshot_is_current() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    finalize(&mut s, 3_000);

    s.next_tx(ALICE);
    {
        let asset = s.take_shared<Asset>();
        let acc = s.take_shared<GlobalYieldAccumulator<ASSET_TOKEN>>();
        let config = s.take_shared<ProtocolConfig>();
        let receipt = s.take_from_sender<ContributionReceipt>();
        let clock = make_clock(&mut s, 4_000);

        let minted =
            asset::claim_shares<ASSET_TOKEN>(&asset, &acc, &config, receipt, &clock, s.ctx());
        assert!(share::share_count(&minted) == 60_000_000_000);
        assert!(share::asset_id(&minted) == sui::object::id(&asset));
        // Snapshot == the CURRENT global index (0 here), not a fresh zero by
        // coincidence: the property under test is equality with the live value.
        assert!(
            share::yield_claimed_index(&minted) == accumulator::cumulative_yield_index(&acc),
        );
        assert!(share::acquired_at_ms(&minted) == 4_000);

        transfer::public_transfer(minted, ALICE);
        clock.destroy_for_testing();
        ts::return_shared(asset);
        ts::return_shared(acc);
        ts::return_shared(config);
    };
    s.end();
}

// NOTE: a "claim before finalize" abort test is deliberately absent — the
// EWrongState gate in claim_shares is unreachable today because no
// accumulator object exists before finalize (the call cannot be constructed).
// The assert stays as defense-in-depth; M7's full matrix revisits it.

// === Tranche engine (Flow E) ===

#[test]
fun test_tranche_flow_to_operational_and_coverage_release() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    finalize(&mut s, 3_000);

    submit_proof(&mut s, 0);
    approve(&mut s, 0);
    assert!(release(&mut s, 0) == T0_AMT);

    submit_proof(&mut s, 1);
    approve(&mut s, 1);
    assert!(release(&mut s, 1) == T1_AMT);

    submit_proof(&mut s, 2);
    approve(&mut s, 2);
    assert!(release(&mut s, 2) == T2_AMT);

    s.next_tx(STRANGER);
    {
        let mut asset = s.take_shared<Asset>();
        let mut pool = s.take_shared<ValidatorPool>();
        assert!(asset::state(&asset) == asset::state_operational());
        assert!(asset::escrow_value(&asset) == 0); // I-T1 endpoint
        assert!(asset::next_tranche(&asset) == 3);

        // Anyone releases the validator's coverage post-OPERATIONAL.
        asset::release_vouch_coverage(&mut asset, &mut pool);
        assert!(validator::locked(&pool) == 0);
        assert!(asset::coverage_locked(&asset) == 0);
        ts::return_shared(asset);
        ts::return_shared(pool);
    };
    s.end();
}

#[test]
#[expected_failure(abort_code = asset::ETrancheOutOfOrder)]
fun test_submit_out_of_order_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    finalize(&mut s, 3_000);
    submit_proof(&mut s, 1); // tranche 0 is next
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EProofMissing)]
fun test_approve_without_proof_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    finalize(&mut s, 3_000);
    approve(&mut s, 0); // no proof submitted
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::ENotApproved)]
fun test_release_without_approval_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    finalize(&mut s, 3_000);
    submit_proof(&mut s, 0);
    release(&mut s, 0); // approved_by is none
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EProofAlreadySubmitted)]
fun test_double_submit_proof_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    finalize(&mut s, 3_000);
    submit_proof(&mut s, 0);
    submit_proof(&mut s, 0);
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EAlreadyApproved)]
fun test_double_approve_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    finalize(&mut s, 3_000);
    submit_proof(&mut s, 0);
    approve(&mut s, 0);
    approve(&mut s, 0);
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EAssetDisputed)]
fun test_dispute_freeze_blocks_approve() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    finalize(&mut s, 3_000);
    submit_proof(&mut s, 0);

    s.next_tx(STRANGER);
    {
        let mut asset = s.take_shared<Asset>();
        asset::set_disputed_for_testing(&mut asset, true);
        ts::return_shared(asset);
    };

    approve(&mut s, 0);
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EAssetDisputed)]
fun test_dispute_freeze_blocks_release() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    finalize(&mut s, 3_000);
    submit_proof(&mut s, 0);
    approve(&mut s, 0);

    // Dispute lands in the public window between approval and withdrawal —
    // exactly the interval the three-step separation exists to create.
    s.next_tx(STRANGER);
    {
        let mut asset = s.take_shared<Asset>();
        asset::set_disputed_for_testing(&mut asset, true);
        ts::return_shared(asset);
    };

    release(&mut s, 0);
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::ENotVouchingValidator)]
fun test_approve_by_non_vouching_pool_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    finalize(&mut s, 3_000);
    submit_proof(&mut s, 0);

    // A second validator registers (their pool becomes the most recent).
    s.next_tx(VALIDATOR_2);
    {
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, 3_500);
        let stake = coin::mint_for_testing<USDC>(STAKE, s.ctx());
        validator::register_validator(&config, stake, &clock, s.ctx());
        clock.destroy_for_testing();
        ts::return_shared(config);
    };

    s.next_tx(VALIDATOR_2);
    let mut asset = s.take_shared<Asset>();
    let pool = s.take_shared<ValidatorPool>(); // VALIDATOR_2's pool (most recent)
    let vcap = s.take_from_sender<ValidatorCap>();
    let config = s.take_shared<ProtocolConfig>();
    asset::approve_milestone(&mut asset, &pool, &vcap, &config, 0, s.ctx());
    abort 0
}

// === Default (Flow J) ===

#[test]
fun test_flag_default_seizes_collateral_and_escrow() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    finalize(&mut s, 3_000);

    // Tranche 0 executes normally; tranche 1's deadline then passes unmet.
    submit_proof(&mut s, 0);
    approve(&mut s, 0);
    release(&mut s, 0);

    s.next_tx(STRANGER);
    {
        let mut asset = s.take_shared<Asset>();
        let mut acc = s.take_shared<GlobalYieldAccumulator<ASSET_TOKEN>>();
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, T1_DEADLINE_MS + 1);

        asset::flag_default<ASSET_TOKEN>(&mut asset, &mut acc, &config, &clock);

        assert!(asset::state(&asset) == asset::state_compensating());
        // Seized: 10k collateral + 60k unreleased escrow (T1 + T2).
        assert!(
            accumulator::compensation_pool_value(&acc) == COLLATERAL + T1_AMT + T2_AMT,
        );
        assert!(asset::escrow_value(&asset) == 0);
        assert!(asset::collateral_value(&asset) == 0);
        // Grace window open: wrapping frozen, unlock = now + 7 days.
        assert!(accumulator::is_wrapping_frozen(&acc));
        assert!(
            accumulator::compensation_unlock_ms(&acc) == T1_DEADLINE_MS + 1 + 604_800_000,
        );

        clock.destroy_for_testing();
        ts::return_shared(asset);
        ts::return_shared(acc);
        ts::return_shared(config);
    };
    s.end();
}

#[test]
#[expected_failure(abort_code = asset::EDeadlineNotMissed)]
fun test_flag_default_before_deadline_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    finalize(&mut s, 3_000);

    s.next_tx(STRANGER);
    let mut asset = s.take_shared<Asset>();
    let mut acc = s.take_shared<GlobalYieldAccumulator<ASSET_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, T0_DEADLINE_MS); // not strictly past
    asset::flag_default<ASSET_TOKEN>(&mut asset, &mut acc, &config, &clock);
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EAlreadyApproved)]
fun test_flag_default_when_approved_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    finalize(&mut s, 3_000);
    submit_proof(&mut s, 0);
    approve(&mut s, 0);
    // Approved but unreleased: the entity proved the work — not a default.

    s.next_tx(STRANGER);
    let mut asset = s.take_shared<Asset>();
    let mut acc = s.take_shared<GlobalYieldAccumulator<ASSET_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, T0_DEADLINE_MS + 1);
    asset::flag_default<ASSET_TOKEN>(&mut asset, &mut acc, &config, &clock);
    abort 0
}

// === Share splitting ===

#[test]
fun test_split_share_preserves_totals() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    finalize(&mut s, 3_000);

    s.next_tx(ALICE);
    {
        let asset = s.take_shared<Asset>();
        let acc = s.take_shared<GlobalYieldAccumulator<ASSET_TOKEN>>();
        let config = s.take_shared<ProtocolConfig>();
        let receipt = s.take_from_sender<ContributionReceipt>();
        let clock = make_clock(&mut s, 4_000);
        let mut parent =
            asset::claim_shares<ASSET_TOKEN>(&asset, &acc, &config, receipt, &clock, s.ctx());

        let child = share::split_share(&mut parent, 20_000_000_000, s.ctx());
        assert!(share::share_count(&parent) == 40_000_000_000);
        assert!(share::share_count(&child) == 20_000_000_000);
        // Child inherits snapshot and acquisition time: entitlement is linear
        // in count, so the split preserves total owed exactly (spec §8.1).
        assert!(share::yield_claimed_index(&child) == share::yield_claimed_index(&parent));
        assert!(share::acquired_at_ms(&child) == share::acquired_at_ms(&parent));
        assert!(share::asset_id(&child) == share::asset_id(&parent));

        transfer::public_transfer(parent, ALICE);
        transfer::public_transfer(child, ALICE);
        clock.destroy_for_testing();
        ts::return_shared(asset);
        ts::return_shared(acc);
        ts::return_shared(config);
    };
    s.end();
}

#[test]
#[expected_failure(abort_code = share::EInvalidSplitAmount)]
fun test_split_full_amount_aborts() {
    let mut s = setup();
    create_default_asset(&mut s);
    vouch(&mut s);
    fund_fully(&mut s);
    finalize(&mut s, 3_000);

    s.next_tx(ALICE);
    let asset = s.take_shared<Asset>();
    let acc = s.take_shared<GlobalYieldAccumulator<ASSET_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    let receipt = s.take_from_sender<ContributionReceipt>();
    let clock = make_clock(&mut s, 4_000);
    let mut parent =
        asset::claim_shares<ASSET_TOKEN>(&asset, &acc, &config, receipt, &clock, s.ctx());

    // Splitting the whole share is not a split.
    let child = share::split_share(&mut parent, 60_000_000_000, s.ctx());
    transfer::public_transfer(child, ALICE);
    abort 0
}
