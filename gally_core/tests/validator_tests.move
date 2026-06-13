/// M2 test suite (work order: milestone/gally core/m2.md).
/// Covers: registration floor, permissionless top-ups (including while
/// paused), the full withdrawal floor matrix (7 boundary cases), frozen /
/// slashed lockouts, coverage accounting (I-V1, I-V2), slash preconditions
/// and terminality, and wrong-cap rejection.
#[test_only]
module gally_core::validator_tests;

use gally_core::protocol::{Self, AdminCap, ProtocolConfig};
use gally_core::usdc::USDC;
use gally_core::validator::{Self, ValidatorCap, ValidatorPool};
use sui::clock;
use sui::coin;
use sui::test_scenario as ts;

const ADMIN: address = @0xA1;
const VALIDATOR: address = @0xC3;
const STRANGER: address = @0xD4;

/// 1,000 USDC in raw units (6 decimals).
const K: u64 = 1_000_000_000;
/// Default `min_validator_stake` set by `protocol::init` (10,000 USDC).
const MIN_STAKE: u64 = 10_000_000_000;

// === Helpers ===

/// Publishes the protocol and registers VALIDATOR with `stake` raw units.
/// Leaves the scenario one tx past registration, sender = VALIDATOR.
fun setup_with_validator(stake: u64): ts::Scenario {
    let mut scenario = ts::begin(ADMIN);
    protocol::init_for_testing(scenario.ctx());

    scenario.next_tx(VALIDATOR);
    {
        let config = scenario.take_shared<ProtocolConfig>();
        let clock = clock::create_for_testing(scenario.ctx());
        let coin = coin::mint_for_testing<USDC>(stake, scenario.ctx());
        validator::register_validator(&config, coin, &clock, scenario.ctx());
        clock.destroy_for_testing();
        ts::return_shared(config);
    };

    scenario.next_tx(VALIDATOR);
    scenario
}

/// Withdraws `amount` as VALIDATOR and returns the remaining pool stake.
fun withdraw(scenario: &mut ts::Scenario, amount: u64): u64 {
    scenario.next_tx(VALIDATOR);
    let mut pool = scenario.take_shared<ValidatorPool>();
    let cap = scenario.take_from_sender<ValidatorCap>();
    let config = scenario.take_shared<ProtocolConfig>();

    let coin = validator::withdraw_stake(&mut pool, &cap, &config, amount, scenario.ctx());
    assert!(coin.burn_for_testing() == amount);

    let remaining = validator::stake_value(&pool);
    ts::return_shared(pool);
    ts::return_shared(config);
    scenario.return_to_sender(cap);
    remaining
}

// === Registration ===

#[test]
fun test_register_at_min_ok() {
    let scenario = setup_with_validator(MIN_STAKE);

    let pool = scenario.take_shared<ValidatorPool>();
    assert!(validator::stake_value(&pool) == MIN_STAKE);
    assert!(validator::locked(&pool) == 0);
    assert!(validator::active_vouches(&pool) == 0);
    assert!(validator::is_active(&pool));
    assert!(validator::validator(&pool) == VALIDATOR);
    ts::return_shared(pool);

    // The registrant holds the cap.
    let cap = scenario.take_from_sender<ValidatorCap>();
    scenario.return_to_sender(cap);

    scenario.end();
}

#[test]
#[expected_failure(abort_code = validator::EStakeBelowMin)]
fun test_register_below_min_aborts() {
    let _scenario = setup_with_validator(MIN_STAKE - 1);
    abort 0
}

#[test]
#[expected_failure(abort_code = protocol::EPaused)]
fun test_register_while_paused_aborts() {
    let mut scenario = ts::begin(ADMIN);
    protocol::init_for_testing(scenario.ctx());

    scenario.next_tx(ADMIN);
    {
        let mut config = scenario.take_shared<ProtocolConfig>();
        let cap = scenario.take_from_sender<AdminCap>();
        protocol::admin_emergency_stop(&mut config, &cap);
        ts::return_shared(config);
        scenario.return_to_sender(cap);
    };

    scenario.next_tx(VALIDATOR);
    let config = scenario.take_shared<ProtocolConfig>();
    let clock = clock::create_for_testing(scenario.ctx());
    let coin = coin::mint_for_testing<USDC>(MIN_STAKE, scenario.ctx());
    validator::register_validator(&config, coin, &clock, scenario.ctx());

    abort 0
}

// === Top-ups ===

#[test]
fun test_add_stake_permissionless_and_while_paused() {
    let mut scenario = setup_with_validator(MIN_STAKE);

    // Pause the protocol.
    scenario.next_tx(ADMIN);
    {
        let mut config = scenario.take_shared<ProtocolConfig>();
        let cap = scenario.take_from_sender<AdminCap>();
        protocol::admin_emergency_stop(&mut config, &cap);
        ts::return_shared(config);
        scenario.return_to_sender(cap);
    };

    // A stranger (not the validator) tops up while paused: both properties at once.
    scenario.next_tx(STRANGER);
    {
        let mut pool = scenario.take_shared<ValidatorPool>();
        let coin = coin::mint_for_testing<USDC>(5 * K, scenario.ctx());
        validator::add_stake(&mut pool, coin, scenario.ctx());
        assert!(validator::stake_value(&pool) == MIN_STAKE + 5 * K);
        ts::return_shared(pool);
    };

    scenario.end();
}

// === Withdrawal floor matrix (spec §6) ===
// Stake 30k throughout. min_validator_stake = 10k.

#[test]
fun test_withdraw_full_exit_when_unencumbered() {
    // Case 1: no vouches, nothing locked — the full stake may leave.
    let mut scenario = setup_with_validator(30 * K);
    let remaining = withdraw(&mut scenario, 30 * K);
    assert!(remaining == 0);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = validator::EInsufficientFreeStake)]
fun test_withdraw_more_than_stake_aborts() {
    // Case 2: amount exceeding the balance is a clean abort, not an underflow.
    let mut scenario = setup_with_validator(30 * K);
    withdraw(&mut scenario, 30 * K + 1);
    abort 0
}

#[test]
fun test_withdraw_to_min_floor_with_vouch_ok() {
    // Case 3: locked 5k < min 10k, one vouch — the min-stake floor binds.
    let mut scenario = setup_with_validator(30 * K);
    lock(&mut scenario, 5 * K);
    let remaining = withdraw(&mut scenario, 20 * K);
    assert!(remaining == MIN_STAKE);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = validator::EInsufficientFreeStake)]
fun test_withdraw_breaching_min_floor_aborts() {
    // Case 4: one base unit past the min-stake floor.
    let mut scenario = setup_with_validator(30 * K);
    lock(&mut scenario, 5 * K);
    withdraw(&mut scenario, 20 * K + 1);
    abort 0
}

#[test]
fun test_withdraw_to_locked_floor_ok() {
    // Case 5: locked 15k > min 10k — the locked-coverage floor binds instead.
    let mut scenario = setup_with_validator(30 * K);
    lock(&mut scenario, 15 * K);
    let remaining = withdraw(&mut scenario, 15 * K);
    assert!(remaining == 15 * K);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = validator::EInsufficientFreeStake)]
fun test_withdraw_breaching_locked_floor_aborts() {
    // Case 6: one base unit past the locked-coverage floor.
    let mut scenario = setup_with_validator(30 * K);
    lock(&mut scenario, 15 * K);
    withdraw(&mut scenario, 15 * K + 1);
    abort 0
}

#[test]
fun test_release_coverage_restores_full_exit() {
    // Case 7: releasing the vouch drops both floors; full exit works again.
    let mut scenario = setup_with_validator(30 * K);
    lock(&mut scenario, 15 * K);

    scenario.next_tx(VALIDATOR);
    {
        let mut pool = scenario.take_shared<ValidatorPool>();
        validator::release_coverage(&mut pool, 15 * K);
        assert!(validator::locked(&pool) == 0);
        assert!(validator::active_vouches(&pool) == 0);
        ts::return_shared(pool);
    };

    scenario.next_tx(VALIDATOR);
    let remaining = withdraw(&mut scenario, 30 * K);
    assert!(remaining == 0);
    scenario.end();
}

// === Status lockouts ===

#[test]
#[expected_failure(abort_code = validator::EValidatorNotActive)]
fun test_withdraw_frozen_aborts() {
    let mut scenario = setup_with_validator(30 * K);
    freeze_pool(&mut scenario);
    withdraw(&mut scenario, 1);
    abort 0
}

#[test]
#[expected_failure(abort_code = validator::EValidatorNotActive)]
fun test_withdraw_slashed_aborts() {
    let mut scenario = setup_with_validator(30 * K);
    freeze_pool(&mut scenario);

    scenario.next_tx(ADMIN);
    {
        let mut pool = scenario.take_shared<ValidatorPool>();
        let slashed = validator::slash(&mut pool, 10 * K, option::none());
        slashed.destroy_for_testing();
        ts::return_shared(pool);
    };

    scenario.next_tx(VALIDATOR);
    withdraw(&mut scenario, 1);
    abort 0
}

#[test]
#[expected_failure(abort_code = validator::EValidatorNotActive)]
fun test_lock_coverage_on_frozen_aborts() {
    let mut scenario = setup_with_validator(30 * K);
    freeze_pool(&mut scenario);
    lock(&mut scenario, 1 * K);
    abort 0
}

// === Coverage accounting ===

#[test]
#[expected_failure(abort_code = validator::EInsufficientFreeStake)]
fun test_lock_coverage_exceeding_free_stake_aborts() {
    let mut scenario = setup_with_validator(30 * K);
    lock(&mut scenario, 25 * K); // free: 5k
    lock(&mut scenario, 6 * K); // exceeds free stake
    abort 0
}

#[test]
fun test_lock_coverage_accumulates_and_upholds_iv1() {
    let mut scenario = setup_with_validator(30 * K);
    lock(&mut scenario, 10 * K);
    lock(&mut scenario, 10 * K);
    lock(&mut scenario, 10 * K); // exactly the full stake: I-V1 boundary

    scenario.next_tx(VALIDATOR);
    {
        let pool = scenario.take_shared<ValidatorPool>();
        assert!(validator::locked(&pool) == 30 * K);
        assert!(validator::locked(&pool) <= validator::stake_value(&pool)); // I-V1
        assert!(validator::active_vouches(&pool) == 3); // I-V2
        assert!(validator::free_stake(&pool) == 0);
        ts::return_shared(pool);
    };

    scenario.end();
}

// === Slash engine ===

#[test]
#[expected_failure(abort_code = validator::EValidatorNotFrozen)]
fun test_slash_requires_frozen() {
    let mut scenario = setup_with_validator(30 * K);

    scenario.next_tx(ADMIN);
    let mut pool = scenario.take_shared<ValidatorPool>();
    let slashed = validator::slash(&mut pool, 10 * K, option::none());
    slashed.destroy_for_testing();

    abort 0
}

#[test]
fun test_slash_returns_balance_and_keeps_iv1() {
    let mut scenario = setup_with_validator(30 * K);
    lock(&mut scenario, 15 * K);
    freeze_pool(&mut scenario);

    scenario.next_tx(ADMIN);
    {
        let mut pool = scenario.take_shared<ValidatorPool>();
        let slashed = validator::slash(&mut pool, 15 * K, option::none());
        assert!(slashed.destroy_for_testing() == 15 * K);
        assert!(validator::is_slashed(&pool));
        assert!(validator::stake_value(&pool) == 15 * K);
        assert!(validator::locked(&pool) == 0);
        assert!(validator::locked(&pool) <= validator::stake_value(&pool)); // I-V1
        ts::return_shared(pool);
    };

    scenario.end();
}

#[test]
#[expected_failure(abort_code = validator::EValidatorNotFrozen)]
fun test_slashed_is_terminal_no_unfreeze() {
    let mut scenario = setup_with_validator(30 * K);
    freeze_pool(&mut scenario);

    scenario.next_tx(ADMIN);
    let mut pool = scenario.take_shared<ValidatorPool>();
    let slashed = validator::slash(&mut pool, 10 * K, option::none());
    slashed.destroy_for_testing();

    // SLASHED is terminal: no path back to ACTIVE.
    validator::unfreeze_pool(&mut pool, option::none());

    abort 0
}

#[test]
fun test_unfreeze_restores_active() {
    let mut scenario = setup_with_validator(30 * K);
    freeze_pool(&mut scenario);

    scenario.next_tx(ADMIN);
    {
        let mut pool = scenario.take_shared<ValidatorPool>();
        validator::unfreeze_pool(&mut pool, option::none());
        assert!(validator::is_active(&pool));
        ts::return_shared(pool);
    };

    // Withdrawal works again after the dispute clears.
    scenario.next_tx(VALIDATOR);
    let remaining = withdraw(&mut scenario, 30 * K);
    assert!(remaining == 0);
    scenario.end();
}

// === Capability binding ===

#[test]
#[expected_failure(abort_code = validator::EWrongValidatorCap)]
fun test_wrong_cap_rejected() {
    let mut scenario = setup_with_validator(30 * K);

    scenario.next_tx(VALIDATOR);
    let mut pool = scenario.take_shared<ValidatorPool>();
    let config = scenario.take_shared<ProtocolConfig>();
    // A cap pointing at a different (nonexistent) pool ID.
    let forged = validator::new_cap_for_testing(object::id(&config), scenario.ctx());

    let coin = validator::withdraw_stake(&mut pool, &forged, &config, 1, scenario.ctx());
    coin.burn_for_testing();

    abort 0
}

// === Helpers (private) ===

/// Locks `amount` of coverage on the (single) shared pool as a new tx.
fun lock(scenario: &mut ts::Scenario, amount: u64) {
    scenario.next_tx(VALIDATOR);
    let mut pool = scenario.take_shared<ValidatorPool>();
    validator::lock_coverage(&mut pool, amount);
    ts::return_shared(pool);
}

/// Freezes the (single) shared pool as a new tx.
fun freeze_pool(scenario: &mut ts::Scenario) {
    scenario.next_tx(ADMIN);
    let mut pool = scenario.take_shared<ValidatorPool>();
    validator::freeze_pool(&mut pool, option::none());
    ts::return_shared(pool);
}
