/// M4 test suite (work order: milestone/gally core/m4.md).
/// Covers: exact three-way revenue split, proportional multi-holder claims,
/// zero-delta no-ops, the div-by-zero rollover branch and its rescue, the
/// emergent diamond-hand multiplier (2.5× at 60% wrapped), dust flooring in
/// the solvency-safe direction, merge semantics, the payout overflow guard,
/// pause conformance (deposit gated, claim never), and a deposit/claim
/// sequence asserting I-M1 (monotonic index) and I-M2 (solvency) at every
/// step. The full randomized fuzz lands in M7.
#[test_only]
module gally_core::accumulator_tests;

use gally_core::accumulator::{Self, GlobalYieldAccumulator};
use gally_core::asset::{Self, Asset, ContributionReceipt, EntityCap};
use gally_core::protocol::{Self, AdminCap, ProtocolConfig};
use gally_core::share::{Self, GallyShare};
use gally_core::usdc::USDC;
use gally_core::validator::{Self, ValidatorCap, ValidatorPool};
use sui::balance;
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::test_scenario as ts;

/// Witness for this suite's asset token type.
public struct ACC_TOKEN has drop {}

const ADMIN: address = @0xA1; // also the protocol treasury (init default)
const VALIDATOR: address = @0xC3;
const ENTITY: address = @0xE5;
const ALICE: address = @0xAA; // 60k shares
const BOB: address = @0xBB; // 40k shares
const STRANGER: address = @0xD4;

const GOAL: u64 = 100_000_000_000; // 100k USDC == 100k shares
const COLLATERAL: u64 = 10_000_000_000;
const STAKE: u64 = 30_000_000_000;
const ALICE_SHARES: u64 = 60_000_000_000;
const BOB_SHARES: u64 = 40_000_000_000;

const FUNDING_DEADLINE_MS: u64 = 10_000;

/// 1,000 USDC gross deposit and its normative split at 1% fee / 50% split.
const GROSS: u64 = 1_000_000_000;
const FEE: u64 = 10_000_000; // 1%
const INVESTOR: u64 = 495_000_000; // 50% of (gross − fee)
const ENTITY_CUT: u64 = 495_000_000;
/// Δindex for INVESTOR over 100k unwrapped shares: 495e6 × 1e9 / 1e11.
const BASE_DELTA: u128 = 4_950_000;

// === Helpers ===

fun make_clock(s: &mut ts::Scenario, ms: u64): Clock {
    let mut c = clock::create_for_testing(s.ctx());
    c.set_for_testing(ms);
    c
}

/// Full pipeline to OPERATIONAL: publish, register validator, create asset,
/// vouch, fund (ALICE 60k / BOB 40k), finalize, run all three tranches.
fun to_operational(): ts::Scenario {
    let mut s = ts::begin(ADMIN);
    protocol::init_for_testing(s.ctx());

    s.next_tx(VALIDATOR);
    {
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, 0);
        validator::register_validator(
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
        asset::create_asset(
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
        let cap = coin::create_treasury_cap_for_testing<ACC_TOKEN>(s.ctx());
        asset::finalize_successful_raise<ACC_TOKEN>(&mut asset, &config, cap, &clock, s.ctx());
        clock.destroy_for_testing();
        ts::return_shared(asset);
        ts::return_shared(config);
    };

    let mut i = 0;
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

/// Converts `who`'s receipt into a GallyShare held in their inventory.
fun convert_receipt(s: &mut ts::Scenario, who: address) {
    s.next_tx(who);
    let asset = s.take_shared<Asset>();
    let acc = s.take_shared<GlobalYieldAccumulator<ACC_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    let receipt = s.take_from_sender<ContributionReceipt>();
    let clock = make_clock(s, 5_000);
    let minted =
        asset::claim_shares<ACC_TOKEN>(&asset, &acc, &config, receipt, &clock, s.ctx());
    transfer::public_transfer(minted, who);
    clock.destroy_for_testing();
    ts::return_shared(asset);
    ts::return_shared(acc);
    ts::return_shared(config);
}

/// STRANGER deposits `gross` revenue (permissionless by design).
fun deposit(s: &mut ts::Scenario, gross: u64) {
    s.next_tx(STRANGER);
    let asset = s.take_shared<Asset>();
    let mut acc = s.take_shared<GlobalYieldAccumulator<ACC_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    asset::deposit_revenue<ACC_TOKEN>(
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

/// `who` claims yield on the share in their inventory; returns the payout.
fun claim(s: &mut ts::Scenario, who: address): u64 {
    s.next_tx(who);
    let mut acc = s.take_shared<GlobalYieldAccumulator<ACC_TOKEN>>();
    let mut sh = s.take_from_sender<GallyShare>();
    let payout = accumulator::claim_rewards(&mut acc, &mut sh, s.ctx());
    let value = payout.burn_for_testing();
    ts::return_shared(acc);
    s.return_to_sender(sh);
    value
}

// === Three-way split (Flow F) ===

#[test]
fun test_deposit_three_way_split_exact() {
    let mut s = to_operational();
    deposit(&mut s, GROSS);

    s.next_tx(STRANGER);
    {
        let acc = s.take_shared<GlobalYieldAccumulator<ACC_TOKEN>>();
        assert!(accumulator::reward_pool_value(&acc) == INVESTOR);
        assert!(accumulator::cumulative_yield_index(&acc) == BASE_DELTA);
        assert!(accumulator::rollover_reserve_value(&acc) == 0);
        ts::return_shared(acc);
    };

    // Fee landed at the treasury (ADMIN), remainder at the entity, and the
    // three parts reassemble the gross exactly — no unit lost or created.
    s.next_tx(ADMIN);
    {
        let fee_coin = s.take_from_sender<Coin<USDC>>();
        assert!(fee_coin.burn_for_testing() == FEE);
    };
    s.next_tx(ENTITY);
    {
        let entity_coin = s.take_from_sender<Coin<USDC>>();
        assert!(entity_coin.burn_for_testing() == ENTITY_CUT);
    };
    assert!(FEE + INVESTOR + ENTITY_CUT == GROSS);
    s.end();
}

// === Claims (Flow G) ===

#[test]
fun test_two_holders_claim_proportional() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);
    deposit(&mut s, GROSS);

    // 60% / 40% of the investor portion, to the unit; pool drains to zero.
    assert!(claim(&mut s, ALICE) == 297_000_000);
    assert!(claim(&mut s, BOB) == 198_000_000);

    s.next_tx(STRANGER);
    let acc = s.take_shared<GlobalYieldAccumulator<ACC_TOKEN>>();
    assert!(accumulator::reward_pool_value(&acc) == 0);
    ts::return_shared(acc);
    s.end();
}

#[test]
fun test_double_claim_yields_zero() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE);
    deposit(&mut s, GROSS);

    assert!(claim(&mut s, ALICE) == 297_000_000);
    assert!(claim(&mut s, ALICE) == 0); // snapshot advanced: nothing left
    s.end();
}

#[test]
fun test_claim_zero_delta_is_noop_not_abort() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE);
    // No deposit yet: must succeed with zero, never abort (PTB composability).
    assert!(claim(&mut s, ALICE) == 0);
    s.end();
}

#[test]
fun test_claim_works_while_paused() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE);
    deposit(&mut s, GROSS);

    s.next_tx(ADMIN);
    {
        let mut config = s.take_shared<ProtocolConfig>();
        let cap = s.take_from_sender<AdminCap>();
        protocol::admin_emergency_stop(&mut config, &cap);
        ts::return_shared(config);
        s.return_to_sender(cap);
    };

    // Exit path: claim ignores the pause flag entirely (D6, I-X1).
    assert!(claim(&mut s, ALICE) == 297_000_000);
    s.end();
}

#[test]
#[expected_failure(abort_code = accumulator::EShareAssetMismatch)]
fun test_claim_foreign_share_aborts() {
    let mut s = to_operational();
    deposit(&mut s, GROSS);

    s.next_tx(ALICE);
    let mut acc = s.take_shared<GlobalYieldAccumulator<ACC_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    // A share bound to some other ID (here: the config's, as a stand-in).
    let mut forged =
        share::mint_for_testing(sui::object::id(&config), ALICE_SHARES, 0, s.ctx());
    let payout = accumulator::claim_rewards(&mut acc, &mut forged, s.ctx());
    payout.burn_for_testing();
    abort 0
}

#[test]
#[expected_failure(abort_code = accumulator::EPayoutOverflow)]
fun test_payout_overflow_guard() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE);

    s.next_tx(STRANGER);
    {
        let mut acc = s.take_shared<GlobalYieldAccumulator<ACC_TOKEN>>();
        // Beyond the stated capacity limit (§15.1): payout would exceed u64.
        accumulator::set_index_for_testing(
            &mut acc,
            200_000_000_000_000_000_000_000_000, // 2e26
        );
        ts::return_shared(acc);
    };

    claim(&mut s, ALICE);
    abort 0
}

// === Rollover (the div-by-zero branch) ===

#[test]
fun test_deposit_with_zero_unwrapped_routes_to_rollover_then_sweeps() {
    let mut s = to_operational();

    // Pretend the entire supply is wrapped (M5 does this for real).
    s.next_tx(STRANGER);
    {
        let mut acc = s.take_shared<GlobalYieldAccumulator<ACC_TOKEN>>();
        accumulator::set_total_wrapped_for_testing(&mut acc, GOAL);
        ts::return_shared(acc);
    };

    deposit(&mut s, GROSS);

    s.next_tx(STRANGER);
    {
        let acc = s.take_shared<GlobalYieldAccumulator<ACC_TOKEN>>();
        // No division happened: index untouched, funds parked in the reserve.
        assert!(accumulator::cumulative_yield_index(&acc) == 0);
        assert!(accumulator::rollover_reserve_value(&acc) == INVESTOR);
        assert!(accumulator::reward_pool_value(&acc) == 0);
        ts::return_shared(acc);
    };

    // Supply returns (an unwrap in real life); anyone sweeps the rescue.
    s.next_tx(STRANGER);
    {
        let mut acc = s.take_shared<GlobalYieldAccumulator<ACC_TOKEN>>();
        accumulator::set_total_wrapped_for_testing(&mut acc, 0);
        accumulator::sweep_rollover(&mut acc);
        assert!(accumulator::cumulative_yield_index(&acc) == BASE_DELTA);
        assert!(accumulator::rollover_reserve_value(&acc) == 0);
        assert!(accumulator::reward_pool_value(&acc) == INVESTOR);
        ts::return_shared(acc);
    };
    s.end();
}

#[test]
#[expected_failure(abort_code = accumulator::EZeroAmount)]
fun test_sweep_empty_rollover_aborts() {
    let mut s = to_operational();
    s.next_tx(STRANGER);
    let mut acc = s.take_shared<GlobalYieldAccumulator<ACC_TOKEN>>();
    accumulator::sweep_rollover(&mut acc);
    abort 0
}

// === The Diamond Hand Multiplier (emergent, §11) ===

#[test]
fun test_diamond_hand_multiplier_2_5x_at_60_percent_wrapped() {
    let mut s = to_operational();
    convert_receipt(&mut s, BOB); // BOB stays unwrapped with 40k shares

    // Fake ALICE's 60k as wrapped (her receipt stays unconverted, so no
    // object exists that could over-claim against the faked counter).
    s.next_tx(STRANGER);
    {
        let mut acc = s.take_shared<GlobalYieldAccumulator<ACC_TOKEN>>();
        accumulator::set_total_wrapped_for_testing(&mut acc, ALICE_SHARES);
        ts::return_shared(acc);
    };

    deposit(&mut s, GROSS);

    s.next_tx(STRANGER);
    {
        let acc = s.take_shared<GlobalYieldAccumulator<ACC_TOKEN>>();
        // Same 495 USDC over 40k instead of 100k shares: exactly 2.5×.
        assert!(accumulator::cumulative_yield_index(&acc) == BASE_DELTA * 5 / 2);
        ts::return_shared(acc);
    };

    // BOB collects the ENTIRE investor portion: the multiplier in action.
    assert!(claim(&mut s, BOB) == INVESTOR);
    s.end();
}

// === Dust & solvency ===

#[test]
fun test_dust_floors_into_reward_pool_never_against_it() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE);

    // 99 raw units gross: fee floors to 0, investor floors to 49, and
    // Δindex = 49 × 1e9 / 1e11 floors to 0 — the 49 units stay in the pool
    // as dust. I-M2 holds as a strict surplus.
    deposit(&mut s, 99);

    s.next_tx(STRANGER);
    {
        let acc = s.take_shared<GlobalYieldAccumulator<ACC_TOKEN>>();
        assert!(accumulator::cumulative_yield_index(&acc) == 0);
        assert!(accumulator::reward_pool_value(&acc) == 49);
        ts::return_shared(acc);
    };

    assert!(claim(&mut s, ALICE) == 0); // nobody can touch dust mid-life
    s.end();
}

/// Deterministic LCG (Knuth MMIX constants); computed in u128 so the
/// modular wrap never trips Move's overflow abort (the u128 product is at
/// most ~1.2e38, within range).
fun next_rand(state: u64): u64 {
    let s = (state as u128) * 6364136223846793005u128 + 1442695040888963407u128;
    ((s % 18446744073709551616u128) as u64) // mod 2^64
}

#[test]
fun test_solvency_property_fuzz() {
    // m4.md pass criterion 1: I-M1 + I-M2 after EVERY step of >= 1_000
    // randomized operations (deposit / claim A / claim B), with dust-heavy
    // amounts; criterion 4: terminal dust within the predicted bound.
    let mut s = to_operational();

    s.next_tx(STRANGER);
    {
        let mut acc = s.take_shared<GlobalYieldAccumulator<ACC_TOKEN>>();
        // Shares mirroring the real cap table (receipts stay unconverted, so
        // object-level supply remains consistent with total_minted).
        let mut alice = share::mint_for_testing(
            accumulator::asset_id(&acc),
            ALICE_SHARES,
            0,
            s.ctx(),
        );
        let mut bob =
            share::mint_for_testing(accumulator::asset_id(&acc), BOB_SHARES, 0, s.ctx());

        let mut rng = 0x9E3779B97F4A7C15u64; // arbitrary nonzero seed
        let mut last_index = 0u128;
        let mut deposit_count = 0u64;
        let mut step = 0u64;
        while (step < 1_000) {
            rng = next_rand(rng);
            let op = rng % 3;
            if (op == 0) {
                // Amounts 1 .. 2e9 raw units: spans pure-dust through ~2k USDC.
                let amount = (rng % 2_000_000_000) + 1;
                let funds = balance::create_for_testing<USDC>(amount);
                accumulator::add_revenue(&mut acc, funds);
                deposit_count = deposit_count + 1;
            } else if (op == 1) {
                let c = accumulator::claim_rewards(&mut acc, &mut alice, s.ctx());
                c.burn_for_testing();
            } else {
                let c = accumulator::claim_rewards(&mut acc, &mut bob, s.ctx());
                c.burn_for_testing();
            };

            // I-M1: the index never decreases, under any operation.
            assert!(accumulator::cumulative_yield_index(&acc) >= last_index);
            last_index = accumulator::cumulative_yield_index(&acc);

            // I-M2: reward_pool >= total owed, after EVERY step.
            let owed = accumulator::pending_payout(&acc, &alice)
                + accumulator::pending_payout(&acc, &bob);
            assert!(accumulator::reward_pool_value(&acc) >= owed);

            step = step + 1;
        };

        // Drain both; the residue is pure truncation dust, bounded by one
        // floor-loss per index advance: < unwrapped/SCALE (= 100 raw units)
        // per deposit.
        let ca = accumulator::claim_rewards(&mut acc, &mut alice, s.ctx());
        ca.burn_for_testing();
        let cb = accumulator::claim_rewards(&mut acc, &mut bob, s.ctx());
        cb.burn_for_testing();
        assert!(accumulator::reward_pool_value(&acc) <= deposit_count * 100);

        transfer::public_transfer(alice, ALICE);
        transfer::public_transfer(bob, BOB);
        ts::return_shared(acc);
    };
    s.end();
}

#[test]
fun test_split_reassembly_randomized_amounts() {
    // m4.md pass criterion 5: fee + investor + entity == gross for varied,
    // awkward amounts through the FULL deposit_revenue path. Per-iteration
    // checks: treasury coin == expected fee, entity coin == expected
    // remainder, reward_pool grows by exactly the expected investor portion.
    let mut s = to_operational();

    let mut rng = 0xC0FFEEu64;
    let mut expected_pool = 0u64;
    let mut i = 0u64;
    while (i < 12) {
        rng = next_rand(rng);
        // 100 .. ~5e9: fee >= 1 so a treasury coin always exists.
        let gross = (rng % 5_000_000_000) + 100;
        let fee = gross / 100; // 1% (default protocol_fee_bps = 100)
        let investor = (gross - fee) / 2; // 50% revenue split
        let entity_cut = gross - fee - investor;
        assert!(fee + investor + entity_cut == gross); // reassembly identity

        deposit(&mut s, gross);
        expected_pool = expected_pool + investor;

        s.next_tx(ADMIN);
        {
            let fee_coin = s.take_from_sender<Coin<USDC>>();
            assert!(fee_coin.burn_for_testing() == fee);
        };
        s.next_tx(ENTITY);
        {
            let entity_coin = s.take_from_sender<Coin<USDC>>();
            assert!(entity_coin.burn_for_testing() == entity_cut);
        };
        s.next_tx(STRANGER);
        {
            let acc = s.take_shared<GlobalYieldAccumulator<ACC_TOKEN>>();
            assert!(accumulator::reward_pool_value(&acc) == expected_pool);
            ts::return_shared(acc);
        };
        i = i + 1;
    };
    s.end();
}

// === Merge (spec §8.1) ===

#[test]
fun test_merge_force_claims_both_then_sums() {
    let mut s = to_operational();
    convert_receipt(&mut s, ALICE);

    // ALICE splits 60k into 40k + 20k, then revenue lands on both.
    s.next_tx(ALICE);
    {
        let mut parent = s.take_from_sender<GallyShare>();
        let child = share::split_share(&mut parent, 20_000_000_000, s.ctx());
        transfer::public_transfer(child, ALICE);
        s.return_to_sender(parent);
    };
    deposit(&mut s, GROSS);

    s.next_tx(ALICE);
    {
        let mut acc = s.take_shared<GlobalYieldAccumulator<ACC_TOKEN>>();
        let mut target = s.take_from_sender<GallyShare>();
        let victim = s.take_from_sender<GallyShare>();
        let combined_count = share::share_count(&target) + share::share_count(&victim);

        let claimed = accumulator::merge_shares(&mut acc, &mut target, victim, s.ctx());
        // Both pendings settled in one coin: 60% of the investor portion.
        assert!(claimed.burn_for_testing() == 297_000_000);
        assert!(share::share_count(&target) == combined_count);
        // Snapshot is the live index: nothing further claimable.
        assert!(accumulator::pending_payout(&acc, &target) == 0);

        s.return_to_sender(target);
        ts::return_shared(acc);
    };
    s.end();
}

// === Deposit gating ===

#[test]
#[expected_failure(abort_code = protocol::EPaused)]
fun test_deposit_while_paused_aborts() {
    let mut s = to_operational();

    s.next_tx(ADMIN);
    {
        let mut config = s.take_shared<ProtocolConfig>();
        let cap = s.take_from_sender<AdminCap>();
        protocol::admin_emergency_stop(&mut config, &cap);
        ts::return_shared(config);
        s.return_to_sender(cap);
    };

    deposit(&mut s, GROSS);
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EWrongState)]
fun test_deposit_before_operational_aborts() {
    // Pipeline stopped after finalize: state is EXECUTING, not OPERATIONAL.
    let mut s = ts::begin(ADMIN);
    protocol::init_for_testing(s.ctx());

    s.next_tx(VALIDATOR);
    {
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, 0);
        validator::register_validator(
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
        asset::create_asset(
            &config,
            GOAL,
            FUNDING_DEADLINE_MS,
            vector[GOAL],
            vector[b"all"],
            vector[20_000],
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
    fund(&mut s, ALICE, GOAL);
    s.next_tx(STRANGER);
    {
        let mut asset = s.take_shared<Asset>();
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, 3_000);
        let cap = coin::create_treasury_cap_for_testing<ACC_TOKEN>(s.ctx());
        asset::finalize_successful_raise<ACC_TOKEN>(&mut asset, &config, cap, &clock, s.ctx());
        clock.destroy_for_testing();
        ts::return_shared(asset);
        ts::return_shared(config);
    };

    deposit(&mut s, GROSS); // EXECUTING: no revenue before the build is done
    abort 0
}
