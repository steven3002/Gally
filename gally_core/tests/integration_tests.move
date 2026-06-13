/// M7 end-to-end & hardening suite (work order: milestone/gally core/m7.md).
///
/// Proves the whole protocol, not a single module: the four defination.md
/// scenarios run start-to-finish (§21.4); a 5_000-step randomized fuzz asserts
/// every money invariant after every step (§21.2, I-M2 the headline); the §17
/// access-control matrix is exhausted (§21.1); pause conformance (§21.7),
/// the wrap-cycle upper bound (§21.6), and math edges (§21.3) are checked; the
/// closure machine (close → redeem → dust sweep) is exercised with a
/// conservation reconciliation; and every §20 adversarial row (A1–A15) maps to
/// a named test demonstrating its defense.
#[test_only]
module gally_core::integration_tests;

use gally_core::accumulator::{Self, GlobalYieldAccumulator};
use gally_core::asset::{Self, Asset, ContributionReceipt, EntityCap};
use gally_core::dispute::{Self, Dispute};
use gally_core::protocol::{Self, AdminCap, ProtocolConfig};
use gally_core::share::{Self, GallyShare};
use gally_core::usdc::USDC;
use gally_core::validator::{Self, ValidatorCap, ValidatorPool};
use sui::balance;
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::test_scenario as ts;

/// Witness for this suite's per-asset token type.
public struct INT_TOKEN has drop {}

const ADMIN: address = @0xA1; // also the protocol treasury (init default)
const TARGET: address = @0xC3; // the vouching validator
const J1: address = @0x101;
const J2: address = @0x102;
const J3: address = @0x103;
const ENTITY: address = @0xE5;
const ALICE: address = @0xAA; // 60k shares
const BOB: address = @0xBB; // 40k shares
const STRANGER: address = @0xD4;
const CHALLENGER: address = @0xCC;

const GOAL: u64 = 100_000_000_000; // 100k USDC == 100k shares
const COLLATERAL: u64 = 10_000_000_000; // 10% of goal
const COVERAGE: u64 = 20_000_000_000; // 20% of goal
const TARGET_STAKE: u64 = 50_000_000_000;
const JUROR_STAKE: u64 = 15_000_000_000; // above the 10k jury_min_stake
const ALICE_SHARES: u64 = 60_000_000_000;
const BOB_SHARES: u64 = 40_000_000_000;
const BOND: u64 = 1_000_000_000; // default challenger_bond

const FUNDING_DEADLINE_MS: u64 = 10_000;
const T1_DEADLINE_MS: u64 = 30_000; // tranche 1's deadline (the one missed on default)
const GRACE_MS: u64 = 604_800_000;
const CONVERT_MS: u64 = 4_000; // receipts convert here; cooldown clock starts
const WRAP_MS: u64 = 3_700_000; // > CONVERT_MS + 3_600_000 default cooldown

/// 1,000 USDC rent drop and its normative 1%-fee / 50%-split parts.
const RENT: u64 = 1_000_000_000;
const RENT_INVESTOR: u64 = 495_000_000;

/// Term-financing fixture: target = principal, reached by one 250k revenue drop.
const RETURN_TARGET: u64 = 100_000_000_000;
const TRADE_GROSS: u64 = 250_000_000_000;
const TRADE_INVESTOR: u64 = 123_750_000_000; // (250k − 2.5k fee) × 50%

// === Harness ===

fun make_clock(s: &mut ts::Scenario, ms: u64): Clock {
    let mut c = clock::create_for_testing(s.ctx());
    c.set_for_testing(ms);
    c
}

fun register(s: &mut ts::Scenario, who: address, stake: u64): ID {
    s.next_tx(who);
    {
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(s, 0);
        validator::register_validator(
            &config,
            coin::mint_for_testing<USDC>(stake, s.ctx()),
            &clock,
            s.ctx(),
        );
        clock.destroy_for_testing();
        ts::return_shared(config);
    };
    s.next_tx(who);
    ts::most_recent_id_shared<ValidatorPool>().destroy_some()
}

/// Publishes, registers TARGET + three jurors, creates and vouches the asset.
/// `is_term` selects the trade-finance constructor. Asset is left in FUNDING.
fun setup_with(is_term: bool, return_target: u64): (ts::Scenario, ID, ID, ID, ID) {
    let mut s = ts::begin(ADMIN);
    protocol::init_for_testing(s.ctx());

    let target_id = register(&mut s, TARGET, TARGET_STAKE);
    let j1 = register(&mut s, J1, JUROR_STAKE);
    let j2 = register(&mut s, J2, JUROR_STAKE);
    let j3 = register(&mut s, J3, JUROR_STAKE);

    s.next_tx(ENTITY);
    {
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, 0);
        if (is_term) {
            asset::create_term_asset(
                &config,
                GOAL,
                FUNDING_DEADLINE_MS,
                vector[40_000_000_000, 35_000_000_000, 25_000_000_000],
                vector[b"land", b"build", b"fit-out"],
                vector[20_000, T1_DEADLINE_MS, 40_000],
                5_000,
                return_target,
                coin::mint_for_testing<USDC>(COLLATERAL, s.ctx()),
                &clock,
                s.ctx(),
            );
        } else {
            asset::create_asset(
                &config,
                GOAL,
                FUNDING_DEADLINE_MS,
                vector[40_000_000_000, 35_000_000_000, 25_000_000_000],
                vector[b"land", b"build", b"fit-out"],
                vector[20_000, T1_DEADLINE_MS, 40_000],
                5_000,
                coin::mint_for_testing<USDC>(COLLATERAL, s.ctx()),
                &clock,
                s.ctx(),
            );
        };
        clock.destroy_for_testing();
        ts::return_shared(config);
    };

    s.next_tx(TARGET);
    {
        let mut asset = s.take_shared<Asset>();
        let mut pool = s.take_shared_by_id<ValidatorPool>(target_id);
        let vcap = s.take_from_sender<ValidatorCap>();
        let config = s.take_shared<ProtocolConfig>();
        let docs = vector[asset::new_walrus_ref(b"deed", b"sha-deed", s.ctx())];
        asset::vouch_asset_legals(&mut asset, &mut pool, &vcap, &config, docs, s.ctx());
        ts::return_shared(asset);
        ts::return_shared(pool);
        ts::return_shared(config);
        s.return_to_sender(vcap);
    };

    (s, target_id, j1, j2, j3)
}

fun setup(): (ts::Scenario, ID, ID, ID, ID) { setup_with(false, 0) }

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

fun finalize(s: &mut ts::Scenario) {
    s.next_tx(STRANGER);
    let mut asset = s.take_shared<Asset>();
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(s, 3_000);
    let cap = coin::create_treasury_cap_for_testing<INT_TOKEN>(s.ctx());
    asset::finalize_successful_raise<INT_TOKEN>(&mut asset, &config, cap, &clock, s.ctx());
    clock.destroy_for_testing();
    ts::return_shared(asset);
    ts::return_shared(config);
}

/// FUNDING → EXECUTING, fully funded, no tranche released (escrow == goal).
fun to_executing(s: &mut ts::Scenario) {
    fund(s, ALICE, ALICE_SHARES);
    fund(s, BOB, BOB_SHARES);
    finalize(s);
}

fun run_tranche(s: &mut ts::Scenario, target_id: ID, index: u64) {
    s.next_tx(ENTITY);
    {
        let mut asset = s.take_shared<Asset>();
        let config = s.take_shared<ProtocolConfig>();
        let ecap = s.take_from_sender<EntityCap>();
        let proof = asset::new_walrus_ref(b"p", b"sha-p", s.ctx());
        asset::submit_milestone_proof(&mut asset, &ecap, &config, index, proof);
        ts::return_shared(asset);
        ts::return_shared(config);
        s.return_to_sender(ecap);
    };
    s.next_tx(TARGET);
    {
        let mut asset = s.take_shared<Asset>();
        let pool = s.take_shared_by_id<ValidatorPool>(target_id);
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

/// EXECUTING → OPERATIONAL (all three tranches released).
fun to_operational(s: &mut ts::Scenario, target_id: ID) {
    to_executing(s);
    run_tranche(s, target_id, 0);
    run_tranche(s, target_id, 1);
    run_tranche(s, target_id, 2);
}

fun convert_receipt(s: &mut ts::Scenario, who: address) {
    s.next_tx(who);
    let asset = s.take_shared<Asset>();
    let acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    let receipt = s.take_from_sender<ContributionReceipt>();
    let clock = make_clock(s, CONVERT_MS);
    let minted =
        asset::claim_shares<INT_TOKEN>(&asset, &acc, &config, receipt, &clock, s.ctx());
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
    let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    asset::deposit_revenue<INT_TOKEN>(
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

fun claim(s: &mut ts::Scenario, who: address): u64 {
    s.next_tx(who);
    let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    let mut sh = s.take_from_sender<GallyShare>();
    let payout = accumulator::claim_rewards(&mut acc, &mut sh, s.ctx());
    let v = payout.burn_for_testing();
    ts::return_shared(acc);
    s.return_to_sender(sh);
    v
}

/// `who` wraps their entire deed into Coin<INT_TOKEN> at `ms`.
fun wrap(s: &mut ts::Scenario, who: address, ms: u64) {
    s.next_tx(who);
    let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    let sh = s.take_from_sender<GallyShare>();
    let clock = make_clock(s, ms);
    let (wrapped, yield) = accumulator::wrap_shares(&mut acc, &config, sh, &clock, s.ctx());
    yield.burn_for_testing();
    transfer::public_transfer(wrapped, who);
    clock.destroy_for_testing();
    ts::return_shared(acc);
    ts::return_shared(config);
}

/// `who` unwraps their entire Coin<INT_TOKEN> back into a fresh deed at `ms`.
fun unwrap(s: &mut ts::Scenario, who: address, ms: u64) {
    s.next_tx(who);
    let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    let wrapped = s.take_from_sender<Coin<INT_TOKEN>>();
    let clock = make_clock(s, ms);
    let fresh = accumulator::unwrap_coins(&mut acc, wrapped, &clock, s.ctx());
    transfer::public_transfer(fresh, who);
    clock.destroy_for_testing();
    ts::return_shared(acc);
}

fun redeem(s: &mut ts::Scenario, who: address): u64 {
    s.next_tx(who);
    let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    let sh = s.take_from_sender<GallyShare>();
    let proceeds = accumulator::redeem_share(&mut acc, sh, s.ctx());
    let v = proceeds.burn_for_testing();
    ts::return_shared(acc);
    v
}

fun flag_default(s: &mut ts::Scenario, ms: u64) {
    s.next_tx(STRANGER);
    let mut asset = s.take_shared<Asset>();
    let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(s, ms);
    asset::flag_default<INT_TOKEN>(&mut asset, &mut acc, &config, &clock);
    clock.destroy_for_testing();
    ts::return_shared(asset);
    ts::return_shared(acc);
    ts::return_shared(config);
}

fun sweep_compensation(s: &mut ts::Scenario, ms: u64) {
    s.next_tx(STRANGER);
    let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    let clock = make_clock(s, ms);
    accumulator::sweep_compensation(&mut acc, &clock);
    clock.destroy_for_testing();
    ts::return_shared(acc);
}

fun pause(s: &mut ts::Scenario) {
    s.next_tx(ADMIN);
    let mut config = s.take_shared<ProtocolConfig>();
    let cap = s.take_from_sender<AdminCap>();
    protocol::admin_emergency_stop(&mut config, &cap);
    ts::return_shared(config);
    s.return_to_sender(cap);
}

// === §21.4 Scenario integrations ===

/// Housing (defination.md Scenario 1): full tranche cycle → rent → pro-rata
/// claims. 60/40 cap table splits one rent drop to the unit; the pool drains.
#[test]
fun test_scenario_housing() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_operational(&mut s, target_id);
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);

    deposit(&mut s, RENT); // a month's rent

    assert!(claim(&mut s, ALICE) == 297_000_000); // 60% of 495m
    assert!(claim(&mut s, BOB) == 198_000_000); // 40%

    s.next_tx(STRANGER);
    let acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    assert!(accumulator::reward_pool_value(&acc) == 0);
    assert!(accumulator::lifetime_investor_revenue(&acc) == RENT_INVESTOR);
    ts::return_shared(acc);
    s.end();
}

/// CNC machinery (Scenario 2): revenue-share with the Opportunity-Cost
/// multiplier. BOB wraps (forfeits eligibility); the next revenue drop divides
/// over ALICE alone, so she earns 100% of the investor cut, not 60%. BOB then
/// unwraps and his fresh snapshot earns zero for the wrapped window (A4).
#[test]
fun test_scenario_machinery() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_operational(&mut s, target_id);
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);

    wrap(&mut s, BOB, WRAP_MS); // BOB chases DeFi liquidity, leaves the yield table

    deposit(&mut s, RENT); // machine-hour revenue

    // Diamond-hand multiplier: ALICE's effective share jumped 60% → 100%.
    assert!(claim(&mut s, ALICE) == RENT_INVESTOR);

    unwrap(&mut s, BOB, WRAP_MS + 1_000); // fresh deed at the live index
    assert!(claim(&mut s, BOB) == 0); // no retroactive yield for wrapped time
    s.end();
}

/// Trade finance (Scenario 3): a term asset closes the moment cumulative
/// investor distributions reach the principal+margin target, then holders
/// redeem their final yield and burn the deeds. Permissionless close.
#[test]
fun test_scenario_trade_finance_close_redeem() {
    let (mut s, target_id, _j1, _j2, _j3) = setup_with(true, RETURN_TARGET);
    to_operational(&mut s, target_id);
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);

    deposit(&mut s, TRADE_GROSS); // the financed trade settles

    // Target reached; anyone may close the term.
    s.next_tx(STRANGER);
    {
        let mut asset = s.take_shared<Asset>();
        let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
        let config = s.take_shared<ProtocolConfig>();
        assert!(accumulator::lifetime_investor_revenue(&acc) == TRADE_INVESTOR);
        asset::close_at_return_target<INT_TOKEN>(&mut asset, &mut acc, &config, s.ctx());
        assert!(asset::is_closed(&asset));
        assert!(accumulator::is_closed(&acc));
        ts::return_shared(asset);
        ts::return_shared(acc);
        ts::return_shared(config);
    };

    // Entity's collateral came home at close.
    s.next_tx(ENTITY);
    {
        let c = s.take_from_sender<Coin<USDC>>();
        assert!(c.burn_for_testing() == COLLATERAL);
    };

    // Redemption force-claims the final yield (60/40 of 123.75k) and burns.
    assert!(redeem(&mut s, ALICE) == 74_250_000_000);
    assert!(redeem(&mut s, BOB) == 49_500_000_000);

    s.next_tx(STRANGER);
    let acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    assert!(accumulator::total_minted_shares(&acc) == 0);
    assert!(accumulator::reward_pool_value(&acc) == 0); // exact, no dust this run
    ts::return_shared(acc);
    s.end();
}

/// Facilitator default (Scenario 6, full path): tranche 0 released, tranche 1
/// deadline missed → permissionless flag → collateral + residual escrow seized
/// → grace → sweep → pro-rata compensation → close → redeem.
#[test]
fun test_scenario_facilitator_default() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_executing(&mut s);
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);
    run_tranche(&mut s, target_id, 0); // facilitator draws the first 40k

    flag_default(&mut s, T1_DEADLINE_MS + 1); // misses tranche 1

    // Collateral 10k + unreleased escrow 60k = 70k seized; wrapping frozen.
    s.next_tx(STRANGER);
    {
        let asset = s.take_shared<Asset>();
        let acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
        assert!(asset::is_compensating(&asset));
        assert!(accumulator::compensation_pool_value(&acc) == 70_000_000_000);
        assert!(accumulator::is_wrapping_frozen(&acc));
        ts::return_shared(asset);
        ts::return_shared(acc);
    };

    sweep_compensation(&mut s, T1_DEADLINE_MS + 1 + GRACE_MS); // 70k → index

    // Pro-rata restitution: 60/40 of 70k.
    assert!(claim(&mut s, ALICE) == 42_000_000_000);
    assert!(claim(&mut s, BOB) == 28_000_000_000);

    // Compensation done → close → redeem.
    s.next_tx(STRANGER);
    {
        let mut asset = s.take_shared<Asset>();
        let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, T1_DEADLINE_MS + 1 + GRACE_MS + 1);
        asset::close_after_compensation<INT_TOKEN>(&mut asset, &mut acc, &config, &clock, s.ctx());
        assert!(asset::is_closed(&asset));
        clock.destroy_for_testing();
        ts::return_shared(asset);
        ts::return_shared(acc);
        ts::return_shared(config);
    };

    assert!(redeem(&mut s, ALICE) == 0); // already claimed restitution
    assert!(redeem(&mut s, BOB) == 0);
    s.next_tx(STRANGER);
    let acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    assert!(accumulator::total_minted_shares(&acc) == 0);
    ts::return_shared(acc);
    s.end();
}

// === Dispute / admin harness (attacks A2/A3/A8/A9, dust sweep) ===

fun set_cooldown_zero(s: &mut ts::Scenario) {
    s.next_tx(ADMIN);
    let mut config = s.take_shared<ProtocolConfig>();
    let cap = s.take_from_sender<AdminCap>();
    protocol::admin_set_min_wrap_duration_ms(&mut config, &cap, 0);
    ts::return_shared(config);
    s.return_to_sender(cap);
}

fun open_dispute(s: &mut ts::Scenario, target_id: ID, now_ms: u64): ID {
    s.next_tx(CHALLENGER);
    {
        let mut asset = s.take_shared<Asset>();
        let mut pool = s.take_shared_by_id<ValidatorPool>(target_id);
        let acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(s, now_ms);
        let bond = coin::mint_for_testing<USDC>(BOND, s.ctx());
        let evidence = asset::new_walrus_ref(b"fraud", b"sha-fraud", s.ctx());
        dispute::initialize_dispute<INT_TOKEN>(
            &mut asset, &mut pool, &acc, &config, bond, evidence, &clock, s.ctx(),
        );
        clock.destroy_for_testing();
        ts::return_shared(asset);
        ts::return_shared(pool);
        ts::return_shared(acc);
        ts::return_shared(config);
    };
    s.next_tx(CHALLENGER);
    ts::most_recent_id_shared<Dispute>().destroy_some()
}

fun vote(s: &mut ts::Scenario, juror: address, juror_id: ID, dispute_id: ID, guilty: bool) {
    s.next_tx(juror);
    let mut dispute = s.take_shared_by_id<Dispute>(dispute_id);
    let pool = s.take_shared_by_id<ValidatorPool>(juror_id);
    let vcap = s.take_from_sender<ValidatorCap>();
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(s, 1_000_000);
    dispute::vote_on_dispute(&mut dispute, &pool, &vcap, &config, guilty, &clock);
    clock.destroy_for_testing();
    ts::return_shared(dispute);
    ts::return_shared(pool);
    ts::return_shared(config);
    s.return_to_sender(vcap);
}

fun resolve(s: &mut ts::Scenario, target_id: ID, dispute_id: ID, now_ms: u64) {
    s.next_tx(CHALLENGER);
    let mut dispute = s.take_shared_by_id<Dispute>(dispute_id);
    let mut pool = s.take_shared_by_id<ValidatorPool>(target_id);
    let mut asset = s.take_shared<Asset>();
    let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(s, now_ms);
    dispute::resolve_dispute<INT_TOKEN>(
        &mut dispute, &mut pool, &mut asset, &mut acc, &config, &clock, s.ctx(),
    );
    clock.destroy_for_testing();
    ts::return_shared(dispute);
    ts::return_shared(pool);
    ts::return_shared(asset);
    ts::return_shared(acc);
    ts::return_shared(config);
}

/// Admin + entity co-sign a wind-down in one transaction (both caps taken from
/// their owners, spec §14c).
fun close_wind_down(s: &mut ts::Scenario) {
    s.next_tx(ADMIN);
    let mut asset = s.take_shared<Asset>();
    let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    let admin = s.take_from_address<AdminCap>(ADMIN);
    let ecap = s.take_from_address<EntityCap>(ENTITY);
    asset::close_wind_down<INT_TOKEN>(&mut asset, &mut acc, &config, &admin, &ecap, s.ctx());
    ts::return_to_address(ADMIN, admin);
    ts::return_to_address(ENTITY, ecap);
    ts::return_shared(asset);
    ts::return_shared(acc);
    ts::return_shared(config);
}

fun sweep_dust(s: &mut ts::Scenario): u64 {
    s.next_tx(ADMIN);
    let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    let cap = s.take_from_sender<AdminCap>();
    let dust = accumulator::admin_sweep_dust(&mut acc, &config, &cap, s.ctx());
    let v = dust.burn_for_testing();
    ts::return_shared(acc);
    ts::return_shared(config);
    s.return_to_sender(cap);
    v
}

// === §21.1 State-machine exhaustion ===

/// The full legal forward path through the lifecycle, asserting the state
/// value at every transition (illegal transitions are the expected_failure
/// companions below; PENDING_VOUCH/CANCELLED are covered in asset_tests).
#[test]
fun test_state_matrix_full() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();

    s.next_tx(STRANGER);
    { let a = s.take_shared<Asset>(); assert!(asset::state(&a) == asset::state_funding()); ts::return_shared(a); };

    to_executing(&mut s);
    s.next_tx(STRANGER);
    { let a = s.take_shared<Asset>(); assert!(asset::state(&a) == asset::state_executing()); ts::return_shared(a); };

    run_tranche(&mut s, target_id, 0);
    run_tranche(&mut s, target_id, 1);
    run_tranche(&mut s, target_id, 2);
    s.next_tx(STRANGER);
    { let a = s.take_shared<Asset>(); assert!(asset::state(&a) == asset::state_operational()); ts::return_shared(a); };

    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);
    deposit(&mut s, RENT);
    close_wind_down(&mut s);
    s.next_tx(STRANGER);
    { let a = s.take_shared<Asset>(); assert!(asset::state(&a) == asset::state_closed()); ts::return_shared(a); };
    s.end();
}

#[test]
#[expected_failure(abort_code = asset::EWrongState)]
fun test_state_deposit_in_executing_aborts() {
    let (mut s, _t, _j1, _j2, _j3) = setup();
    to_executing(&mut s);
    deposit(&mut s, RENT); // OPERATIONAL-only
    s.end();
}

#[test]
#[expected_failure(abort_code = asset::EWrongState)]
fun test_state_deposit_after_close_aborts() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_operational(&mut s, target_id);
    close_wind_down(&mut s);
    deposit(&mut s, RENT); // CLOSED: deposits abort
    s.end();
}

#[test]
#[expected_failure(abort_code = accumulator::EWrappingFrozen)]
fun test_state_wrap_after_close_aborts() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_operational(&mut s, target_id);
    convert_receipt(&mut s, ALICE);
    close_wind_down(&mut s);
    wrap(&mut s, ALICE, WRAP_MS); // CLOSED: wraps abort
    s.end();
}

// === §21.2 Invariant fuzz (5_000 steps) ===

/// Deterministic LCG (Knuth MMIX constants), u128 internals so the modular
/// wrap never trips Move's overflow abort.
fun next_rand(state: u64): u64 {
    let x = (state as u128) * 6364136223846793005u128 + 1442695040888963407u128;
    ((x % 18446744073709551616u128) as u64)
}

/// 5_000 randomized deposit / wrap-toggle / unwrap-toggle / claim steps over a
/// live accumulator, asserting I-W1, I-W2, I-M1 and the headline I-M2 solvency
/// after EVERY step. The lifecycle-level surface (contribute/finalize/dispute/
/// default) is covered by the scenario and state-matrix tests; this is the
/// money engine under maximal churn.
#[test]
fun test_invariant_fuzz_5000() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_operational(&mut s, target_id);
    set_cooldown_zero(&mut s); // free wrap toggling

    // Seed both holders as deeds in inventory; every chunk boundary returns
    // them to this all-unwrapped form so they can be stashed between txs.
    s.next_tx(STRANGER);
    {
        let acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
        transfer::public_transfer(
            share::mint_for_testing(accumulator::asset_id(&acc), ALICE_SHARES, 0, s.ctx()),
            ALICE,
        );
        transfer::public_transfer(
            share::mint_for_testing(accumulator::asset_id(&acc), BOB_SHARES, 0, s.ctx()),
            BOB,
        );
        ts::return_shared(acc);
    };

    // 10 chunks × 500 == 5_000 steps. Each chunk runs in its own transaction so
    // the event buffer flushes between them (the VM caps per-tx event memory).
    let mut rng = 0x9E3779B97F4A7C15u64;
    let mut last_index = 0u128;
    let mut chunk = 0u64;
    while (chunk < 10) {
        s.next_tx(STRANGER);
        let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, 10_000_000);

        let mut alice_share = option::some(s.take_from_address<GallyShare>(ALICE));
        let mut alice_coin = option::none<Coin<INT_TOKEN>>();
        let mut bob_share = option::some(s.take_from_address<GallyShare>(BOB));
        let mut bob_coin = option::none<Coin<INT_TOKEN>>();

        let mut step = 0u64;
        while (step < 500) {
            rng = next_rand(rng);
            // Every step deposits revenue. add_revenue emits no event and mints
            // no object, so it is ~two orders of magnitude cheaper than a wrap or
            // claim; making it unconditional keeps the index advancing on every
            // single step, so the I-M2 solvency margin below is re-tested 5_000
            // times against a continuously growing pool.
            let amount = (rng % 2_000_000_000) + 1;
            accumulator::add_revenue(&mut acc, balance::create_for_testing<USDC>(amount));

            // Randomized wrap/unwrap/claim churn. These mint/burn real
            // Coin<INT_TOKEN> objects and emit events, so each costs far more of
            // the unit-test execution budget than a deposit; we fire one only on
            // a ~3/20 draw of a fresh rng so the op *sequence* is random (not a
            // fixed cadence) yet bounded to ~750 object ops across the run —
            // dense enough to drive I-W1/I-W2 (wrapped supply parity) and
            // force-claim integrity through every wrap state, sparse enough to
            // finish inside the per-test budget.
            rng = next_rand(rng);
            let phase = rng % 20;
            if (phase == 0) {
                // toggle alice between deed and wrapped
                if (alice_share.is_some()) {
                    let sh = alice_share.extract();
                    let (c, y) = accumulator::wrap_shares(&mut acc, &config, sh, &clock, s.ctx());
                    y.burn_for_testing();
                    alice_coin.fill(c);
                } else {
                    let c = alice_coin.extract();
                    alice_share.fill(accumulator::unwrap_coins(&mut acc, c, &clock, s.ctx()));
                };
            } else if (phase == 1) {
                // toggle bob between deed and wrapped
                if (bob_share.is_some()) {
                    let sh = bob_share.extract();
                    let (c, y) = accumulator::wrap_shares(&mut acc, &config, sh, &clock, s.ctx());
                    y.burn_for_testing();
                    bob_coin.fill(c);
                } else {
                    let c = bob_coin.extract();
                    bob_share.fill(accumulator::unwrap_coins(&mut acc, c, &clock, s.ctx()));
                };
            } else if (phase == 2) {
                // claim whichever holders are currently in deed (unwrapped) form
                if (alice_share.is_some()) {
                    let c = accumulator::claim_rewards(&mut acc, alice_share.borrow_mut(), s.ctx());
                    c.burn_for_testing();
                };
                if (bob_share.is_some()) {
                    let c = accumulator::claim_rewards(&mut acc, bob_share.borrow_mut(), s.ctx());
                    c.burn_for_testing();
                };
            };

            // I-W1: minted coin supply tracks the wrapped counter exactly.
            assert!(
                accumulator::wrapped_coin_supply(&acc) == accumulator::total_wrapped_shares(&acc),
            );
            // I-W2.
            assert!(
                accumulator::total_wrapped_shares(&acc) <= accumulator::total_minted_shares(&acc),
            );
            // I-M1: monotone index.
            assert!(accumulator::cumulative_yield_index(&acc) >= last_index);
            last_index = accumulator::cumulative_yield_index(&acc);
            // I-M2: solvency over every live share object — the headline.
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

        // Force both back to deed form, then stash for the next chunk.
        if (alice_coin.is_some()) {
            let sh = accumulator::unwrap_coins(&mut acc, alice_coin.extract(), &clock, s.ctx());
            alice_share.fill(sh);
        };
        if (bob_coin.is_some()) {
            let sh = accumulator::unwrap_coins(&mut acc, bob_coin.extract(), &clock, s.ctx());
            bob_share.fill(sh);
        };
        transfer::public_transfer(alice_share.extract(), ALICE);
        transfer::public_transfer(bob_share.extract(), BOB);
        alice_share.destroy_none();
        alice_coin.destroy_none();
        bob_share.destroy_none();
        bob_coin.destroy_none();
        clock.destroy_for_testing();
        ts::return_shared(acc);
        ts::return_shared(config);
        chunk = chunk + 1;
    };
    s.end();
}

// === §21.3 Math edge cases ===

/// Rollover branch (unwrapped == 0), the 1-unit Δindex==0 dust path, claim
/// immediately after unwrap (zero), a near-u64 deposit through the index, and
/// 10^4 dust-heavy deposits whose residue stays within the tracked bound.
#[test]
fun test_math_edges() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_operational(&mut s, target_id);

    s.next_tx(STRANGER);
    {
        let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
        let mut sh = share::mint_for_testing(accumulator::asset_id(&acc), GOAL, 0, s.ctx());

        // (1) unwrapped == 0 → rollover, no index move, no dust.
        accumulator::set_total_wrapped_for_testing(&mut acc, GOAL);
        accumulator::add_revenue(&mut acc, balance::create_for_testing<USDC>(500_000_000));
        assert!(accumulator::cumulative_yield_index(&acc) == 0);
        assert!(accumulator::rollover_reserve_value(&acc) == 500_000_000);
        accumulator::set_total_wrapped_for_testing(&mut acc, 0);

        // (2) 1 raw unit over 100k shares → Δindex floors to 0; the unit is dust.
        let idx_before = accumulator::cumulative_yield_index(&acc);
        accumulator::add_revenue(&mut acc, balance::create_for_testing<USDC>(1));
        assert!(accumulator::cumulative_yield_index(&acc) == idx_before);

        // (3) sweep the rollover now that supply is back: index advances.
        accumulator::sweep_rollover(&mut acc);
        assert!(accumulator::cumulative_yield_index(&acc) > 0);

        // (4) claim immediately after a fresh snapshot is zero.
        share::set_yield_claimed_index(&mut sh, accumulator::cumulative_yield_index(&acc));
        let z = accumulator::claim_rewards(&mut acc, &mut sh, s.ctx());
        assert!(z.burn_for_testing() == 0);

        // (5) a near-u64 deposit flows through the index without overflow.
        accumulator::add_revenue(
            &mut acc, balance::create_for_testing<USDC>(1_000_000_000_000_000_000),
        );
        let big = accumulator::claim_rewards(&mut acc, &mut sh, s.ctx());
        assert!(big.burn_for_testing() > 0);

        transfer::public_transfer(sh, ALICE);
        ts::return_shared(acc);
    };

    // (6) 10^4 dust-heavy deposits: residue stays within the dust bound.
    s.next_tx(STRANGER);
    {
        let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
        let mut sh = share::mint_for_testing(accumulator::asset_id(&acc), GOAL, 0, s.ctx());
        share::set_yield_claimed_index(&mut sh, accumulator::cumulative_yield_index(&acc));
        let pool_before = accumulator::reward_pool_value(&acc);
        let mut i = 0u64;
        while (i < 10_000) {
            accumulator::add_revenue(&mut acc, balance::create_for_testing<USDC>(99));
            i = i + 1;
        };
        let c = accumulator::claim_rewards(&mut acc, &mut sh, s.ctx());
        c.burn_for_testing();
        // Whatever the single holder could not claim is pure truncation dust.
        let residue = accumulator::reward_pool_value(&acc) - pool_before;
        assert!(residue <= accumulator::dust_bound(&acc));
        transfer::public_transfer(sh, ALICE);
        ts::return_shared(acc);
    };
    s.end();
}

// === §21.6 Wrap-cycle upper bound ===

/// Property: over any wrap/unwrap/claim interleaving, a holder's lifetime
/// claims never exceed the total investor revenue deposited while they were
/// unwrapped (eligible). The lazy index pays at most that — flooring only ever
/// loses dust in the pool's favor.
#[test]
fun test_wrap_cycle_upper_bound() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_operational(&mut s, target_id);
    set_cooldown_zero(&mut s);

    s.next_tx(STRANGER);
    {
        let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, 10_000_000);

        let mut alice_share = option::some(
            share::mint_for_testing(accumulator::asset_id(&acc), ALICE_SHARES, 0, s.ctx()),
        );
        let mut alice_coin = option::none<Coin<INT_TOKEN>>();
        // BOB exists purely to vary the unwrapped denominator.
        let mut bob_share = option::some(
            share::mint_for_testing(accumulator::asset_id(&acc), BOB_SHARES, 0, s.ctx()),
        );

        let mut rng = 0xA5A5_F00D_1234_5678u64;
        let mut alice_eligible_revenue = 0u64; // Σ investor while ALICE unwrapped
        let mut alice_claimed = 0u64;
        let mut step = 0u64;
        while (step < 400) {
            rng = next_rand(rng);
            let op = rng % 3;
            if (op == 0) {
                // Investor portion of a raw deposit at the default 0% asset fee
                // (add_revenue takes the already-split investor amount).
                let investor = (rng % 1_000_000_000) + 1;
                if (alice_share.is_some()) {
                    alice_eligible_revenue = alice_eligible_revenue + investor;
                };
                accumulator::add_revenue(&mut acc, balance::create_for_testing<USDC>(investor));
            } else if (op == 1) {
                if (alice_share.is_some()) {
                    let sh = alice_share.extract();
                    let (c, y) = accumulator::wrap_shares(&mut acc, &config, sh, &clock, s.ctx());
                    y.burn_for_testing();
                    alice_coin.fill(c);
                } else {
                    let c = alice_coin.extract();
                    alice_share.fill(accumulator::unwrap_coins(&mut acc, c, &clock, s.ctx()));
                };
            } else {
                if (alice_share.is_some()) {
                    let c = accumulator::claim_rewards(&mut acc, alice_share.borrow_mut(), s.ctx());
                    alice_claimed = alice_claimed + c.burn_for_testing();
                };
            };
            // The upper bound holds at every step.
            assert!(alice_claimed <= alice_eligible_revenue);
            step = step + 1;
        };

        // Final settle (if unwrapped) — still bounded.
        if (alice_share.is_some()) {
            let c = accumulator::claim_rewards(&mut acc, alice_share.borrow_mut(), s.ctx());
            alice_claimed = alice_claimed + c.burn_for_testing();
        };
        assert!(alice_claimed <= alice_eligible_revenue);

        if (alice_share.is_some()) { transfer::public_transfer(alice_share.extract(), ALICE); };
        if (alice_coin.is_some()) { alice_coin.extract().burn_for_testing(); };
        transfer::public_transfer(bob_share.extract(), BOB);
        alice_share.destroy_none();
        alice_coin.destroy_none();
        bob_share.destroy_none();
        clock.destroy_for_testing();
        ts::return_shared(acc);
        ts::return_shared(config);
    };
    s.end();
}

// === §21.7 Pause conformance (I-X1) ===

/// With `paused == true`, every exit still succeeds: claim, unwrap, close
/// (not pause-gated), and redeem all work. The entry side (deposit/wrap/
/// contribute/register aborting EPaused) is covered by the per-module suites
/// and the representative companions below.
#[test]
fun test_pause_conformance_full_matrix() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_operational(&mut s, target_id);
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);
    wrap(&mut s, BOB, WRAP_MS); // BOB holds a coin going into the pause
    deposit(&mut s, RENT);

    pause(&mut s);

    // Exit: claim works while paused.
    assert!(claim(&mut s, ALICE) == RENT_INVESTOR); // 100% — BOB is wrapped
    // Exit: unwrap works while paused (and during any freeze).
    unwrap(&mut s, BOB, WRAP_MS + 1_000);
    // Exit: close is not pause-gated; wind-down still co-signs.
    close_wind_down(&mut s);
    // Exit: redeem works while paused.
    let a = redeem(&mut s, ALICE);
    let b = redeem(&mut s, BOB);
    assert!(a + b == 0); // ALICE already claimed; BOB's fresh share owes nothing
    s.end();
}

#[test]
#[expected_failure(abort_code = protocol::EPaused)]
fun test_pause_blocks_deposit() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_operational(&mut s, target_id);
    pause(&mut s);
    deposit(&mut s, RENT); // capital entry: blocked
    s.end();
}

#[test]
#[expected_failure(abort_code = protocol::EPaused)]
fun test_pause_blocks_wrap() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_operational(&mut s, target_id);
    convert_receipt(&mut s, ALICE);
    pause(&mut s);
    wrap(&mut s, ALICE, WRAP_MS); // capital entry: blocked
    s.end();
}

// === Closure & redemption guards ===

#[test]
#[expected_failure(abort_code = accumulator::ENotClosed)]
fun test_redeem_before_close_aborts() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_operational(&mut s, target_id);
    convert_receipt(&mut s, ALICE);
    redeem(&mut s, ALICE); // OPERATIONAL, not CLOSED
    s.end();
}

#[test]
#[expected_failure(abort_code = asset::ENotTermFinancing)]
fun test_close_target_on_non_term_aborts() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_operational(&mut s, target_id);
    s.next_tx(STRANGER);
    let mut asset = s.take_shared<Asset>();
    let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    asset::close_at_return_target<INT_TOKEN>(&mut asset, &mut acc, &config, s.ctx());
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EReturnTargetNotMet)]
fun test_close_target_before_target_aborts() {
    let (mut s, target_id, _j1, _j2, _j3) = setup_with(true, RETURN_TARGET);
    to_operational(&mut s, target_id);
    deposit(&mut s, RENT); // far below the 100k target
    s.next_tx(STRANGER);
    let mut asset = s.take_shared<Asset>();
    let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    asset::close_at_return_target<INT_TOKEN>(&mut asset, &mut acc, &config, s.ctx());
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EReturnTargetNotMet)]
fun test_create_term_below_principal_aborts() {
    let mut s = ts::begin(ADMIN);
    protocol::init_for_testing(s.ctx());
    s.next_tx(ENTITY);
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, 0);
    // return_target < funding_goal: rejected at listing.
    asset::create_term_asset(
        &config, GOAL, FUNDING_DEADLINE_MS,
        vector[GOAL], vector[b"only"], vector[20_000], 5_000,
        GOAL - 1,
        coin::mint_for_testing<USDC>(COLLATERAL, s.ctx()), &clock, s.ctx(),
    );
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::ECompensationNotSwept)]
fun test_close_compensation_before_sweep_aborts() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_executing(&mut s);
    run_tranche(&mut s, target_id, 0);
    flag_default(&mut s, T1_DEADLINE_MS + 1);
    // Grace elapsed but the pool is NOT yet swept.
    s.next_tx(STRANGER);
    let mut asset = s.take_shared<Asset>();
    let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, T1_DEADLINE_MS + 1 + GRACE_MS + 1);
    asset::close_after_compensation<INT_TOKEN>(&mut asset, &mut acc, &config, &clock, s.ctx());
    abort 0
}

#[test]
#[expected_failure(abort_code = accumulator::ESharesOutstanding)]
fun test_dust_sweep_with_shares_outstanding_aborts() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_operational(&mut s, target_id);
    convert_receipt(&mut s, ALICE); // a live share remains
    close_wind_down(&mut s);
    sweep_dust(&mut s); // total_minted != 0 → aborts
    s.end();
}

/// Full close → redeem → dust sweep with dust-y deposits: the residue is
/// non-zero, equals the pool balance, and is within the tracked dust bound.
#[test]
fun test_dust_sweep_guarded() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_operational(&mut s, target_id);
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);

    // Awkward amounts so the index floors leave real dust.
    deposit(&mut s, 1_000_000_003);
    deposit(&mut s, 7_777_777);
    deposit(&mut s, 999_999_999);

    close_wind_down(&mut s);
    redeem(&mut s, ALICE);
    redeem(&mut s, BOB);

    s.next_tx(STRANGER);
    let pool_residue;
    let bound;
    {
        let acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
        assert!(accumulator::total_minted_shares(&acc) == 0);
        assert!(accumulator::total_wrapped_shares(&acc) == 0);
        pool_residue = accumulator::reward_pool_value(&acc) + accumulator::rollover_reserve_value(&acc);
        bound = accumulator::dust_bound(&acc);
        ts::return_shared(acc);
    };
    assert!(pool_residue <= bound);

    let swept = sweep_dust(&mut s);
    assert!(swept == pool_residue);

    s.next_tx(STRANGER);
    let acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    assert!(accumulator::reward_pool_value(&acc) == 0);
    ts::return_shared(acc);
    s.end();
}

/// Conservation (m7 pass criterion 4): every investor unit deposited is either
/// claimed/redeemed out or left as bounded dust — to the unit.
#[test]
fun test_redeem_conservation() {
    let (mut s, target_id, _j1, _j2, _j3) = setup_with(true, RETURN_TARGET);
    to_operational(&mut s, target_id);
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);
    deposit(&mut s, TRADE_GROSS);

    s.next_tx(STRANGER);
    {
        let mut asset = s.take_shared<Asset>();
        let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
        let config = s.take_shared<ProtocolConfig>();
        asset::close_at_return_target<INT_TOKEN>(&mut asset, &mut acc, &config, s.ctx());
        ts::return_shared(asset);
        ts::return_shared(acc);
        ts::return_shared(config);
    };

    let out = redeem(&mut s, ALICE) + redeem(&mut s, BOB);

    s.next_tx(STRANGER);
    let acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    let lifetime = accumulator::lifetime_investor_revenue(&acc);
    let residue = accumulator::reward_pool_value(&acc);
    // out + dust == everything that came in; dust within bound.
    assert!(out + residue == lifetime);
    assert!(residue <= accumulator::dust_bound(&acc));
    assert!(lifetime == TRADE_INVESTOR);
    ts::return_shared(acc);
    s.end();
}

// === §20 Adversarial analysis — one named test per attack row ===

const RESOLVE_MS: u64 = 700_000_000; // > open(3_000) + dispute_window(7d)

/// A1 — entity absconds with raise: capital only moves via validator-approved
/// tranches. Pulling an unapproved tranche aborts.
#[test]
#[expected_failure(abort_code = asset::ENotApproved)]
fun test_attack_a1_no_release_without_approval() {
    let (mut s, _t, _j1, _j2, _j3) = setup();
    to_executing(&mut s);
    s.next_tx(ENTITY);
    let mut asset = s.take_shared<Asset>();
    let config = s.take_shared<ProtocolConfig>();
    let ecap = s.take_from_sender<EntityCap>();
    let payout = asset::release_funding_tranche(&mut asset, &ecap, &config, 0, s.ctx());
    payout.burn_for_testing();
    abort 0
}

/// A2 — validator/entity collusion: a public dispute slashes the coverage and
/// stacks the three compensation layers.
#[test]
fun test_attack_a2_collusion_slashed() {
    let (mut s, target_id, j1, j2, j3) = setup();
    to_executing(&mut s);
    let d = open_dispute(&mut s, target_id, 3_000);
    vote(&mut s, J1, j1, d, true);
    vote(&mut s, J2, j2, d, true);
    vote(&mut s, J3, j3, d, true);
    resolve(&mut s, target_id, d, RESOLVE_MS);

    s.next_tx(STRANGER);
    let pool = s.take_shared_by_id<ValidatorPool>(target_id);
    let asset = s.take_shared<Asset>();
    let acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    assert!(validator::is_slashed(&pool));
    assert!(asset::is_compensating(&asset));
    // Three layers: collateral 10k + escrow 100k + slash remainder 18k.
    assert!(
        accumulator::compensation_pool_value(&acc)
            == COLLATERAL + GOAL + (COVERAGE - COVERAGE / 10),
    );
    ts::return_shared(pool);
    ts::return_shared(asset);
    ts::return_shared(acc);
    s.end();
}

/// A3 — validator exit-scam: a freeze the instant a dispute lands blocks the
/// stake withdrawal.
#[test]
#[expected_failure(abort_code = validator::EValidatorNotActive)]
fun test_attack_a3_frozen_cannot_withdraw() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_executing(&mut s);
    let _d = open_dispute(&mut s, target_id, 3_000); // freezes the target pool
    s.next_tx(TARGET);
    let mut pool = s.take_shared_by_id<ValidatorPool>(target_id);
    let vcap = s.take_from_sender<ValidatorCap>();
    let config = s.take_shared<ProtocolConfig>();
    let c = validator::withdraw_stake(&mut pool, &vcap, &config, 1, s.ctx());
    c.burn_for_testing();
    abort 0
}

/// A4 — retroactive yield theft: wrapping resets the index snapshot, so time
/// spent wrapped earns exactly zero.
#[test]
fun test_attack_a4_no_retroactive_yield() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_operational(&mut s, target_id);
    convert_receipt(&mut s, ALICE);
    wrap(&mut s, ALICE, WRAP_MS); // leaves the yield table
    deposit(&mut s, RENT); // a fat drop lands while ALICE is wrapped
    unwrap(&mut s, ALICE, WRAP_MS + 1_000); // fresh snapshot at the live index
    assert!(claim(&mut s, ALICE) == 0); // the wrapped-window delta is unrepresentable
    s.end();
}

/// A5 — deposit sandwich damping: the wrap cooldown blocks immediate re-wrap.
#[test]
#[expected_failure(abort_code = accumulator::EWrapCooldown)]
fun test_attack_a5_wrap_cooldown_enforced() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_operational(&mut s, target_id);
    convert_receipt(&mut s, ALICE); // acquired at CONVERT_MS
    wrap(&mut s, ALICE, CONVERT_MS + 3_600_000 - 1); // one ms early
    s.end();
}

/// A6 — receipt double-spend: the receipt is consumed by value, so a second
/// use (here, after a refund) finds an empty inventory and aborts.
#[test]
#[expected_failure]
fun test_attack_a6_receipt_consumed_once() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    fund(&mut s, ALICE, ALICE_SHARES); // below the 100k goal
    s.next_tx(STRANGER);
    {
        let mut asset = s.take_shared<Asset>();
        let mut pool = s.take_shared_by_id<ValidatorPool>(target_id);
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, FUNDING_DEADLINE_MS + 1);
        asset::abort_failed_raise(&mut asset, &mut pool, &config, &clock, s.ctx());
        clock.destroy_for_testing();
        ts::return_shared(asset);
        ts::return_shared(pool);
        ts::return_shared(config);
    };
    // First use: refund consumes the receipt.
    s.next_tx(ALICE);
    {
        let mut asset = s.take_shared<Asset>();
        let config = s.take_shared<ProtocolConfig>();
        let receipt = s.take_from_sender<ContributionReceipt>();
        let refund = asset::refund_contribution(&mut asset, &config, receipt, s.ctx());
        assert!(refund.burn_for_testing() == ALICE_SHARES);
        ts::return_shared(asset);
        ts::return_shared(config);
    };
    // Second use: the receipt is gone. take aborts; if it (wrongly) persisted,
    // the refund below runs and the test fails its expected_failure.
    s.next_tx(ALICE);
    let mut asset = s.take_shared<Asset>();
    let config = s.take_shared<ProtocolConfig>();
    let ghost = s.take_from_sender<ContributionReceipt>();
    let c = asset::refund_contribution(&mut asset, &config, ghost, s.ctx());
    c.burn_for_testing();
    ts::return_shared(asset);
    ts::return_shared(config);
    s.end();
}

/// A7 — pre-minted Coin<T> breaking the peg: finalize rejects a non-virgin cap.
#[test]
#[expected_failure(abort_code = accumulator::ECapNotVirgin)]
fun test_attack_a7_premint_cap_rejected() {
    let (mut s, _t, _j1, _j2, _j3) = setup();
    fund(&mut s, ALICE, ALICE_SHARES);
    fund(&mut s, BOB, BOB_SHARES); // raised == goal
    s.next_tx(STRANGER);
    let mut asset = s.take_shared<Asset>();
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, 3_000);
    let mut cap = coin::create_treasury_cap_for_testing<INT_TOKEN>(s.ctx());
    let pre = coin::mint(&mut cap, 1, s.ctx()); // tainted supply
    transfer::public_transfer(pre, STRANGER);
    asset::finalize_successful_raise<INT_TOKEN>(&mut asset, &config, cap, &clock, s.ctx());
    abort 0
}

/// A8 — dispute spam: a rejected challenge forfeits the whole bond (split to
/// the wronged target pool and the jurors), so frivolous challenges always lose.
#[test]
fun test_attack_a8_spam_bond_forfeited() {
    let (mut s, target_id, j1, j2, j3) = setup();
    to_operational(&mut s, target_id);
    let d = open_dispute(&mut s, target_id, 3_000);
    vote(&mut s, J1, j1, d, false);
    vote(&mut s, J2, j2, d, false);
    vote(&mut s, J3, j3, d, false);
    resolve(&mut s, target_id, d, RESOLVE_MS);

    s.next_tx(STRANGER);
    let dispute = s.take_shared_by_id<Dispute>(d);
    assert!(dispute::status(&dispute) == dispute::status_rejected());
    // The challenger gets nothing back; the jurors' half waits to be pulled.
    assert!(dispute::juror_reward_pool_value(&dispute) == BOND / 2);
    ts::return_shared(dispute);
    s.end();
}

/// A9 — jury sybil: one vote per staked pool. A second vote from the same pool
/// aborts.
#[test]
#[expected_failure(abort_code = dispute::EAlreadyVoted)]
fun test_attack_a9_one_vote_per_pool() {
    let (mut s, target_id, j1, _j2, _j3) = setup();
    to_executing(&mut s);
    let d = open_dispute(&mut s, target_id, 3_000);
    vote(&mut s, J1, j1, d, true);
    vote(&mut s, J1, j1, d, true); // same pool, again
    s.end();
}

/// A10 — admin key compromise: every parameter has a hard cap. Setting the fee
/// above 10% aborts, no matter the admin.
#[test]
#[expected_failure(abort_code = protocol::EFeeExceedsCap)]
fun test_attack_a10_param_hard_cap() {
    let mut s = ts::begin(ADMIN);
    protocol::init_for_testing(s.ctx());
    s.next_tx(ADMIN);
    let mut config = s.take_shared<ProtocolConfig>();
    let cap = s.take_from_sender<AdminCap>();
    protocol::admin_set_fee_bps(&mut config, &cap, 1_001); // > MAX 1_000 bps
    abort 0
}

/// A11 — stranded revenue at 100% wrapped: routes to the rollover reserve and
/// is rescued by a permissionless sweep, never lost.
#[test]
fun test_attack_a11_rollover_rescue() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_operational(&mut s, target_id);
    s.next_tx(STRANGER);
    {
        let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
        // Everyone wrapped → unwrapped supply zero.
        accumulator::set_total_wrapped_for_testing(&mut acc, GOAL);
        accumulator::add_revenue(&mut acc, balance::create_for_testing<USDC>(RENT_INVESTOR));
        assert!(accumulator::cumulative_yield_index(&acc) == 0); // no division
        assert!(accumulator::rollover_reserve_value(&acc) == RENT_INVESTOR);

        // First unwrapper resurrects it: index advances, reserve drains.
        accumulator::set_total_wrapped_for_testing(&mut acc, 0);
        accumulator::sweep_rollover(&mut acc);
        assert!(accumulator::cumulative_yield_index(&acc) > 0);
        assert!(accumulator::rollover_reserve_value(&acc) == 0);
        ts::return_shared(acc);
    };
    s.end();
}

/// A12 — wrapped holders excluded from compensation: the freeze-wrap + grace
/// window lets a wrapped holder unwrap and join the restitution before the sweep.
#[test]
fun test_attack_a12_wrapped_join_compensation_in_grace() {
    let (mut s, target_id, j1, j2, j3) = setup();
    to_operational(&mut s, target_id);
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);
    wrap(&mut s, BOB, WRAP_MS); // BOB is wrapped when the fraud surfaces

    let d = open_dispute(&mut s, target_id, 3_000);
    vote(&mut s, J1, j1, d, true);
    vote(&mut s, J2, j2, d, true);
    vote(&mut s, J3, j3, d, true);
    resolve(&mut s, target_id, d, RESOLVE_MS); // UPHELD, operational: 18k → compensation, frozen

    unwrap(&mut s, BOB, RESOLVE_MS + 1_000); // BOB returns during the grace window
    sweep_compensation(&mut s, RESOLVE_MS + GRACE_MS + 1);

    // 18k slash remainder over 100k unwrapped → BOB's 40% == 7.2k. He was made whole.
    assert!(claim(&mut s, BOB) == 7_200_000_000);
    s.end();
}

/// A13 — blob-swap behind a Walrus ID: the reference pins the sha256 content
/// hash, not just the pointer.
#[test]
fun test_attack_a13_walrus_pins_content_hash() {
    let mut s = ts::begin(ADMIN);
    let r = asset::new_walrus_ref(b"blob-pointer", b"sha256-of-the-deed", s.ctx());
    assert!(asset::walrus_blob_id(&r) == b"blob-pointer");
    assert!(asset::walrus_sha256(&r) == b"sha256-of-the-deed");
    s.end();
}

/// A14 — integer overflow in index math: the explicit payout bound trips
/// rather than silently wrapping.
#[test]
#[expected_failure(abort_code = accumulator::EPayoutOverflow)]
fun test_attack_a14_payout_overflow_guarded() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_operational(&mut s, target_id);
    s.next_tx(STRANGER);
    let mut acc = s.take_shared<GlobalYieldAccumulator<INT_TOKEN>>();
    accumulator::set_index_for_testing(&mut acc, 100_000_000_000_000_000_000); // 1e20
    let mut sh = share::mint_for_testing(accumulator::asset_id(&acc), ALICE_SHARES, 0, s.ctx());
    let c = accumulator::claim_rewards(&mut acc, &mut sh, s.ctx());
    c.burn_for_testing();
    abort 0
}

/// A15 — stranded capital via an absent counterparty: finalize / abort /
/// flag_default are all permissionless. Here a STRANGER (neither entity nor
/// validator) clears a failed raise so contributors can exit.
#[test]
fun test_attack_a15_permissionless_abort() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    fund(&mut s, ALICE, ALICE_SHARES); // 60k < 100k goal: doomed raise
    s.next_tx(STRANGER);
    {
        let mut asset = s.take_shared<Asset>();
        let mut pool = s.take_shared_by_id<ValidatorPool>(target_id);
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, FUNDING_DEADLINE_MS + 1);
        asset::abort_failed_raise(&mut asset, &mut pool, &config, &clock, s.ctx());
        assert!(asset::state(&asset) == asset::state_failed());
        clock.destroy_for_testing();
        ts::return_shared(asset);
        ts::return_shared(pool);
        ts::return_shared(config);
    };
    s.end();
}
