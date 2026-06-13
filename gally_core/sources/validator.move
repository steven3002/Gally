/// Validator stake infrastructure (spec: protocol_flow.md §6, Flow B).
///
/// Validators lock USDC collateral in per-validator shared pools; every later
/// attestation (vouch, milestone approval, jury vote) is only as credible as
/// the stake still present. `withdraw_stake` is therefore the most
/// security-sensitive function in this module: its three-way floor (locked
/// coverage, conditional registration minimum, ACTIVE status) is the entire
/// enforcement mechanism of the legal-oracle design (spec §6, attack A3).
///
/// Status transitions (`freeze` / `unfreeze` / `slash`) and coverage
/// accounting (`lock_coverage` / `release_coverage`) are `public(package)`:
/// only the vouching flow (M3) and the dispute court (M6) may drive them —
/// nothing outside this package can freeze or slash a validator.
module gally_core::validator;

// === Imports ===

use gally_core::protocol::{Self, ProtocolConfig};
use gally_core::usdc::USDC;
use sui::balance::Balance;
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;

// === Errors ===

/// Registration stake below `ProtocolConfig.min_validator_stake`.
const EStakeBelowMin: u64 = 200;
/// Operation would breach the locked-coverage or registration-minimum floor (I-V1).
const EInsufficientFreeStake: u64 = 201;
/// Pool is not ACTIVE; frozen/slashed validators cannot operate (I-V3).
const EValidatorNotActive: u64 = 202;
/// `ValidatorCap.pool_id` does not match the pool being operated on.
const EWrongValidatorCap: u64 = 203;
/// Operation requires a FROZEN pool (slash and unfreeze preconditions).
const EValidatorNotFrozen: u64 = 204;

// === Constants ===

/// Pool may vouch, approve milestones, vote, and withdraw free stake.
const STATUS_ACTIVE: u8 = 0;
/// Under dispute: all attestation powers and withdrawals halt (spec §13).
const STATUS_FROZEN: u8 = 1;
/// Terminal. A slashed identity is dead; re-entry requires a fresh pool (spec §13).
const STATUS_SLASHED: u8 = 2;

// === Structs ===

/// Per-validator collateral pool (spec §3.3). Shared, because third parties
/// interact with it without the validator's cooperation: disputes slash it,
/// jury checks read it, anyone may top it up.
public struct ValidatorPool has key {
    id: UID,
    /// Operator address (informational; authority comes from `ValidatorCap`).
    validator: address,
    /// Total deposited collateral.
    stake: Balance<USDC>,
    /// Portion committed against active vouches. Invariant I-V1: locked <= value(stake).
    locked: u64,
    /// Count of assets this pool currently vouches (I-V2).
    active_vouches: u64,
    /// STATUS_ACTIVE | STATUS_FROZEN | STATUS_SLASHED.
    status: u8,
    registered_at_ms: u64,
}

/// Authenticates the pool operator (spec §3.4). `key`-only on purpose: a
/// validator identity must not be sellable while stake-backed attestations
/// are live.
public struct ValidatorCap has key {
    id: UID,
    pool_id: ID,
}

// === Events ===

/// Emitted once per pool, at registration.
public struct ValidatorRegisteredEvent has copy, drop {
    pool_id: ID,
    validator: address,
    stake: u64,
}

/// Emitted on every top-up. `depositor` may differ from the validator —
/// top-ups are permissionless (spec §6).
public struct StakeAddedEvent has copy, drop {
    pool_id: ID,
    depositor: address,
    amount: u64,
    stake_after: u64,
}

/// Emitted on every withdrawal of free stake.
public struct StakeWithdrawnEvent has copy, drop {
    pool_id: ID,
    validator: address,
    amount: u64,
    stake_after: u64,
}

/// Single place to track a pool's status history (spec §18.3). `dispute_id`
/// is populated when the transition was driven by the dispute court (M6).
public struct ValidatorStatusChangedEvent has copy, drop {
    pool_id: ID,
    old_status: u8,
    new_status: u8,
    dispute_id: Option<ID>,
}

// === Public Functions ===

/// Registers the sender as a validator: locks `stake` into a new shared pool
/// and transfers the `ValidatorCap` to the sender (soulbound carve-out,
/// spec §23.3 — a `key`-only cap cannot be returned through PTB transfers).
/// Pause-gated: registration is capital entry (spec §17).
public fun register_validator(
    config: &ProtocolConfig,
    stake: Coin<USDC>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    protocol::assert_version(config);
    protocol::assert_not_paused(config);
    assert!(stake.value() >= protocol::min_validator_stake(config), EStakeBelowMin);

    let pool = ValidatorPool {
        id: object::new(ctx),
        validator: ctx.sender(),
        stake: stake.into_balance(),
        locked: 0,
        active_vouches: 0,
        status: STATUS_ACTIVE,
        registered_at_ms: clock.timestamp_ms(),
    };
    let pool_id = object::id(&pool);

    event::emit(ValidatorRegisteredEvent {
        pool_id,
        validator: ctx.sender(),
        stake: pool.stake.value(),
    });

    transfer::transfer(ValidatorCap { id: object::new(ctx), pool_id }, ctx.sender());
    transfer::share_object(pool);
}

/// Permissionless top-up: anyone may add to a pool's safety margin; only the
/// cap holder can ever withdraw. Deliberately guard-free — adding collateral
/// only increases security, so it must work even while paused (spec §17).
public fun add_stake(pool: &mut ValidatorPool, deposit: Coin<USDC>, ctx: &TxContext) {
    let amount = deposit.value();
    pool.stake.join(deposit.into_balance());

    event::emit(StakeAddedEvent {
        pool_id: object::id(pool),
        depositor: ctx.sender(),
        amount,
        stake_after: pool.stake.value(),
    });
}

/// Withdraws free stake. The three-way floor (spec §6) — every attestation
/// this validator ever made is only as good as the stake these asserts keep
/// in the pool:
///   1. status == ACTIVE          — a frozen or slashed validator cannot run for the exit;
///   2. remainder >= locked       — coverage committed to vouches is untouchable (I-V1);
///   3. remainder >= min stake    — while any vouch is live, the registration floor holds.
/// Pure: returns the coin (spec §23.3). Never pause-gated.
public fun withdraw_stake(
    pool: &mut ValidatorPool,
    cap: &ValidatorCap,
    config: &ProtocolConfig,
    amount: u64,
    ctx: &mut TxContext,
): Coin<USDC> {
    protocol::assert_version(config);
    assert_cap(pool, cap);
    assert!(pool.status == STATUS_ACTIVE, EValidatorNotActive);

    let stake_value = pool.stake.value();
    assert!(amount <= stake_value, EInsufficientFreeStake);
    let remainder = stake_value - amount;
    assert!(remainder >= pool.locked, EInsufficientFreeStake);
    if (pool.active_vouches > 0) {
        assert!(remainder >= protocol::min_validator_stake(config), EInsufficientFreeStake);
    };

    event::emit(StakeWithdrawnEvent {
        pool_id: object::id(pool),
        validator: pool.validator,
        amount,
        stake_after: remainder,
    });

    coin::take(&mut pool.stake, amount, ctx)
}

// === View Functions ===

public fun validator(pool: &ValidatorPool): address { pool.validator }

public fun stake_value(pool: &ValidatorPool): u64 { pool.stake.value() }

public fun locked(pool: &ValidatorPool): u64 { pool.locked }

/// Stake not committed to any vouch: the amount available for withdrawal or
/// further coverage.
public fun free_stake(pool: &ValidatorPool): u64 { pool.stake.value() - pool.locked }

public fun active_vouches(pool: &ValidatorPool): u64 { pool.active_vouches }

public fun is_active(pool: &ValidatorPool): bool { pool.status == STATUS_ACTIVE }

public fun is_frozen(pool: &ValidatorPool): bool { pool.status == STATUS_FROZEN }

public fun is_slashed(pool: &ValidatorPool): bool { pool.status == STATUS_SLASHED }

public fun registered_at_ms(pool: &ValidatorPool): u64 { pool.registered_at_ms }

/// Aborts unless `cap` operates `pool`. Exposed for sibling modules (M3/M6)
/// that take a `ValidatorCap` alongside a pool reference.
public fun assert_cap(pool: &ValidatorPool, cap: &ValidatorCap) {
    assert!(cap.pool_id == object::id(pool), EWrongValidatorCap);
}

// === Package Functions ===

/// Commits `amount` of free stake as coverage for one vouch (Flow C).
/// Caller (M3 vouching) computes `amount = goal × vouch_coverage_bps / 10_000`.
public(package) fun lock_coverage(pool: &mut ValidatorPool, amount: u64) {
    assert!(pool.status == STATUS_ACTIVE, EValidatorNotActive);
    assert!(free_stake(pool) >= amount, EInsufficientFreeStake);
    pool.locked = pool.locked + amount;
    pool.active_vouches = pool.active_vouches + 1;
}

/// Releases coverage when a vouch ends without fault (asset operational,
/// cancelled, or raise aborted). Upholds I-V2.
public(package) fun release_coverage(pool: &mut ValidatorPool, amount: u64) {
    assert!(pool.locked >= amount, EInsufficientFreeStake);
    pool.locked = pool.locked - amount;
    pool.active_vouches = pool.active_vouches - 1;
}

/// Halts all of this pool's powers the moment a dispute opens (spec §13).
/// (`freeze` itself is a reserved word in Move, hence the `_pool` suffix.)
public(package) fun freeze_pool(pool: &mut ValidatorPool, dispute_id: Option<ID>) {
    assert!(pool.status == STATUS_ACTIVE, EValidatorNotActive);
    set_status(pool, STATUS_FROZEN, dispute_id);
}

/// Restores a pool after a rejected or expired dispute.
public(package) fun unfreeze_pool(pool: &mut ValidatorPool, dispute_id: Option<ID>) {
    assert!(pool.status == STATUS_FROZEN, EValidatorNotFrozen);
    set_status(pool, STATUS_ACTIVE, dispute_id);
}

/// Liquidates `amount` of the pool's stake after a guilty verdict (Flow I).
/// Only reachable from FROZEN (a dispute must precede every slash) and
/// terminal: a SLASHED pool can never act again. The caller (M6) routes the
/// returned balance: bounty to the challenger, remainder to the impacted
/// asset's compensation pool.
public(package) fun slash(
    pool: &mut ValidatorPool,
    amount: u64,
    dispute_id: Option<ID>,
): Balance<USDC> {
    assert!(pool.status == STATUS_FROZEN, EValidatorNotFrozen);
    assert!(amount <= pool.stake.value(), EInsufficientFreeStake);

    // The slashed vouch is dead; keep I-V1 intact on the remains.
    if (pool.locked >= amount) {
        pool.locked = pool.locked - amount;
    } else {
        pool.locked = 0;
    };

    set_status(pool, STATUS_SLASHED, dispute_id);
    pool.stake.split(amount)
}

// === Test Functions ===

#[test_only]
/// Forges a cap bound to an arbitrary ID, to exercise `EWrongValidatorCap`
/// deterministically (a real foreign cap cannot be constructed outside this
/// module — which is itself the security property under test).
public fun new_cap_for_testing(pool_id: ID, ctx: &mut TxContext): ValidatorCap {
    ValidatorCap { id: object::new(ctx), pool_id }
}

// === Private Functions ===

fun set_status(pool: &mut ValidatorPool, new_status: u8, dispute_id: Option<ID>) {
    let old_status = pool.status;
    pool.status = new_status;
    event::emit(ValidatorStatusChangedEvent {
        pool_id: object::id(pool),
        old_status,
        new_status,
        dispute_id,
    });
}
