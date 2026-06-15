/// SIM-M1 test suite (work order: milestone/live-simulation/m1.md).
/// Proves the §2 faucet contract and simulation invariants SI-1 (single claim)
/// and SI-2 (faucet solvency). Test USDC is minted with
/// `coin::mint_for_testing<USDC>` — no live `TreasuryCap` needed in unit tests.
#[test_only]
module gally_mock_faucet::faucet_tests;

use gally_core::usdc::USDC;
use gally_mock_faucet::faucet::{Self, MockFaucet, FaucetOperatorCap};
use sui::coin;
use sui::test_scenario as ts;

const OPERATOR: address = @0xA;
const USER: address = @0xB;
const USER2: address = @0xC;

/// Must match `faucet::DEFAULT_ALLOCATION` (25,000 USDC).
const ALLOCATION: u64 = 25_000_000_000;
/// A healthy reservoir top-up (500,000 USDC).
const BIG_REFILL: u64 = 500_000_000_000;

/// Stand up a shared faucet (reservoir starts empty) and return the scenario.
fun begin_faucet(): ts::Scenario {
    let mut s = ts::begin(OPERATOR);
    faucet::init_for_testing(s.ctx());
    s
}

/// Mint `amount` test USDC as `caller` and `refill` the shared faucet with it.
fun do_refill(s: &mut ts::Scenario, caller: address, amount: u64) {
    s.next_tx(caller);
    let mut faucet = s.take_shared<MockFaucet>();
    let c = coin::mint_for_testing<USDC>(amount, s.ctx());
    faucet.refill(c, s.ctx());
    ts::return_shared(faucet);
}

/// A first claim returns exactly `allocation`; the reservoir drops by it; the
/// claimant is recorded; telemetry counters advance.
#[test]
fun test_claim_once_pays_allocation() {
    let mut s = begin_faucet();
    do_refill(&mut s, OPERATOR, BIG_REFILL);

    s.next_tx(USER);
    let mut faucet = s.take_shared<MockFaucet>();
    let before = faucet.reservoir_value();
    let c = faucet.claim(s.ctx());

    assert!(c.value() == ALLOCATION, 0);
    assert!(faucet.reservoir_value() == before - ALLOCATION, 1);
    assert!(faucet.has_claimed(USER), 2);
    assert!(faucet.claim_count() == 1, 3);
    assert!(faucet.total_claimed() == ALLOCATION, 4);

    coin::burn_for_testing(c);
    ts::return_shared(faucet);
    s.end();
}

/// SI-1: a second claim by the same address aborts `EAlreadyClaimed`.
#[test]
#[expected_failure(abort_code = faucet::EAlreadyClaimed)]
fun test_second_claim_aborts() {
    let mut s = begin_faucet();
    do_refill(&mut s, OPERATOR, BIG_REFILL);

    s.next_tx(USER);
    let mut faucet = s.take_shared<MockFaucet>();
    let c1 = faucet.claim(s.ctx());
    coin::burn_for_testing(c1);
    let c2 = faucet.claim(s.ctx()); // aborts: already in `claimants`
    coin::burn_for_testing(c2);

    ts::return_shared(faucet);
    s.end();
}

/// SI-2: claiming when `reservoir < allocation` aborts `EReservoirEmpty`.
#[test]
#[expected_failure(abort_code = faucet::EReservoirEmpty)]
fun test_claim_empty_aborts() {
    let mut s = begin_faucet(); // reservoir is 0, never refilled

    s.next_tx(USER);
    let mut faucet = s.take_shared<MockFaucet>();
    let c = faucet.claim(s.ctx()); // aborts: 0 < allocation
    coin::burn_for_testing(c);

    ts::return_shared(faucet);
    s.end();
}

/// `refill` adds the coin's value to the reservoir; a non-operator caller works
/// (permissionless).
#[test]
fun test_refill_increases_reservoir() {
    let mut s = begin_faucet();

    s.next_tx(USER); // not the operator — refill is permissionless
    let mut faucet = s.take_shared<MockFaucet>();
    let before = faucet.reservoir_value();
    let c = coin::mint_for_testing<USDC>(BIG_REFILL, s.ctx());
    faucet.refill(c, s.ctx());

    assert!(faucet.reservoir_value() == before + BIG_REFILL, 0);
    ts::return_shared(faucet);
    s.end();
}

/// A zero-value refill aborts `EZeroAmount`.
#[test]
#[expected_failure(abort_code = faucet::EZeroAmount)]
fun test_refill_zero_aborts() {
    let mut s = begin_faucet();

    s.next_tx(USER);
    let mut faucet = s.take_shared<MockFaucet>();
    let c = coin::mint_for_testing<USDC>(0, s.ctx());
    faucet.refill(c, s.ctx()); // aborts: zero deposit
    ts::return_shared(faucet);
    s.end();
}

/// The cap-gated setters change their parameters and emit on the operator's
/// authority. (The `FaucetOperatorCap` requirement is enforced by the type
/// system — there is no path to call these without holding the cap.)
#[test]
fun test_admin_setters_gated() {
    let mut s = begin_faucet();

    s.next_tx(OPERATOR);
    let mut faucet = s.take_shared<MockFaucet>();
    let cap = s.take_from_sender<FaucetOperatorCap>();

    faucet.admin_set_allocation(&cap, 1_000_000);
    assert!(faucet.allocation() == 1_000_000, 0);

    faucet.admin_set_low_water_mark(&cap, 2_000_000);
    assert!(faucet.low_water_mark() == 2_000_000, 1);

    s.return_to_sender(cap);
    ts::return_shared(faucet);
    s.end();
}

/// `has_claimed` is false pre-claim, true post-claim, and scoped per address.
#[test]
fun test_has_claimed_view() {
    let mut s = begin_faucet();
    do_refill(&mut s, OPERATOR, BIG_REFILL);

    s.next_tx(USER);
    let mut faucet = s.take_shared<MockFaucet>();
    assert!(!faucet.has_claimed(USER), 0);

    let c = faucet.claim(s.ctx());
    coin::burn_for_testing(c);

    assert!(faucet.has_claimed(USER), 1);
    assert!(!faucet.has_claimed(USER2), 2);

    ts::return_shared(faucet);
    s.end();
}
