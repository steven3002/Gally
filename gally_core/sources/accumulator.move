/// Global yield accumulator — M3 stub (spec: protocol_flow.md §3.9).
///
/// This milestone delivers the object shape, its creation at finalize, and
/// the compensation-pool intake used by `flag_default`. The math engine
/// (deposit / claim / rollover, Flow F–G) lands in M4; the wrap machine
/// (Flow H) in M5.
///
/// The load-bearing property established here: the `TreasuryCap<T>` is
/// swallowed at creation and no function ever returns it. Nothing — not the
/// entity, not the admin — can mint `Coin<T>` outside the M5 wrap path,
/// which is what makes supply parity (I-W1) provable.
module gally_core::accumulator;

// === Imports ===

use gally_core::usdc::USDC;
use sui::balance::{Self, Balance};
use sui::coin::{Self, TreasuryCap};

// === Errors ===

/// The handed-over `TreasuryCap` had prior supply; pre-minted `Coin<T>`
/// would break supply parity (I-W1) forever (spec §8).
const ECapNotVirgin: u64 = 306;
/// The accumulator does not belong to the asset in this call (spec §19).
const EAccumulatorMismatch: u64 = 310;

// === Structs ===

/// One per funded asset, generic over that asset's token witness `T`
/// (spec §3.9). Shared: deposits, claims, wraps, and sweeps all touch it
/// concurrently. The three USDC pools are deliberately separate balances so
/// every unit in the object is attributable to exactly one liability class.
public struct GlobalYieldAccumulator<phantom T> has key {
    id: UID,
    asset_id: ID,
    /// Lifetime investor revenue per unwrapped share, scaled by 1e9 (§15).
    /// Monotonically non-decreasing (I-M1). Moves only in M4+ code.
    cumulative_yield_index: u128,
    /// Constant after finalize (== funding goal) until M7 redemptions.
    total_minted_shares: u64,
    /// Currently circulating as `Coin<T>` (M5). Invariant I-W2: <= total_minted_shares.
    total_wrapped_shares: u64,
    /// Backs all unclaimed yield entitlements (I-M2).
    reward_pool: Balance<USDC>,
    /// Revenue received while unwrapped supply was zero (§10).
    rollover_reserve: Balance<USDC>,
    /// Slashed / seized principal-restitution funds awaiting the grace-window
    /// sweep (decision D5).
    compensation_pool: Balance<USDC>,
    /// When the compensation grace window ends and `sweep_compensation` (M6)
    /// becomes callable.
    compensation_unlock_ms: u64,
    /// True during a compensation grace window: wrapping halts, unwrapping
    /// stays open (D5).
    wrapping_frozen: bool,
    /// Sole mint/burn authority for `Coin<T>`. Custodied here forever.
    treasury_cap: TreasuryCap<T>,
}

// === View Functions ===

public fun asset_id<T>(acc: &GlobalYieldAccumulator<T>): ID { acc.asset_id }

public fun cumulative_yield_index<T>(acc: &GlobalYieldAccumulator<T>): u128 {
    acc.cumulative_yield_index
}

public fun total_minted_shares<T>(acc: &GlobalYieldAccumulator<T>): u64 {
    acc.total_minted_shares
}

public fun total_wrapped_shares<T>(acc: &GlobalYieldAccumulator<T>): u64 {
    acc.total_wrapped_shares
}

public fun reward_pool_value<T>(acc: &GlobalYieldAccumulator<T>): u64 {
    acc.reward_pool.value()
}

public fun rollover_reserve_value<T>(acc: &GlobalYieldAccumulator<T>): u64 {
    acc.rollover_reserve.value()
}

public fun compensation_pool_value<T>(acc: &GlobalYieldAccumulator<T>): u64 {
    acc.compensation_pool.value()
}

public fun compensation_unlock_ms<T>(acc: &GlobalYieldAccumulator<T>): u64 {
    acc.compensation_unlock_ms
}

public fun is_wrapping_frozen<T>(acc: &GlobalYieldAccumulator<T>): bool {
    acc.wrapping_frozen
}

/// Aborts unless `acc` is the accumulator of `asset_id`. Sibling modules call
/// this before any cross-object operation.
public fun assert_asset<T>(acc: &GlobalYieldAccumulator<T>, asset_id: ID) {
    assert!(acc.asset_id == asset_id, EAccumulatorMismatch);
}

// === Package Functions ===

/// Creates and shares the accumulator at `finalize_successful_raise` (Flow D),
/// swallowing the entity's virgin `TreasuryCap<T>` permanently. Returns the
/// new object's ID for the asset to record.
public(package) fun new_accumulator<T>(
    asset_id: ID,
    total_minted_shares: u64,
    treasury_cap: TreasuryCap<T>,
    ctx: &mut TxContext,
): ID {
    assert!(coin::total_supply(&treasury_cap) == 0, ECapNotVirgin);

    let acc = GlobalYieldAccumulator<T> {
        id: object::new(ctx),
        asset_id,
        cumulative_yield_index: 0,
        total_minted_shares,
        total_wrapped_shares: 0,
        reward_pool: balance::zero(),
        rollover_reserve: balance::zero(),
        compensation_pool: balance::zero(),
        compensation_unlock_ms: 0,
        wrapping_frozen: false,
        treasury_cap,
    };
    let acc_id = object::id(&acc);
    transfer::share_object(acc);
    acc_id
}

/// Receives seized or slashed funds (default Flow J, dispute Flow I) and
/// opens/extends the compensation grace window: wrapping freezes so wrapped
/// holders can return before the M6 sweep distributes (decision D5).
public(package) fun add_to_compensation_pool<T>(
    acc: &mut GlobalYieldAccumulator<T>,
    funds: Balance<USDC>,
    unlock_ms: u64,
) {
    acc.compensation_pool.join(funds);
    acc.wrapping_frozen = true;
    if (unlock_ms > acc.compensation_unlock_ms) {
        acc.compensation_unlock_ms = unlock_ms;
    };
}
