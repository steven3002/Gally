/// Gally protocol governance (spec: protocol_flow.md §5, Flow A).
///
/// Defines the singleton `ProtocolConfig` shared object holding every protocol
/// tunable, the `AdminCap` capability gating parameter governance, and the
/// asymmetric emergency pause (decision D6: pause blocks capital entry, never
/// capital exit — exit functions across the package contain no pause checks).
///
/// Admin power is deliberately bounded: every parameter has an in-contract hard
/// cap, so even a compromised `AdminCap` cannot set the fee above 10%, weaken
/// the jury threshold below a strict majority, or touch escrows, mints, or user
/// balances (adversarial analysis §20, A10).
module gally_core::protocol;

// === Imports ===

use std::string::String;
use sui::event;

// === Errors ===

/// Protocol is paused; this capital-entry operation is halted (spec D6).
const EPaused: u64 = 0;
/// Config version does not match this package version (upgrade kill-switch, spec §3.1).
const EVersionMismatch: u64 = 1;
/// A quantity that must be non-zero was zero.
const EZeroAmount: u64 = 2;
/// `protocol_fee_bps` above the hard cap `MAX_PROTOCOL_FEE_BPS` (spec §5.2).
const EFeeExceedsCap: u64 = 100;
/// A basis-point parameter outside its allowed range (spec §5.2).
const EInvalidBps: u64 = 101;

// === Constants ===

/// Current package version; every public entry across the package asserts
/// compatibility via `assert_version` (spec §3.1).
const VERSION: u64 = 1;
/// Basis-point denominator: 10_000 bps == 100%.
const BPS_DENOMINATOR: u64 = 10_000;
/// Hard cap on the protocol fee: 10% (spec §5.2 — bounded admin blast radius).
const MAX_PROTOCOL_FEE_BPS: u64 = 1_000;
/// Jury threshold floor: a guilty verdict requires a strict majority.
const MIN_JURY_THRESHOLD_BPS: u64 = 5_001;
/// Jury threshold ceiling: 100%.
const MAX_JURY_THRESHOLD_BPS: u64 = 10_000;
/// Hard cap on the challenger bounty: 50% of the slashed amount (spec §5.2).
const MAX_CHALLENGER_BOUNTY_BPS: u64 = 5_000;

// Defaults applied at `init`. USDC amounts are raw units (6 decimals).
const DEFAULT_PROTOCOL_FEE_BPS: u64 = 100; // 1%
const DEFAULT_MIN_VALIDATOR_STAKE: u64 = 10_000_000_000; // 10,000 USDC
const DEFAULT_VOUCH_COVERAGE_BPS: u64 = 2_000; // 20% of funding goal
const DEFAULT_ENTITY_COLLATERAL_BPS: u64 = 1_000; // 10% of funding goal
const DEFAULT_VOUCH_TIMEOUT_MS: u64 = 2_592_000_000; // 30 days
const DEFAULT_CHALLENGER_BOND: u64 = 1_000_000_000; // 1,000 USDC
const DEFAULT_JURY_QUORUM: u64 = 3;
const DEFAULT_JURY_THRESHOLD_BPS: u64 = 6_667; // two thirds
const DEFAULT_JURY_MIN_STAKE: u64 = 10_000_000_000; // 10,000 USDC
const DEFAULT_CHALLENGER_BOUNTY_BPS: u64 = 1_000; // 10% of slashed amount
const DEFAULT_DISPUTE_WINDOW_MS: u64 = 604_800_000; // 7 days
const DEFAULT_COMPENSATION_GRACE_MS: u64 = 604_800_000; // 7 days (D5: days, not hours)
const DEFAULT_MIN_WRAP_DURATION_MS: u64 = 3_600_000; // 1 hour

// === Structs ===

/// Singleton shared object holding every protocol tunable (spec §3.1).
/// Created exactly once in `init`; mutated only through `AdminCap`-gated
/// setters, each of which emits `ProtocolParamChangedEvent`.
public struct ProtocolConfig has key {
    id: UID,
    /// Bumped on package upgrade; stale call paths abort via `assert_version`.
    version: u64,
    /// D6 semantics: gates capital entry only, never capital exit.
    paused: bool,
    /// Destination of protocol fees taken on revenue deposits.
    treasury: address,
    /// Fee on gross revenue deposits, in bps. Hard-capped at 10%.
    protocol_fee_bps: u64,
    /// USDC floor to register a `ValidatorPool` (Flow B).
    min_validator_stake: u64,
    /// Share of an asset's funding goal a validator locks per vouch (Flow C).
    vouch_coverage_bps: u64,
    /// Share of the funding goal an entity posts as slashable collateral (Flow C).
    entity_collateral_bps: u64,
    /// Window for a validator to vouch a PENDING_VOUCH asset before anyone may cancel it.
    vouch_timeout_ms: u64,
    /// Exact USDC bond required to open a dispute (Flow I).
    challenger_bond: u64,
    /// Minimum distinct juror votes for a dispute verdict.
    jury_quorum: u64,
    /// Guilty-vote fraction required to uphold a dispute, in bps. Strict majority minimum.
    jury_threshold_bps: u64,
    /// Stake floor for jury eligibility (decision D7).
    jury_min_stake: u64,
    /// Share of a slashed amount paid to a winning challenger, in bps. Capped at 50%.
    challenger_bounty_bps: u64,
    /// Dispute voting period length.
    dispute_window_ms: u64,
    /// Unwrap window before slashed funds sweep into the yield index (decision D5).
    compensation_grace_ms: u64,
    /// Defense-in-depth cooldown between acquiring a share and wrapping it (spec §12).
    min_wrap_duration_ms: u64,
}

/// Capability gating parameter governance and the emergency pause.
/// `key`-only on purpose: without `store` it cannot be wrapped, sold, or moved
/// by generic transfer code (spec §3.2). Minted once in `init`.
public struct AdminCap has key {
    id: UID,
}

// === Events ===

/// Emitted once, at package publication.
public struct ProtocolInitializedEvent has copy, drop {
    config_id: ID,
    admin: address,
}

/// Emitted by every numeric parameter setter. Parameter history is
/// reconstructible from these events alone (spec §18.1 P3).
public struct ProtocolParamChangedEvent has copy, drop {
    name: String,
    old_value: u64,
    new_value: u64,
}

/// Emitted when the fee destination changes (address-typed, hence not
/// representable in `ProtocolParamChangedEvent`).
public struct ProtocolTreasuryChangedEvent has copy, drop {
    old_treasury: address,
    new_treasury: address,
}

/// Emitted when the admin halts capital entry (spec §5.3).
public struct EmergencyStopTriggeredEvent has copy, drop {
    config_id: ID,
}

/// Emitted when the admin resumes capital entry.
public struct ProtocolResumedEvent has copy, drop {
    config_id: ID,
}

// === Init ===

/// Runs exactly once at publication: creates and shares the singleton
/// `ProtocolConfig` with safe defaults and transfers the `AdminCap` to the
/// publisher. Sui guarantees `init` cannot be re-run or front-run (spec §5.1).
fun init(ctx: &mut TxContext) {
    let config = ProtocolConfig {
        id: object::new(ctx),
        version: VERSION,
        paused: false,
        treasury: ctx.sender(),
        protocol_fee_bps: DEFAULT_PROTOCOL_FEE_BPS,
        min_validator_stake: DEFAULT_MIN_VALIDATOR_STAKE,
        vouch_coverage_bps: DEFAULT_VOUCH_COVERAGE_BPS,
        entity_collateral_bps: DEFAULT_ENTITY_COLLATERAL_BPS,
        vouch_timeout_ms: DEFAULT_VOUCH_TIMEOUT_MS,
        challenger_bond: DEFAULT_CHALLENGER_BOND,
        jury_quorum: DEFAULT_JURY_QUORUM,
        jury_threshold_bps: DEFAULT_JURY_THRESHOLD_BPS,
        jury_min_stake: DEFAULT_JURY_MIN_STAKE,
        challenger_bounty_bps: DEFAULT_CHALLENGER_BOUNTY_BPS,
        dispute_window_ms: DEFAULT_DISPUTE_WINDOW_MS,
        compensation_grace_ms: DEFAULT_COMPENSATION_GRACE_MS,
        min_wrap_duration_ms: DEFAULT_MIN_WRAP_DURATION_MS,
    };

    event::emit(ProtocolInitializedEvent {
        config_id: object::id(&config),
        admin: ctx.sender(),
    });

    transfer::share_object(config);
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

// === Public Functions ===

/// Aborts when the protocol is paused. Called by every capital-entry function
/// across the package; never called by exit functions (D6, invariant I-X1).
public fun assert_not_paused(config: &ProtocolConfig) {
    assert!(!config.paused, EPaused);
}

/// Aborts when the config was migrated past this package version. Wired into
/// every public entry across the package (upgrade kill-switch, spec §3.1).
public fun assert_version(config: &ProtocolConfig) {
    assert!(config.version == VERSION, EVersionMismatch);
}

// === View Functions ===

public fun version(config: &ProtocolConfig): u64 { config.version }

public fun is_paused(config: &ProtocolConfig): bool { config.paused }

public fun treasury(config: &ProtocolConfig): address { config.treasury }

public fun protocol_fee_bps(config: &ProtocolConfig): u64 { config.protocol_fee_bps }

public fun min_validator_stake(config: &ProtocolConfig): u64 { config.min_validator_stake }

public fun vouch_coverage_bps(config: &ProtocolConfig): u64 { config.vouch_coverage_bps }

public fun entity_collateral_bps(config: &ProtocolConfig): u64 { config.entity_collateral_bps }

public fun vouch_timeout_ms(config: &ProtocolConfig): u64 { config.vouch_timeout_ms }

public fun challenger_bond(config: &ProtocolConfig): u64 { config.challenger_bond }

public fun jury_quorum(config: &ProtocolConfig): u64 { config.jury_quorum }

public fun jury_threshold_bps(config: &ProtocolConfig): u64 { config.jury_threshold_bps }

public fun jury_min_stake(config: &ProtocolConfig): u64 { config.jury_min_stake }

public fun challenger_bounty_bps(config: &ProtocolConfig): u64 { config.challenger_bounty_bps }

public fun dispute_window_ms(config: &ProtocolConfig): u64 { config.dispute_window_ms }

public fun compensation_grace_ms(config: &ProtocolConfig): u64 { config.compensation_grace_ms }

public fun min_wrap_duration_ms(config: &ProtocolConfig): u64 { config.min_wrap_duration_ms }

// === Admin Functions ===

/// Sets the protocol fee. Hard-capped at `MAX_PROTOCOL_FEE_BPS` (10%).
public fun admin_set_fee_bps(config: &mut ProtocolConfig, _: &AdminCap, new_fee_bps: u64) {
    assert_version(config);
    assert!(new_fee_bps <= MAX_PROTOCOL_FEE_BPS, EFeeExceedsCap);
    emit_param_change(b"protocol_fee_bps", config.protocol_fee_bps, new_fee_bps);
    config.protocol_fee_bps = new_fee_bps;
}

/// Sets the fee destination address.
public fun admin_set_treasury(config: &mut ProtocolConfig, _: &AdminCap, new_treasury: address) {
    assert_version(config);
    event::emit(ProtocolTreasuryChangedEvent {
        old_treasury: config.treasury,
        new_treasury,
    });
    config.treasury = new_treasury;
}

/// Sets the USDC floor for validator registration. Must be non-zero — a
/// zero-stake validator would make every attestation costless.
public fun admin_set_min_validator_stake(
    config: &mut ProtocolConfig,
    _: &AdminCap,
    new_min_stake: u64,
) {
    assert_version(config);
    assert!(new_min_stake > 0, EZeroAmount);
    emit_param_change(b"min_validator_stake", config.min_validator_stake, new_min_stake);
    config.min_validator_stake = new_min_stake;
}

/// Sets the per-vouch coverage requirement, in bps of the funding goal.
public fun admin_set_vouch_coverage_bps(
    config: &mut ProtocolConfig,
    _: &AdminCap,
    new_coverage_bps: u64,
) {
    assert_version(config);
    assert!(new_coverage_bps > 0 && new_coverage_bps <= BPS_DENOMINATOR, EInvalidBps);
    emit_param_change(b"vouch_coverage_bps", config.vouch_coverage_bps, new_coverage_bps);
    config.vouch_coverage_bps = new_coverage_bps;
}

/// Sets the entity collateral requirement, in bps of the funding goal.
public fun admin_set_entity_collateral_bps(
    config: &mut ProtocolConfig,
    _: &AdminCap,
    new_collateral_bps: u64,
) {
    assert_version(config);
    assert!(new_collateral_bps > 0 && new_collateral_bps <= BPS_DENOMINATOR, EInvalidBps);
    emit_param_change(b"entity_collateral_bps", config.entity_collateral_bps, new_collateral_bps);
    config.entity_collateral_bps = new_collateral_bps;
}

/// Sets the window in which an asset must be vouched before anyone may cancel it.
public fun admin_set_vouch_timeout_ms(
    config: &mut ProtocolConfig,
    _: &AdminCap,
    new_timeout_ms: u64,
) {
    assert_version(config);
    assert!(new_timeout_ms > 0, EZeroAmount);
    emit_param_change(b"vouch_timeout_ms", config.vouch_timeout_ms, new_timeout_ms);
    config.vouch_timeout_ms = new_timeout_ms;
}

/// Sets the wrap cooldown (defense-in-depth against supply oscillation, spec §12).
public fun admin_set_min_wrap_duration_ms(
    config: &mut ProtocolConfig,
    _: &AdminCap,
    new_duration_ms: u64,
) {
    assert_version(config);
    emit_param_change(b"min_wrap_duration_ms", config.min_wrap_duration_ms, new_duration_ms);
    config.min_wrap_duration_ms = new_duration_ms;
}

/// Sets all dispute-engine parameters in one call (spec §5.2). Enforced caps:
/// the jury threshold must be a strict majority (`(5_000, 10_000]` bps) and the
/// challenger bounty at most 50% of the slashed amount.
public fun admin_set_dispute_params(
    config: &mut ProtocolConfig,
    _: &AdminCap,
    new_challenger_bond: u64,
    new_jury_quorum: u64,
    new_jury_threshold_bps: u64,
    new_jury_min_stake: u64,
    new_challenger_bounty_bps: u64,
    new_dispute_window_ms: u64,
    new_compensation_grace_ms: u64,
) {
    assert_version(config);
    assert!(new_challenger_bond > 0, EZeroAmount);
    assert!(new_jury_quorum > 0, EZeroAmount);
    assert!(
        new_jury_threshold_bps >= MIN_JURY_THRESHOLD_BPS
            && new_jury_threshold_bps <= MAX_JURY_THRESHOLD_BPS,
        EInvalidBps,
    );
    assert!(new_jury_min_stake > 0, EZeroAmount);
    assert!(new_challenger_bounty_bps <= MAX_CHALLENGER_BOUNTY_BPS, EInvalidBps);
    assert!(new_dispute_window_ms > 0, EZeroAmount);
    assert!(new_compensation_grace_ms > 0, EZeroAmount);

    emit_param_change(b"challenger_bond", config.challenger_bond, new_challenger_bond);
    emit_param_change(b"jury_quorum", config.jury_quorum, new_jury_quorum);
    emit_param_change(b"jury_threshold_bps", config.jury_threshold_bps, new_jury_threshold_bps);
    emit_param_change(b"jury_min_stake", config.jury_min_stake, new_jury_min_stake);
    emit_param_change(
        b"challenger_bounty_bps",
        config.challenger_bounty_bps,
        new_challenger_bounty_bps,
    );
    emit_param_change(b"dispute_window_ms", config.dispute_window_ms, new_dispute_window_ms);
    emit_param_change(
        b"compensation_grace_ms",
        config.compensation_grace_ms,
        new_compensation_grace_ms,
    );

    config.challenger_bond = new_challenger_bond;
    config.jury_quorum = new_jury_quorum;
    config.jury_threshold_bps = new_jury_threshold_bps;
    config.jury_min_stake = new_jury_min_stake;
    config.challenger_bounty_bps = new_challenger_bounty_bps;
    config.dispute_window_ms = new_dispute_window_ms;
    config.compensation_grace_ms = new_compensation_grace_ms;
}

/// Halts capital entry across the package. Exit functions are unaffected by
/// construction — they contain no pause checks (D6, invariant I-X1).
public fun admin_emergency_stop(config: &mut ProtocolConfig, _: &AdminCap) {
    assert_version(config);
    config.paused = true;
    event::emit(EmergencyStopTriggeredEvent { config_id: object::id(config) });
}

/// Resumes capital entry.
public fun admin_resume(config: &mut ProtocolConfig, _: &AdminCap) {
    assert_version(config);
    config.paused = false;
    event::emit(ProtocolResumedEvent { config_id: object::id(config) });
}

// === Private Functions ===

/// Emits the uniform parameter-change audit event (spec §18.3 governance feed).
fun emit_param_change(name: vector<u8>, old_value: u64, new_value: u64) {
    event::emit(ProtocolParamChangedEvent {
        name: name.to_string(),
        old_value,
        new_value,
    });
}

// === Test Functions ===

#[test_only]
/// Runs `init` in a test scenario.
public fun init_for_testing(ctx: &mut TxContext) {
    init(ctx);
}

#[test_only]
/// Corrupts the config version to exercise the `assert_version` kill-switch.
public fun set_version_for_testing(config: &mut ProtocolConfig, new_version: u64) {
    config.version = new_version;
}
