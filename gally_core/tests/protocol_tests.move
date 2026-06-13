/// M1 test suite (work order: milestone/gally core/m1.md).
/// Covers: init shape and defaults, hard-cap enforcement on every gated
/// parameter, boundary values, pause/resume + guard behavior, version
/// kill-switch, and event emission counts.
#[test_only]
module gally_core::protocol_tests;

use gally_core::protocol::{Self, AdminCap, ProtocolConfig};
use sui::test_scenario as ts;

const ADMIN: address = @0xA1;
const NEW_TREASURY: address = @0xB2;

// === Helpers ===

/// Publishes the module (runs `init`) and advances one transaction so the
/// shared config and the admin cap are takeable.
fun setup(): ts::Scenario {
    let mut scenario = ts::begin(ADMIN);
    protocol::init_for_testing(scenario.ctx());
    scenario.next_tx(ADMIN);
    scenario
}

// === Init ===

#[test]
fun test_init_creates_config_and_cap() {
    let scenario = setup();

    // Exactly one shared ProtocolConfig with in-cap defaults.
    let config = scenario.take_shared<ProtocolConfig>();
    assert!(protocol::version(&config) == 1);
    assert!(!protocol::is_paused(&config));
    assert!(protocol::treasury(&config) == ADMIN);
    assert!(protocol::protocol_fee_bps(&config) <= 1_000);
    assert!(protocol::jury_threshold_bps(&config) > 5_000);
    assert!(protocol::jury_threshold_bps(&config) <= 10_000);
    assert!(protocol::challenger_bounty_bps(&config) <= 5_000);
    assert!(protocol::min_validator_stake(&config) > 0);
    assert!(protocol::jury_quorum(&config) > 0);
    ts::return_shared(config);

    // The publisher holds the AdminCap.
    let cap = scenario.take_from_sender<AdminCap>();
    scenario.return_to_sender(cap);

    scenario.end();
}

// === Fee cap ===

#[test]
fun test_set_fee_within_cap_including_boundary() {
    let scenario = setup();
    let mut config = scenario.take_shared<ProtocolConfig>();
    let cap = scenario.take_from_sender<AdminCap>();

    protocol::admin_set_fee_bps(&mut config, &cap, 0);
    assert!(protocol::protocol_fee_bps(&config) == 0);

    // Boundary: exactly the 10% hard cap is legal.
    protocol::admin_set_fee_bps(&mut config, &cap, 1_000);
    assert!(protocol::protocol_fee_bps(&config) == 1_000);

    ts::return_shared(config);
    scenario.return_to_sender(cap);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = protocol::EFeeExceedsCap)]
fun test_set_fee_exceeds_cap_aborts() {
    let scenario = setup();
    let mut config = scenario.take_shared<ProtocolConfig>();
    let cap = scenario.take_from_sender<AdminCap>();

    protocol::admin_set_fee_bps(&mut config, &cap, 1_001);

    abort 0
}

// === Jury threshold bounds ===

#[test]
fun test_jury_threshold_boundaries_ok() {
    let scenario = setup();
    let mut config = scenario.take_shared<ProtocolConfig>();
    let cap = scenario.take_from_sender<AdminCap>();

    // Lower boundary: 5_001 (strict majority) is legal.
    set_dispute_params_with_threshold(&mut config, &cap, 5_001);
    assert!(protocol::jury_threshold_bps(&config) == 5_001);

    // Upper boundary: 10_000 (unanimity) is legal.
    set_dispute_params_with_threshold(&mut config, &cap, 10_000);
    assert!(protocol::jury_threshold_bps(&config) == 10_000);

    ts::return_shared(config);
    scenario.return_to_sender(cap);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = protocol::EInvalidBps)]
fun test_jury_threshold_simple_majority_aborts() {
    let scenario = setup();
    let mut config = scenario.take_shared<ProtocolConfig>();
    let cap = scenario.take_from_sender<AdminCap>();

    // 50.00% exactly is not a strict majority.
    set_dispute_params_with_threshold(&mut config, &cap, 5_000);

    abort 0
}

#[test]
#[expected_failure(abort_code = protocol::EInvalidBps)]
fun test_jury_threshold_above_unanimity_aborts() {
    let scenario = setup();
    let mut config = scenario.take_shared<ProtocolConfig>();
    let cap = scenario.take_from_sender<AdminCap>();

    set_dispute_params_with_threshold(&mut config, &cap, 10_001);

    abort 0
}

// === Bounty cap ===

#[test]
#[expected_failure(abort_code = protocol::EInvalidBps)]
fun test_bounty_above_cap_aborts() {
    let scenario = setup();
    let mut config = scenario.take_shared<ProtocolConfig>();
    let cap = scenario.take_from_sender<AdminCap>();

    protocol::admin_set_dispute_params(
        &mut config,
        &cap,
        1_000_000_000,
        3,
        6_667,
        10_000_000_000,
        5_001, // above the 50% bounty cap
        604_800_000,
        604_800_000,
    );

    abort 0
}

// === Zero-value rejections ===

#[test]
#[expected_failure(abort_code = protocol::EZeroAmount)]
fun test_zero_min_validator_stake_aborts() {
    let scenario = setup();
    let mut config = scenario.take_shared<ProtocolConfig>();
    let cap = scenario.take_from_sender<AdminCap>();

    protocol::admin_set_min_validator_stake(&mut config, &cap, 0);

    abort 0
}

#[test]
#[expected_failure(abort_code = protocol::EZeroAmount)]
fun test_zero_jury_quorum_aborts() {
    let scenario = setup();
    let mut config = scenario.take_shared<ProtocolConfig>();
    let cap = scenario.take_from_sender<AdminCap>();

    protocol::admin_set_dispute_params(
        &mut config,
        &cap,
        1_000_000_000,
        0, // zero quorum
        6_667,
        10_000_000_000,
        1_000,
        604_800_000,
        604_800_000,
    );

    abort 0
}

#[test]
#[expected_failure(abort_code = protocol::EInvalidBps)]
fun test_vouch_coverage_above_100_percent_aborts() {
    let scenario = setup();
    let mut config = scenario.take_shared<ProtocolConfig>();
    let cap = scenario.take_from_sender<AdminCap>();

    protocol::admin_set_vouch_coverage_bps(&mut config, &cap, 10_001);

    abort 0
}

// === Treasury ===

#[test]
fun test_set_treasury_changes_destination() {
    let scenario = setup();
    let mut config = scenario.take_shared<ProtocolConfig>();
    let cap = scenario.take_from_sender<AdminCap>();

    protocol::admin_set_treasury(&mut config, &cap, NEW_TREASURY);
    assert!(protocol::treasury(&config) == NEW_TREASURY);

    ts::return_shared(config);
    scenario.return_to_sender(cap);
    scenario.end();
}

// === Pause / resume ===

#[test]
fun test_pause_resume_cycle_and_guard() {
    let scenario = setup();
    let mut config = scenario.take_shared<ProtocolConfig>();
    let cap = scenario.take_from_sender<AdminCap>();

    // Guard passes while live.
    protocol::assert_not_paused(&config);

    protocol::admin_emergency_stop(&mut config, &cap);
    assert!(protocol::is_paused(&config));

    protocol::admin_resume(&mut config, &cap);
    assert!(!protocol::is_paused(&config));

    // Guard passes again after resume.
    protocol::assert_not_paused(&config);

    ts::return_shared(config);
    scenario.return_to_sender(cap);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = protocol::EPaused)]
fun test_guard_aborts_when_paused() {
    let scenario = setup();
    let mut config = scenario.take_shared<ProtocolConfig>();
    let cap = scenario.take_from_sender<AdminCap>();

    protocol::admin_emergency_stop(&mut config, &cap);
    protocol::assert_not_paused(&config);

    abort 0
}

// === Version kill-switch ===

#[test]
fun test_version_guard_passes_on_current_version() {
    let scenario = setup();
    let config = scenario.take_shared<ProtocolConfig>();

    protocol::assert_version(&config);

    ts::return_shared(config);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = protocol::EVersionMismatch)]
fun test_version_mismatch_bricks_setters() {
    let scenario = setup();
    let mut config = scenario.take_shared<ProtocolConfig>();
    let cap = scenario.take_from_sender<AdminCap>();

    protocol::set_version_for_testing(&mut config, 2);
    protocol::admin_set_fee_bps(&mut config, &cap, 50);

    abort 0
}

// === Event emission ===

#[test]
fun test_param_change_emits_one_event() {
    let mut scenario = setup();
    let mut config = scenario.take_shared<ProtocolConfig>();
    let cap = scenario.take_from_sender<AdminCap>();

    protocol::admin_set_fee_bps(&mut config, &cap, 200);

    ts::return_shared(config);
    scenario.return_to_sender(cap);

    // The setter transaction emitted exactly one ProtocolParamChangedEvent.
    let effects = scenario.next_tx(ADMIN);
    assert!(effects.num_user_events() == 1);

    scenario.end();
}

#[test]
fun test_dispute_params_emit_seven_events() {
    let mut scenario = setup();
    let mut config = scenario.take_shared<ProtocolConfig>();
    let cap = scenario.take_from_sender<AdminCap>();

    protocol::admin_set_dispute_params(
        &mut config,
        &cap,
        2_000_000_000,
        5,
        7_500,
        20_000_000_000,
        2_000,
        1_209_600_000,
        1_209_600_000,
    );

    ts::return_shared(config);
    scenario.return_to_sender(cap);

    // One audit event per dispute parameter (7 parameters).
    let effects = scenario.next_tx(ADMIN);
    assert!(effects.num_user_events() == 7);

    scenario.end();
}

// === Helpers (private) ===

/// Valid dispute params except the jury threshold under test.
fun set_dispute_params_with_threshold(
    config: &mut ProtocolConfig,
    cap: &AdminCap,
    threshold_bps: u64,
) {
    protocol::admin_set_dispute_params(
        config,
        cap,
        1_000_000_000,
        3,
        threshold_bps,
        10_000_000_000,
        1_000,
        604_800_000,
        604_800_000,
    );
}
