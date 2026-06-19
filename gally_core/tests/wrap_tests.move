/// M5 test suite (work order: milestone/gally core/m5.md).
/// Covers: force-claim on wrap, the round-trip zero-yield theorem, the
/// live-index snapshot on unwrap, freeze semantics (wrap blocked, unwrap
/// open), pause semantics (same asymmetry), cooldown boundaries including
/// immediate re-wrap, the first-unwrapper rollover capture, split→wrap in
/// one transaction, foreign-share rejection, and a 600-step LCG fuzz
/// asserting supply parity (I-W1), I-W2, I-M1 and I-M2 after every step.
#[test_only]
module gally_core::wrap_tests;

use gally_core::accumulator::{Self, GlobalYieldAccumulator};
use gally_core::asset::{Self, Asset, ContributionReceipt, EntityCap};
use gally_core::wrap_token::{Self, WRAP_TOKEN};
use gally_core::protocol::{Self, AdminCap, ProtocolConfig};
use gally_core::share::{Self, GallyShare};
use usdc::usdc::USDC;
use gally_core::validator::{Self, ValidatorCap, ValidatorPool};
use sui::balance;
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::test_scenario as ts;


const ADMIN: address = @0xA1;
const VALIDATOR: address = @0xC3;
const ENTITY: address = @0xE5;
const ALICE: address = @0xAA; // 60k shares
const BOB: address = @0xBB; // 40k shares
const STRANGER: address = @0xD4;

const GOAL: u64 = 100_000_000_000;
const COLLATERAL: u64 = 10_000_000_000;
const STAKE: u64 = 30_000_000_000;
const ALICE_SHARES: u64 = 60_000_000_000;
const BOB_SHARES: u64 = 40_000_000_000;
const FUNDING_DEADLINE_MS: u64 = 10_000;

const GROSS: u64 = 1_000_000_000; // 1,000 USDC
const INVESTOR: u64 = 495_000_000; // post-fee investor portion at 1%/50%

/// Receipts convert at t=5_000; default cooldown is 1h, so wraps are legal
/// from t = 5_000 + 3_600_000.
const CONVERT_MS: u64 = 5_000;
const WRAP_MS: u64 = 3_605_000;

// === Helpers ===

fun make_clock(s: &mut ts::Scenario, ms: u64): Clock {
    let mut c = clock::create_for_testing(s.ctx());
    c.set_for_testing(ms);
    c
}

fun to_operational(): ts::Scenario {
    let mut s = ts::begin(ADMIN);
    protocol::init_for_testing(s.ctx());

    s.next_tx(VALIDATOR);
    {
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, 0);
        validator::register_validator_for_testing(
            &config,
            coin::mint_for_testing<USDC>(STAKE, s.ctx()),
            &clock,
            s.ctx(),
        );
        clock.destroy_for_testing();
        ts::return_shared(config);
    };

    s.next_tx(ENTITY);
    {
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, 0);
        asset::create_asset_for_testing(
            &config,
            GOAL,
            FUNDING_DEADLINE_MS,
            vector[40_000_000_000, 35_000_000_000, 25_000_000_000],
            vector[b"land", b"build", b"fit-out"],
            vector[20_000, 30_000, 40_000],
            5_000,
            coin::mint_for_testing<USDC>(COLLATERAL, s.ctx()),
            &clock,
            s.ctx(),
        );
        clock.destroy_for_testing();
        ts::return_shared(config);
    };

    s.next_tx(VALIDATOR);
    {
        let mut asset = s.take_shared<Asset>();
        let mut pool = s.take_shared<ValidatorPool>();
        let vcap = s.take_from_sender<ValidatorCap>();
        let config = s.take_shared<ProtocolConfig>();
        let docs = vector[asset::new_walrus_ref(b"deed", b"sha", s.ctx())];
        asset::vouch_asset_legals(&mut asset, &mut pool, &vcap, &config, docs, s.ctx());
        ts::return_shared(asset);
        ts::return_shared(pool);
        ts::return_shared(config);
        s.return_to_sender(vcap);
    };

    fund(&mut s, ALICE, ALICE_SHARES);
    fund(&mut s, BOB, BOB_SHARES);

    s.next_tx(STRANGER);
    {
        let mut asset = s.take_shared<Asset>();
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, 3_000);
        let (cap, metadata) = wrap_token::new(s.ctx());
        asset::finalize_successful_raise<WRAP_TOKEN>(&mut asset, &config, cap, &metadata, &clock, s.ctx());
        transfer::public_freeze_object(metadata);
        clock.destroy_for_testing();
        ts::return_shared(asset);
        ts::return_shared(config);
    };

    let mut i = 0u64;
    while (i < 3) {
        run_tranche(&mut s, i);
        i = i + 1;
    };
    s
}

fun fund(s: &mut ts::Scenario, who: address, amount: u64) {
    s.next_tx(who);
    let mut asset = s.take_shared<Asset>();
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(s, 1_000);
    let change = asset::contribute_capital(
        &mut asset,
        &config,
        &clock,
        coin::mint_for_testing<USDC>(amount, s.ctx()),
        s.ctx(),
    );
    change.burn_for_testing();
    clock.destroy_for_testing();
    ts::return_shared(asset);
    ts::return_shared(config);
}

fun run_tranche(s: &mut ts::Scenario, index: u64) {
    s.next_tx(ENTITY);
    {
        let mut asset = s.take_shared<Asset>();
        let config = s.take_shared<ProtocolConfig>();
        let ecap = s.take_from_sender<EntityCap>();
        let proof = asset::new_walrus_ref(b"proof", b"sha", s.ctx());
        asset::submit_milestone_proof(&mut asset, &ecap, &config, index, proof);
        ts::return_shared(asset);
        ts::return_shared(config);
        s.return_to_sender(ecap);
    };
    s.next_tx(VALIDATOR);
    {
        let mut asset = s.take_shared<Asset>();
        let pool = s.take_shared<ValidatorPool>();
        let vcap = s.take_from_sender<ValidatorCap>();
        let config = s.take_shared<ProtocolConfig>();
        asset::approve_milestone(&mut asset, &pool, &vcap, &config, index, s.ctx());
        ts::return_shared(asset);
        ts::return_shared(pool);
        ts::return_shared(config);
        s.return_to_sender(vcap);
    };
    s.next_tx(ENTITY);
    {
        let mut asset = s.take_shared<Asset>();
        let config = s.take_shared<ProtocolConfig>();
        let ecap = s.take_from_sender<EntityCap>();
        let payout = asset::release_funding_tranche(&mut asset, &ecap, &config, index, s.ctx());
        payout.burn_for_testing();
        ts::return_shared(asset);
        ts::return_shared(config);
        s.return_to_sender(ecap);
    };
}

fun convert_receipt(s: &mut ts::Scenario, who: address) {
    s.next_tx(who);
    let asset = s.take_shared<Asset>();
    let acc = s.take_shared<GlobalYieldAccumulator<WRAP_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    let receipt = s.take_from_sender<ContributionReceipt>();
    let clock = make_clock(s, CONVERT_MS);
    let minted =
        asset::claim_shares<WRAP_TOKEN>(&asset, &acc, &config, receipt, &clock, s.ctx());
    transfer::public_transfer(minted, who);
    clock.destroy_for_testing();
    ts::return_shared(asset);
    ts::return_shared(acc);
    ts::return_shared(config);
}

fun deposit(s: &mut ts::Scenario, gross: u64) {
    s.next_tx(STRANGER);
    let asset = s.take_shared<Asset>();
    let mut acc = s.take_shared<GlobalYieldAccumulator<WRAP_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    asset::deposit_revenue<WRAP_TOKEN>(
        &asset,
        &mut acc,
        &config,
        coin::mint_for_testing<USDC>(gross, s.ctx()),
        s.ctx(),
    );
    ts::return_shared(asset);
    ts::return_shared(acc);
    ts::return_shared(config);
}

/// Wraps `who`'s inventory share at `now_ms`; coin goes to their inventory.
/// Returns (wrapped count, force-claimed yield).
fun wrap(s: &mut ts::Scenario, who: address, now_ms: u64): (u64, u64) {
    s.next_tx(who);
    let mut acc = s.take_shared<GlobalYieldAccumulator<WRAP_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    let sh = s.take_from_sender<GallyShare>();
    let clock = make_clock(s, now_ms);

    let (wrapped, yield_coin) = accumulator::wrap_shares(&mut acc, &config, sh, &clock, s.ctx());
    let count = wrapped.value();
    let yield_value = yield_coin.burn_for_testing();
    transfer::public_transfer(wrapped, who);

    // I-W1 after every wrap.
    assert!(
        accumulator::wrapped_coin_supply(&acc) == accumulator::total_wrapped_shares(&acc),
    );

    clock.destroy_for_testing();
    ts::return_shared(acc);
    ts::return_shared(config);
    (count, yield_value)
}

/// Unwraps `who`'s inventory coin at `now_ms`; the fresh share goes to
/// their inventory.
fun unwrap(s: &mut ts::Scenario, who: address, now_ms: u64) {
    s.next_tx(who);
    let mut acc = s.take_shared<GlobalYieldAccumulator<WRAP_TOKEN>>();
    let c = s.take_from_sender<Coin<WRAP_TOKEN>>();
    let clock = make_clock(s, now_ms);

    let fresh = accumulator::unwrap_coins(&mut acc, c, &clock, s.ctx());
    transfer::public_transfer(fresh, who);

    // I-W1 after every unwrap.
    assert!(
        accumulator::wrapped_coin_supply(&acc) == accumulator::total_wrapped_shares(&acc),
    );

    clock.destroy_for_testing();
    ts::return_shared(acc);
}

fun claim(s: &mut ts::Scenario, who: address): u64 {
    s.next_tx(who);
    let mut acc = s.take_shared<GlobalYieldAccumulator<WRAP_TOKEN>>();
    let mut sh = s.take_from_sender<GallyShare>();
    let payout = accumulator::claim_rewards(&mut acc, &mut sh, s.ctx());
    let value = payout.burn_for_testing();
    ts::return_shared(acc);
    s.return_to_sender(sh);
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

// === Force-claim on wrap ===

#[test]
fun test_wrap_force_claims_pending_yield() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE);
    deposit(&mut s, GROSS);

    // Pending 297 USDC settles in the wrap transaction itself; the coin is
    // exact face value; the counter reflects the wrap.
    let (count, yield_value) = wrap(&mut s, ALICE, WRAP_MS);
    assert!(count == ALICE_SHARES);
    assert!(yield_value == 297_000_000);

    s.next_tx(STRANGER);
    let acc = s.take_shared<GlobalYieldAccumulator<WRAP_TOKEN>>();
    assert!(accumulator::total_wrapped_shares(&acc) == ALICE_SHARES);
    ts::return_shared(acc);
    s.end();
}

// === The round-trip theorem (spec §12) ===

#[test]
fun test_round_trip_zero_yield_theorem() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);

    // ALICE wraps; revenue lands TWICE while she is wrapped.
    let (_, y) = wrap(&mut s, ALICE, WRAP_MS);
    assert!(y == 0); // nothing pending pre-deposit
    deposit(&mut s, GROSS);
    deposit(&mut s, GROSS);

    // BOB (unwrapped, 40k = the whole denominator) earns it all.
    assert!(claim(&mut s, BOB) == 2 * INVESTOR);

    // ALICE unwraps and claims: exactly zero for the wrapped period.
    unwrap(&mut s, ALICE, WRAP_MS + 1_000);
    assert!(claim(&mut s, ALICE) == 0);
    s.end();
}

#[test]
fun test_unwrap_share_snapshot_is_live_index() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB); // keeps unwrapped supply nonzero
    wrap(&mut s, ALICE, WRAP_MS);
    deposit(&mut s, GROSS); // index moves while ALICE is wrapped

    unwrap(&mut s, ALICE, WRAP_MS + 999);

    s.next_tx(ALICE);
    {
        let acc = s.take_shared<GlobalYieldAccumulator<WRAP_TOKEN>>();
        let sh = s.take_from_sender<GallyShare>();
        assert!(share::share_count(&sh) == ALICE_SHARES);
        assert!(
            share::yield_claimed_index(&sh) == accumulator::cumulative_yield_index(&acc),
        );
        assert!(share::acquired_at_ms(&sh) == WRAP_MS + 999);
        assert!(accumulator::pending_payout(&acc, &sh) == 0);
        s.return_to_sender(sh);
        ts::return_shared(acc);
    };
    s.end();
}

// === Freeze semantics (D5) ===

#[test]
#[expected_failure(abort_code = accumulator::EWrappingFrozen)]
fun test_wrap_frozen_aborts() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE);

    // A compensation event freezes the vault (package fn, as M6 will call it).
    s.next_tx(STRANGER);
    {
        let mut acc = s.take_shared<GlobalYieldAccumulator<WRAP_TOKEN>>();
        accumulator::add_to_compensation_pool(
            &mut acc,
            balance::create_for_testing<USDC>(1_000),
            999_999_999,
        );
        ts::return_shared(acc);
    };

    wrap(&mut s, ALICE, WRAP_MS);
    abort 0
}

#[test]
fun test_unwrap_open_while_frozen() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);
    wrap(&mut s, ALICE, WRAP_MS);

    // Freeze lands AFTER the wrap: exactly the D5 grace-window situation.
    s.next_tx(STRANGER);
    {
        let mut acc = s.take_shared<GlobalYieldAccumulator<WRAP_TOKEN>>();
        accumulator::add_to_compensation_pool(
            &mut acc,
            balance::create_for_testing<USDC>(1_000),
            999_999_999,
        );
        ts::return_shared(acc);
    };

    // Unwrapping must work ESPECIALLY now — it is how wrapped holders join
    // the restitution before the M6 sweep.
    unwrap(&mut s, ALICE, WRAP_MS + 500);

    s.next_tx(ALICE);
    let sh = s.take_from_sender<GallyShare>();
    assert!(share::share_count(&sh) == ALICE_SHARES);
    s.return_to_sender(sh);
    s.end();
}

// === Pause semantics (D6) ===

#[test]
#[expected_failure(abort_code = protocol::EPaused)]
fun test_wrap_while_paused_aborts() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE);
    pause_protocol(&mut s);
    wrap(&mut s, ALICE, WRAP_MS);
    abort 0
}

#[test]
fun test_unwrap_works_while_paused() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);
    wrap(&mut s, ALICE, WRAP_MS);
    pause_protocol(&mut s);

    unwrap(&mut s, ALICE, WRAP_MS + 500); // exit path: no pause check exists

    s.next_tx(ALICE);
    let sh = s.take_from_sender<GallyShare>();
    assert!(share::share_count(&sh) == ALICE_SHARES);
    s.return_to_sender(sh);
    s.end();
}

// === Cooldown boundaries ===

#[test]
fun test_wrap_at_exact_cooldown_boundary_ok() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE); // acquired_at == 5_000
    let (count, _) = wrap(&mut s, ALICE, CONVERT_MS + 3_600_000); // exactly at
    assert!(count == ALICE_SHARES);
    s.end();
}

#[test]
#[expected_failure(abort_code = accumulator::EWrapCooldown)]
fun test_wrap_one_ms_before_cooldown_aborts() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE);
    wrap(&mut s, ALICE, CONVERT_MS + 3_600_000 - 1);
    abort 0
}

#[test]
#[expected_failure(abort_code = accumulator::EWrapCooldown)]
fun test_rewrap_immediately_after_unwrap_aborts() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);
    wrap(&mut s, ALICE, WRAP_MS);
    unwrap(&mut s, ALICE, WRAP_MS + 1_000); // fresh share: acquired_at resets

    // Same instant re-wrap: the oscillation the cooldown exists to damp.
    wrap(&mut s, ALICE, WRAP_MS + 1_000);
    abort 0
}

// === First-unwrapper rollover capture (spec §12 step 3) ===

#[test]
fun test_unwrap_sweeps_rollover_and_unwrapper_participates() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);
    wrap(&mut s, ALICE, WRAP_MS);
    wrap(&mut s, BOB, WRAP_MS);

    // 100% wrapped: the deposit parks in the rollover reserve.
    deposit(&mut s, GROSS);
    s.next_tx(STRANGER);
    {
        let acc = s.take_shared<GlobalYieldAccumulator<WRAP_TOKEN>>();
        assert!(accumulator::rollover_reserve_value(&acc) == INVESTOR);
        assert!(accumulator::cumulative_yield_index(&acc) == 0);
        ts::return_shared(acc);
    };

    // BOB unwraps first: decrement (unwrapped=40k) → mint at pre-sweep
    // index 0 → sweep over 40k. His fresh share captures the whole reserve.
    unwrap(&mut s, BOB, WRAP_MS + 1_000);

    s.next_tx(STRANGER);
    {
        let acc = s.take_shared<GlobalYieldAccumulator<WRAP_TOKEN>>();
        assert!(accumulator::rollover_reserve_value(&acc) == 0);
        assert!(accumulator::cumulative_yield_index(&acc) == 12_375_000); // 495e6×1e9/4e10
        ts::return_shared(acc);
    };
    assert!(claim(&mut s, BOB) == INVESTOR);

    // ALICE unwraps after the sweep: snapshot is post-sweep, she gets none
    // of it — she was wrapped when the revenue arrived.
    unwrap(&mut s, ALICE, WRAP_MS + 2_000);
    assert!(claim(&mut s, ALICE) == 0);
    s.end();
}

// === PTB composition ===

#[test]
fun test_split_then_wrap_single_tx() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE);

    // Fractional wrap, one transaction: split_share → wrap_shares (spec §12).
    s.next_tx(ALICE);
    {
        let mut acc = s.take_shared<GlobalYieldAccumulator<WRAP_TOKEN>>();
        let config = s.take_shared<ProtocolConfig>();
        let mut parent = s.take_from_sender<GallyShare>();
        let clock = make_clock(&mut s, WRAP_MS);

        let child = share::split_share(&mut parent, 20_000_000_000, s.ctx());
        let (wrapped, yield_coin) =
            accumulator::wrap_shares(&mut acc, &config, child, &clock, s.ctx());

        assert!(wrapped.value() == 20_000_000_000);
        assert!(share::share_count(&parent) == 40_000_000_000); // untouched
        assert!(yield_coin.burn_for_testing() == 0);
        assert!(
            accumulator::wrapped_coin_supply(&acc)
                == accumulator::total_wrapped_shares(&acc),
        );

        transfer::public_transfer(wrapped, ALICE);
        s.return_to_sender(parent);
        clock.destroy_for_testing();
        ts::return_shared(acc);
        ts::return_shared(config);
    };
    s.end();
}

#[test]
#[expected_failure(abort_code = accumulator::EShareAssetMismatch)]
fun test_wrap_foreign_share_aborts() {
    let mut s = to_operational();

    s.next_tx(ALICE);
    let mut acc = s.take_shared<GlobalYieldAccumulator<WRAP_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    let forged = share::mint_for_testing(sui::object::id(&config), 1_000, 0, s.ctx());
    let clock = make_clock(&mut s, WRAP_MS);
    let (wrapped, yield_coin) =
        accumulator::wrap_shares(&mut acc, &config, forged, &clock, s.ctx());
    yield_coin.burn_for_testing();
    transfer::public_transfer(wrapped, ALICE);
    abort 0
}

// === Supply-parity fuzz (m5.md pass criterion 1) ===

/// Deterministic LCG (Knuth MMIX constants), u128 internals.
fun next_rand(state: u64): u64 {
    let s = (state as u128) * 6364136223846793005u128 + 1442695040888963407u128;
    ((s % 18446744073709551616u128) as u64)
}

#[test]
fun test_supply_parity_invariant_fuzz() {
    let mut s = to_operational();

    // Zero cooldown so the fuzzer can toggle wrap state freely.
    s.next_tx(ADMIN);
    {
        let mut config = s.take_shared<ProtocolConfig>();
        let cap = s.take_from_sender<AdminCap>();
        protocol::admin_set_min_wrap_duration_ms(&mut config, &cap, 0);
        ts::return_shared(config);
        s.return_to_sender(cap);
    };

    s.next_tx(STRANGER);
    {
        let mut acc = s.take_shared<GlobalYieldAccumulator<WRAP_TOKEN>>();
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, 10_000_000);

        // Holders mirroring the cap table; each is EITHER a share or a coin.
        let mut alice_share =
            option::some(share::mint_for_testing(
                accumulator::asset_id(&acc),
                ALICE_SHARES,
                0,
                s.ctx(),
            ));
        let mut alice_coin = option::none<Coin<WRAP_TOKEN>>();
        let mut bob_share =
            option::some(share::mint_for_testing(
                accumulator::asset_id(&acc),
                BOB_SHARES,
                0,
                s.ctx(),
            ));
        let mut bob_coin = option::none<Coin<WRAP_TOKEN>>();

        let mut rng = 0xDEAD_BEEF_CAFE_F00Du64;
        let mut last_index = 0u128;
        let mut step = 0u64;
        while (step < 600) {
            rng = next_rand(rng);
            let op = rng % 4;

            if (op == 0) {
                // Revenue (1 .. 2e9 raw): rollover branch exercised whenever
                // the fuzzer has both holders wrapped.
                let amount = (rng % 2_000_000_000) + 1;
                accumulator::add_revenue(&mut acc, balance::create_for_testing<USDC>(amount));
            } else if (op == 1) {
                // Toggle ALICE.
                if (alice_share.is_some()) {
                    let sh = alice_share.extract();
                    let (c, y) =
                        accumulator::wrap_shares(&mut acc, &config, sh, &clock, s.ctx());
                    y.burn_for_testing();
                    alice_coin.fill(c);
                } else {
                    let c = alice_coin.extract();
                    let sh = accumulator::unwrap_coins(&mut acc, c, &clock, s.ctx());
                    alice_share.fill(sh);
                };
            } else if (op == 2) {
                // Toggle BOB.
                if (bob_share.is_some()) {
                    let sh = bob_share.extract();
                    let (c, y) =
                        accumulator::wrap_shares(&mut acc, &config, sh, &clock, s.ctx());
                    y.burn_for_testing();
                    bob_coin.fill(c);
                } else {
                    let c = bob_coin.extract();
                    let sh = accumulator::unwrap_coins(&mut acc, c, &clock, s.ctx());
                    bob_share.fill(sh);
                };
            } else {
                // Claim whichever holder is unwrapped (no-op if wrapped).
                if (rng % 2 == 0 && alice_share.is_some()) {
                    let c =
                        accumulator::claim_rewards(&mut acc, alice_share.borrow_mut(), s.ctx());
                    c.burn_for_testing();
                } else if (bob_share.is_some()) {
                    let c =
                        accumulator::claim_rewards(&mut acc, bob_share.borrow_mut(), s.ctx());
                    c.burn_for_testing();
                };
            };

            // I-W1: coin supply == wrapped counter, after EVERY operation.
            assert!(
                accumulator::wrapped_coin_supply(&acc)
                    == accumulator::total_wrapped_shares(&acc),
            );
            // I-W2.
            assert!(
                accumulator::total_wrapped_shares(&acc)
                    <= accumulator::total_minted_shares(&acc),
            );
            // I-M1.
            assert!(accumulator::cumulative_yield_index(&acc) >= last_index);
            last_index = accumulator::cumulative_yield_index(&acc);
            // I-M2 over every live share object.
            let mut owed = 0u64;
            if (alice_share.is_some()) {
                owed = owed + accumulator::pending_payout(&acc, alice_share.borrow());
            };
            if (bob_share.is_some()) {
                owed = owed + accumulator::pending_payout(&acc, bob_share.borrow());
            };
            assert!(accumulator::reward_pool_value(&acc) >= owed);

            step = step + 1;
        };

        // Hand everything back to the holders and close.
        if (alice_share.is_some()) {
            transfer::public_transfer(alice_share.extract(), ALICE);
        };
        alice_share.destroy_none();
        if (alice_coin.is_some()) {
            transfer::public_transfer(alice_coin.extract(), ALICE);
        };
        alice_coin.destroy_none();
        if (bob_share.is_some()) {
            transfer::public_transfer(bob_share.extract(), BOB);
        };
        bob_share.destroy_none();
        if (bob_coin.is_some()) {
            transfer::public_transfer(bob_coin.extract(), BOB);
        };
        bob_coin.destroy_none();

        clock.destroy_for_testing();
        ts::return_shared(acc);
        ts::return_shared(config);
    };
    s.end();
}
