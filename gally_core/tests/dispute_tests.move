/// M6 test suite (work order: milestone/gally core/m6.md).
/// Covers: UPHELD on EXECUTING (three-layer compensation) and OPERATIONAL
/// (stays operational), REJECTED (bond split + juror pull) and EXPIRED
/// (full refund); bounded exposure (only coverage slashed); exact bond;
/// one-dispute-per-asset; freeze voids pending approvals; juror eligibility
/// and double-vote; deadline-only resolution; the grace-window wrap/unwrap
/// asymmetry plus the sweep; the FUNDING-window block; and pause conformance
/// (dispute paths work while paused).
#[test_only]
module gally_core::dispute_tests;

use gally_core::accumulator::{Self, GlobalYieldAccumulator};
use gally_core::asset::{Self, Asset, ContributionReceipt, EntityCap};
use gally_core::dispute_token::{Self, DISPUTE_TOKEN};
use gally_core::dispute::{Self, Dispute};
use gally_core::protocol::{Self, AdminCap, ProtocolConfig};
use gally_core::share::GallyShare;
use usdc::usdc::USDC;
use gally_core::validator::{Self, ValidatorCap, ValidatorPool};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::test_scenario as ts;

const ADMIN: address = @0xA1;
const TARGET: address = @0xC3; // the vouching validator (dispute target)
const J1: address = @0x101;
const J2: address = @0x102;
const J3: address = @0x103;
const ENTITY: address = @0xE5;
const ALICE: address = @0xAA;
const BOB: address = @0xBB;
const CHALLENGER: address = @0xCC;

const GOAL: u64 = 100_000_000_000;
const COLLATERAL: u64 = 10_000_000_000;
const COVERAGE: u64 = 20_000_000_000; // 20% of goal
const TARGET_STAKE: u64 = 50_000_000_000;
const JUROR_STAKE: u64 = 15_000_000_000; // above the 10k jury_min_stake
const ALICE_SHARES: u64 = 60_000_000_000;
const BOB_SHARES: u64 = 40_000_000_000;

const BOND: u64 = 1_000_000_000; // default challenger_bond
const FUNDING_DEADLINE_MS: u64 = 10_000;
const GRACE_MS: u64 = 604_800_000;

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
        validator::register_validator_for_testing(
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
/// Returns (target_pool_id, j1, j2, j3). Asset is left in FUNDING.
fun setup(): (ts::Scenario, ID, ID, ID, ID) {
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
        asset::create_asset_for_testing(
            &config,
            GOAL,
            FUNDING_DEADLINE_MS,
            vector[40_000_000_000, 35_000_000_000, 25_000_000_000],
            vector[b"land", b"build", b"fit"],
            vector[20_000, 30_000, 40_000],
            5_000,
            coin::mint_for_testing<USDC>(COLLATERAL, s.ctx()),
            &clock,
            s.ctx(),
        );
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
    s.next_tx(CHALLENGER);
    let mut asset = s.take_shared<Asset>();
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(s, 3_000);
    let (cap, metadata) = dispute_token::new(s.ctx());
    asset::finalize_successful_raise<DISPUTE_TOKEN>(&mut asset, &config, cap, &metadata, &clock, s.ctx());
    transfer::public_freeze_object(metadata);
    clock.destroy_for_testing();
    ts::return_shared(asset);
    ts::return_shared(config);
}

/// FUNDING → EXECUTING, fully funded, no tranches released (escrow == goal).
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

/// EXECUTING → OPERATIONAL (all three tranches), coverage still locked.
fun to_operational(s: &mut ts::Scenario, target_id: ID) {
    to_executing(s);
    run_tranche(s, target_id, 0);
    run_tranche(s, target_id, 1);
    run_tranche(s, target_id, 2);
}

fun convert_receipt(s: &mut ts::Scenario, who: address) {
    s.next_tx(who);
    let asset = s.take_shared<Asset>();
    let acc = s.take_shared<GlobalYieldAccumulator<DISPUTE_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    let receipt = s.take_from_sender<ContributionReceipt>();
    let clock = make_clock(s, 4_000);
    let minted =
        asset::claim_shares<DISPUTE_TOKEN>(&asset, &acc, &config, receipt, &clock, s.ctx());
    transfer::public_transfer(minted, who);
    clock.destroy_for_testing();
    ts::return_shared(asset);
    ts::return_shared(acc);
    ts::return_shared(config);
}

/// CHALLENGER opens a dispute against the target at `now_ms`; returns its ID.
fun open_dispute(s: &mut ts::Scenario, target_id: ID, now_ms: u64): ID {
    s.next_tx(CHALLENGER);
    {
        let mut asset = s.take_shared<Asset>();
        let mut pool = s.take_shared_by_id<ValidatorPool>(target_id);
        let acc = s.take_shared<GlobalYieldAccumulator<DISPUTE_TOKEN>>();
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(s, now_ms);
        let bond = coin::mint_for_testing<USDC>(BOND, s.ctx());
        let evidence = asset::new_walrus_ref(b"fraud", b"sha-fraud", s.ctx());
        dispute::initialize_dispute_for_testing<DISPUTE_TOKEN>(
            &mut asset,
            &mut pool,
            &acc,
            &config,
            bond,
            evidence,
            &clock,
            s.ctx(),
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
    let mut acc = s.take_shared<GlobalYieldAccumulator<DISPUTE_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(s, now_ms);
    dispute::resolve_dispute<DISPUTE_TOKEN>(
        &mut dispute,
        &mut pool,
        &mut asset,
        &mut acc,
        &config,
        &clock,
        s.ctx(),
    );
    clock.destroy_for_testing();
    ts::return_shared(dispute);
    ts::return_shared(pool);
    ts::return_shared(asset);
    ts::return_shared(acc);
    ts::return_shared(config);
}

fun sweep(s: &mut ts::Scenario, now_ms: u64) {
    s.next_tx(CHALLENGER);
    let mut acc = s.take_shared<GlobalYieldAccumulator<DISPUTE_TOKEN>>();
    let clock = make_clock(s, now_ms);
    accumulator::sweep_compensation(&mut acc, &clock);
    clock.destroy_for_testing();
    ts::return_shared(acc);
}

fun claim(s: &mut ts::Scenario, who: address): u64 {
    s.next_tx(who);
    let mut acc = s.take_shared<GlobalYieldAccumulator<DISPUTE_TOKEN>>();
    let mut sh = s.take_from_sender<GallyShare>();
    let payout = accumulator::claim_rewards(&mut acc, &mut sh, s.ctx());
    let v = payout.burn_for_testing();
    ts::return_shared(acc);
    s.return_to_sender(sh);
    v
}

fun pause(s: &mut ts::Scenario) {
    s.next_tx(ADMIN);
    let mut config = s.take_shared<ProtocolConfig>();
    let cap = s.take_from_sender<AdminCap>();
    protocol::admin_emergency_stop(&mut config, &cap);
    ts::return_shared(config);
    s.return_to_sender(cap);
}

// after deadline; vote at t=1_000_000 < deadline (3_000 + 604_800_000).
const RESOLVE_MS: u64 = 700_000_000;

// === UPHELD ===

#[test]
fun test_upheld_executing_three_layer_compensation() {
    let (mut s, target_id, j1, j2, j3) = setup();
    to_executing(&mut s);
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);

    let d = open_dispute(&mut s, target_id, 3_000);
    vote(&mut s, J1, j1, d, true);
    vote(&mut s, J2, j2, d, true);
    vote(&mut s, J3, j3, d, true);
    resolve(&mut s, target_id, d, RESOLVE_MS);

    // Verdict + slash; target pool slashed, retains stake − coverage.
    s.next_tx(CHALLENGER);
    {
        let dispute = s.take_shared_by_id<Dispute>(d);
        let pool = s.take_shared_by_id<ValidatorPool>(target_id);
        let asset = s.take_shared<Asset>();
        let acc = s.take_shared<GlobalYieldAccumulator<DISPUTE_TOKEN>>();
        assert!(dispute::status(&dispute) == dispute::status_upheld());
        assert!(validator::is_slashed(&pool));
        assert!(validator::stake_value(&pool) == TARGET_STAKE - COVERAGE);
        assert!(asset::is_compensating(&asset));
        assert!(asset::coverage_locked(&asset) == 0);
        // Three layers: collateral 10k + escrow 100k + slash remainder 18k.
        assert!(
            accumulator::compensation_pool_value(&acc)
                == COLLATERAL + GOAL + (COVERAGE - COVERAGE / 10),
        );
        assert!(accumulator::is_wrapping_frozen(&acc));
        ts::return_shared(dispute);
        ts::return_shared(pool);
        ts::return_shared(asset);
        ts::return_shared(acc);
    };

    // Challenger received bounty (10% of 20k = 2k) + bond (1k) = 3k.
    s.next_tx(CHALLENGER);
    {
        let c = s.take_from_sender<Coin<USDC>>();
        assert!(c.burn_for_testing() == COVERAGE / 10 + BOND);
    };

    // After grace: sweep distributes 128k across 100k shares, pro rata.
    sweep(&mut s, RESOLVE_MS + GRACE_MS);
    let total = COLLATERAL + GOAL + (COVERAGE - COVERAGE / 10);
    assert!(claim(&mut s, ALICE) == total * 60 / 100);
    assert!(claim(&mut s, BOB) == total * 40 / 100);
    s.end();
}

#[test]
fun test_upheld_operational_stays_operational() {
    let (mut s, target_id, j1, j2, j3) = setup();
    to_operational(&mut s, target_id);
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);

    let d = open_dispute(&mut s, target_id, 50_000);
    vote(&mut s, J1, j1, d, true);
    vote(&mut s, J2, j2, d, true);
    vote(&mut s, J3, j3, d, true);
    resolve(&mut s, target_id, d, RESOLVE_MS);

    s.next_tx(CHALLENGER);
    {
        let asset = s.take_shared<Asset>();
        let acc = s.take_shared<GlobalYieldAccumulator<DISPUTE_TOKEN>>();
        // Asset keeps running so revenue still reaches the victims; only the
        // slash remainder (no escrow, no collateral) funds compensation.
        assert!(asset::is_operational(&asset));
        assert!(asset::collateral_value(&asset) == COLLATERAL); // untouched
        assert!(
            accumulator::compensation_pool_value(&acc) == COVERAGE - COVERAGE / 10,
        );
        ts::return_shared(asset);
        ts::return_shared(acc);
    };

    sweep(&mut s, RESOLVE_MS + GRACE_MS);
    let remainder = COVERAGE - COVERAGE / 10; // 18k
    assert!(claim(&mut s, ALICE) == remainder * 60 / 100);
    assert!(claim(&mut s, BOB) == remainder * 40 / 100);
    s.end();
}

#[test]
/// LI-D7: the challenger's `reason` is stored on the dispute and readable. The
/// `open_dispute` helper routes through `initialize_dispute_for_testing`, which
/// passes this exact string; a production caller supplies its own.
fun test_dispute_reason_roundtrip() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_executing(&mut s);
    let d = open_dispute(&mut s, target_id, 3_000);

    s.next_tx(CHALLENGER);
    {
        let dispute = s.take_shared_by_id<Dispute>(d);
        assert!(dispute::reason(&dispute) == b"Test dispute reason", 0);
        ts::return_shared(dispute);
    };
    s.end();
}

#[test]
fun test_bounded_exposure_only_coverage_slashed() {
    // The whole 50k stake is at risk in principle, but a single asset's
    // dispute can only take that asset's 20k coverage.
    let (mut s, target_id, j1, j2, j3) = setup();
    to_executing(&mut s);
    let d = open_dispute(&mut s, target_id, 3_000);
    vote(&mut s, J1, j1, d, true);
    vote(&mut s, J2, j2, d, true);
    vote(&mut s, J3, j3, d, true);
    resolve(&mut s, target_id, d, RESOLVE_MS);

    s.next_tx(CHALLENGER);
    let pool = s.take_shared_by_id<ValidatorPool>(target_id);
    assert!(validator::stake_value(&pool) == TARGET_STAKE - COVERAGE); // 30k survives
    ts::return_shared(pool);
    s.end();
}

// === REJECTED ===

#[test]
fun test_rejected_splits_bond_and_jurors_pull() {
    let (mut s, target_id, j1, j2, j3) = setup();
    to_executing(&mut s);
    let d = open_dispute(&mut s, target_id, 3_000);
    // Quorum met (3), but all innocent: guilty fraction 0 < threshold.
    vote(&mut s, J1, j1, d, false);
    vote(&mut s, J2, j2, d, false);
    vote(&mut s, J3, j3, d, false);
    resolve(&mut s, target_id, d, RESOLVE_MS);

    s.next_tx(CHALLENGER);
    {
        let dispute = s.take_shared_by_id<Dispute>(d);
        let pool = s.take_shared_by_id<ValidatorPool>(target_id);
        let asset = s.take_shared<Asset>();
        assert!(dispute::status(&dispute) == dispute::status_rejected());
        // Target unfrozen and credited the 50% (500 USDC): 50k + 500.
        assert!(validator::is_active(&pool));
        assert!(validator::stake_value(&pool) == TARGET_STAKE + BOND / 2);
        assert!(!asset::is_disputed(&asset));
        // Jurors' half (500) / 3 = 166 each, dust 2 retained.
        assert!(dispute::juror_reward_per_vote(&dispute) == (BOND / 2) / 3);
        ts::return_shared(dispute);
        ts::return_shared(pool);
        ts::return_shared(asset);
    };

    // Each juror pulls once.
    claim_juror(&mut s, J1, j1, d);
    claim_juror(&mut s, J2, j2, d);
    claim_juror(&mut s, J3, j3, d);
    s.end();
}

#[test]
#[expected_failure(abort_code = dispute::EJurorIneligible)]
fun test_juror_double_claim_aborts() {
    let (mut s, target_id, j1, j2, j3) = setup();
    to_executing(&mut s);
    let d = open_dispute(&mut s, target_id, 3_000);
    vote(&mut s, J1, j1, d, false);
    vote(&mut s, J2, j2, d, false);
    vote(&mut s, J3, j3, d, false);
    resolve(&mut s, target_id, d, RESOLVE_MS);
    claim_juror(&mut s, J1, j1, d);
    claim_juror(&mut s, J1, j1, d); // second pull from the same pool
    abort 0
}

// === EXPIRED ===

#[test]
fun test_expired_returns_full_bond() {
    let (mut s, target_id, j1, j2, _j3) = setup();
    to_executing(&mut s);
    let d = open_dispute(&mut s, target_id, 3_000);
    // Only two votes: quorum (3) never met.
    vote(&mut s, J1, j1, d, true);
    vote(&mut s, J2, j2, d, true);
    resolve(&mut s, target_id, d, RESOLVE_MS);

    s.next_tx(CHALLENGER);
    {
        let dispute = s.take_shared_by_id<Dispute>(d);
        let pool = s.take_shared_by_id<ValidatorPool>(target_id);
        assert!(dispute::status(&dispute) == dispute::status_expired());
        assert!(validator::is_active(&pool)); // unfrozen
        assert!(validator::stake_value(&pool) == TARGET_STAKE); // untouched
        ts::return_shared(dispute);
        ts::return_shared(pool);
    };
    // Full bond back to challenger.
    s.next_tx(CHALLENGER);
    let c = s.take_from_sender<Coin<USDC>>();
    assert!(c.burn_for_testing() == BOND);
    s.end();
}

// === Guards ===

#[test]
#[expected_failure(abort_code = dispute::EWrongBond)]
fun test_wrong_bond_aborts() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_executing(&mut s);

    s.next_tx(CHALLENGER);
    let mut asset = s.take_shared<Asset>();
    let mut pool = s.take_shared_by_id<ValidatorPool>(target_id);
    let acc = s.take_shared<GlobalYieldAccumulator<DISPUTE_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, 3_000);
    let bond = coin::mint_for_testing<USDC>(BOND - 1, s.ctx()); // one unit short
    let evidence = asset::new_walrus_ref(b"f", b"sha-f", s.ctx());
    dispute::initialize_dispute_for_testing<DISPUTE_TOKEN>(
        &mut asset, &mut pool, &acc, &config, bond, evidence, &clock, s.ctx(),
    );
    abort 0
}

#[test]
#[expected_failure(abort_code = dispute::EDisputeExists)]
fun test_one_dispute_per_asset() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_executing(&mut s);
    let _d = open_dispute(&mut s, target_id, 3_000);
    let _d2 = open_dispute(&mut s, target_id, 3_500); // asset already disputed
    abort 0
}

#[test]
#[expected_failure(abort_code = asset::EAssetDisputed)]
fun test_freeze_voids_pending_approval() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_executing(&mut s);

    // Entity submits proof; then a dispute lands before approval.
    s.next_tx(ENTITY);
    {
        let mut asset = s.take_shared<Asset>();
        let config = s.take_shared<ProtocolConfig>();
        let ecap = s.take_from_sender<EntityCap>();
        let proof = asset::new_walrus_ref(b"p", b"sha-p", s.ctx());
        asset::submit_milestone_proof(&mut asset, &ecap, &config, 0, proof);
        ts::return_shared(asset);
        ts::return_shared(config);
        s.return_to_sender(ecap);
    };
    let _d = open_dispute(&mut s, target_id, 3_000);

    // The frozen target cannot approve while disputed.
    s.next_tx(TARGET);
    let mut asset = s.take_shared<Asset>();
    let pool = s.take_shared_by_id<ValidatorPool>(target_id);
    let vcap = s.take_from_sender<ValidatorCap>();
    let config = s.take_shared<ProtocolConfig>();
    asset::approve_milestone(&mut asset, &pool, &vcap, &config, 0, s.ctx());
    abort 0
}

#[test]
#[expected_failure(abort_code = dispute::EJurorIneligible)]
fun test_target_cannot_vote() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_executing(&mut s);
    let d = open_dispute(&mut s, target_id, 3_000);
    // The target is FROZEN and excluded: voting from it is ineligible.
    vote(&mut s, TARGET, target_id, d, false);
    abort 0
}

#[test]
#[expected_failure(abort_code = dispute::EAlreadyVoted)]
fun test_double_vote_aborts() {
    let (mut s, target_id, j1, _j2, _j3) = setup();
    to_executing(&mut s);
    let d = open_dispute(&mut s, target_id, 3_000);
    vote(&mut s, J1, j1, d, true);
    vote(&mut s, J1, j1, d, false);
    abort 0
}

#[test]
#[expected_failure(abort_code = dispute::EJurorIneligible)]
fun test_understaked_juror_aborts() {
    let (mut s, target_id, _j1, _j2, _j3) = setup();
    to_executing(&mut s);
    // A pool below jury_min_stake (10k).
    let weak = register(&mut s, @0x9E, 10_000_000_000);
    s.next_tx(@0x9E);
    {
        // Drop it below the floor via a withdrawal (no vouches, ACTIVE).
        let mut pool = s.take_shared_by_id<ValidatorPool>(weak);
        let cap = s.take_from_sender<ValidatorCap>();
        let config = s.take_shared<ProtocolConfig>();
        let out = validator::withdraw_stake(&mut pool, &cap, &config, 5_000_000_000, s.ctx());
        out.burn_for_testing();
        ts::return_shared(pool);
        ts::return_shared(config);
        s.return_to_sender(cap);
    };
    let d = open_dispute(&mut s, target_id, 3_000);
    vote(&mut s, @0x9E, weak, d, true); // 5k < 10k floor
    abort 0
}

#[test]
#[expected_failure(abort_code = dispute::EVotingOpen)]
fun test_resolve_before_deadline_aborts() {
    let (mut s, target_id, j1, j2, j3) = setup();
    to_executing(&mut s);
    let d = open_dispute(&mut s, target_id, 3_000);
    vote(&mut s, J1, j1, d, true);
    vote(&mut s, J2, j2, d, true);
    vote(&mut s, J3, j3, d, true);
    resolve(&mut s, target_id, d, 100_000); // well before the 7-day deadline
    abort 0
}

#[test]
#[expected_failure(abort_code = dispute::EVotingClosed)]
fun test_vote_after_deadline_aborts() {
    let (mut s, target_id, j1, _j2, _j3) = setup();
    to_executing(&mut s);
    let d = open_dispute(&mut s, target_id, 3_000);
    // Vote helper uses t=1_000_000; here vote past the deadline explicitly.
    s.next_tx(J1);
    let mut dispute = s.take_shared_by_id<Dispute>(d);
    let pool = s.take_shared_by_id<ValidatorPool>(j1);
    let vcap = s.take_from_sender<ValidatorCap>();
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, RESOLVE_MS);
    dispute::vote_on_dispute(&mut dispute, &pool, &vcap, &config, true, &clock);
    abort 0
}

// NOTE: a "dispute during FUNDING" abort test is deliberately absent — the
// window guard is unreachable in FUNDING because no accumulator object exists
// to pass to initialize_dispute (the call cannot be constructed), exactly as
// with claim_shares pre-finalize in M3. The guard is instead exercised below
// on an already-COMPENSATING asset, which is neither EXECUTING nor OPERATIONAL.

#[test]
#[expected_failure(abort_code = dispute::EWrongAssetState)]
fun test_dispute_on_compensating_asset_aborts() {
    let (mut s, target_id, j1, j2, j3) = setup();
    to_executing(&mut s);
    let d = open_dispute(&mut s, target_id, 3_000);
    vote(&mut s, J1, j1, d, true);
    vote(&mut s, J2, j2, d, true);
    vote(&mut s, J3, j3, d, true);
    resolve(&mut s, target_id, d, RESOLVE_MS); // asset → COMPENSATING

    // A second dispute on a compensating asset hits the window guard.
    let _d2 = open_dispute(&mut s, target_id, RESOLVE_MS + 1);
    abort 0
}

// === Grace window (D5) ===

#[test]
#[expected_failure(abort_code = accumulator::EWrappingFrozen)]
fun test_grace_window_blocks_wrap() {
    let (mut s, target_id, j1, j2, j3) = setup();
    to_operational(&mut s, target_id);
    set_zero_cooldown(&mut s);
    convert_receipt(&mut s, ALICE);

    let d = open_dispute(&mut s, target_id, 50_000);
    vote(&mut s, J1, j1, d, true);
    vote(&mut s, J2, j2, d, true);
    vote(&mut s, J3, j3, d, true);
    resolve(&mut s, target_id, d, RESOLVE_MS); // wrapping now frozen

    // Wrap during the grace window is blocked.
    s.next_tx(ALICE);
    let mut acc = s.take_shared<GlobalYieldAccumulator<DISPUTE_TOKEN>>();
    let config = s.take_shared<ProtocolConfig>();
    let sh = s.take_from_sender<GallyShare>();
    let clock = make_clock(&mut s, RESOLVE_MS + 1);
    let (wrapped, y) = accumulator::wrap_shares(&mut acc, &config, sh, &clock, s.ctx());
    transfer::public_transfer(wrapped, ALICE);
    y.burn_for_testing();
    abort 0
}

#[test]
fun test_grace_window_unwrap_open_then_sweep() {
    let (mut s, target_id, j1, j2, j3) = setup();
    to_operational(&mut s, target_id);
    set_zero_cooldown(&mut s);
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);

    // ALICE wraps BEFORE the dispute.
    s.next_tx(ALICE);
    {
        let mut acc = s.take_shared<GlobalYieldAccumulator<DISPUTE_TOKEN>>();
        let config = s.take_shared<ProtocolConfig>();
        let sh = s.take_from_sender<GallyShare>();
        let clock = make_clock(&mut s, 60_000);
        let (wrapped, y) = accumulator::wrap_shares(&mut acc, &config, sh, &clock, s.ctx());
        transfer::public_transfer(wrapped, ALICE);
        y.burn_for_testing();
        clock.destroy_for_testing();
        ts::return_shared(acc);
        ts::return_shared(config);
    };

    let d = open_dispute(&mut s, target_id, 70_000);
    vote(&mut s, J1, j1, d, true);
    vote(&mut s, J2, j2, d, true);
    vote(&mut s, J3, j3, d, true);
    resolve(&mut s, target_id, d, RESOLVE_MS);

    // ALICE unwraps DURING the grace window — the whole point of D5.
    s.next_tx(ALICE);
    {
        let mut acc = s.take_shared<GlobalYieldAccumulator<DISPUTE_TOKEN>>();
        let c = s.take_from_sender<Coin<DISPUTE_TOKEN>>();
        let clock = make_clock(&mut s, RESOLVE_MS + 100);
        let fresh = accumulator::unwrap_coins(&mut acc, c, &clock, s.ctx());
        transfer::public_transfer(fresh, ALICE);
        clock.destroy_for_testing();
        ts::return_shared(acc);
    };

    // After grace: sweep over 100k unwrapped shares, both claim pro rata.
    sweep(&mut s, RESOLVE_MS + GRACE_MS + 1);
    let remainder = COVERAGE - COVERAGE / 10; // 18k
    assert!(claim(&mut s, ALICE) == remainder * 60 / 100);
    assert!(claim(&mut s, BOB) == remainder * 40 / 100);

    // Wrapping is unfrozen again post-sweep.
    s.next_tx(CHALLENGER);
    let acc = s.take_shared<GlobalYieldAccumulator<DISPUTE_TOKEN>>();
    assert!(!accumulator::is_wrapping_frozen(&acc));
    ts::return_shared(acc);
    s.end();
}

#[test]
#[expected_failure(abort_code = accumulator::EGraceNotElapsed)]
fun test_sweep_before_grace_aborts() {
    let (mut s, target_id, j1, j2, j3) = setup();
    to_executing(&mut s);
    let d = open_dispute(&mut s, target_id, 3_000);
    vote(&mut s, J1, j1, d, true);
    vote(&mut s, J2, j2, d, true);
    vote(&mut s, J3, j3, d, true);
    resolve(&mut s, target_id, d, RESOLVE_MS);
    sweep(&mut s, RESOLVE_MS + 1); // grace not elapsed
    abort 0
}

// === Pause conformance (D6) ===

#[test]
fun test_dispute_paths_work_while_paused() {
    let (mut s, target_id, j1, j2, j3) = setup();
    to_executing(&mut s);
    convert_receipt(&mut s, ALICE);
    convert_receipt(&mut s, BOB);
    pause(&mut s); // every dispute path below runs under pause

    let d = open_dispute(&mut s, target_id, 3_000);
    vote(&mut s, J1, j1, d, true);
    vote(&mut s, J2, j2, d, true);
    vote(&mut s, J3, j3, d, true);
    resolve(&mut s, target_id, d, RESOLVE_MS);
    sweep(&mut s, RESOLVE_MS + GRACE_MS);

    let total = COLLATERAL + GOAL + (COVERAGE - COVERAGE / 10);
    assert!(claim(&mut s, ALICE) == total * 60 / 100); // claim works paused too
    s.end();
}

// === Helpers (private) ===

fun claim_juror(s: &mut ts::Scenario, juror: address, juror_id: ID, dispute_id: ID) {
    s.next_tx(juror);
    let mut dispute = s.take_shared_by_id<Dispute>(dispute_id);
    let pool = s.take_shared_by_id<ValidatorPool>(juror_id);
    let vcap = s.take_from_sender<ValidatorCap>();
    let reward = dispute::claim_juror_reward(&mut dispute, &pool, &vcap, s.ctx());
    assert!(reward.burn_for_testing() == (BOND / 2) / 3);
    ts::return_shared(dispute);
    ts::return_shared(pool);
    s.return_to_sender(vcap);
}

fun set_zero_cooldown(s: &mut ts::Scenario) {
    s.next_tx(ADMIN);
    let mut config = s.take_shared<ProtocolConfig>();
    let cap = s.take_from_sender<AdminCap>();
    protocol::admin_set_min_wrap_duration_ms(&mut config, &cap, 0);
    ts::return_shared(config);
    s.return_to_sender(cap);
}
