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

use gally_core::share::{Self, GallyShare};
use gally_core::usdc::USDC;
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin, TreasuryCap};
use sui::event;

// === Errors ===

/// A quantity that must be non-zero was zero.
const EZeroAmount: u64 = 2;
/// The handed-over `TreasuryCap` had prior supply; pre-minted `Coin<T>`
/// would break supply parity (I-W1) forever (spec §8).
const ECapNotVirgin: u64 = 306;
/// The accumulator does not belong to the asset in this call (spec §19).
const EAccumulatorMismatch: u64 = 310;
/// Share belongs to a different asset than this accumulator.
const EShareAssetMismatch: u64 = 500;
/// Computed payout exceeds u64 — beyond the stated capacity limit (§15.1).
const EPayoutOverflow: u64 = 503;

// === Constants ===

/// Fixed-point scaling factor for all index math (spec §15.1). Every index
/// formula multiplies by SCALE BEFORE dividing; omitting it floors small
/// distributions to zero and strands them as dust.
const SCALE: u128 = 1_000_000_000;

/// Ceiling for a single payout (u64::MAX), asserted explicitly (§15.1).
const MAX_U64: u128 = 18_446_744_073_709_551_615;

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

// === Events ===

/// Stranded revenue rescued through the index (Flow F).
public struct RolloverSweptEvent has copy, drop {
    asset_id: ID,
    amount: u64,
    index_after: u128,
    /// Required for historical APY reconstruction (spec P3).
    unwrapped_supply: u64,
}

/// Per-holder earnings history (Flow G).
public struct YieldClaimedEvent has copy, drop {
    asset_id: ID,
    holder: address,
    amount: u64,
    index_at_claim: u128,
}

// === Public Functions ===

/// Lazy pull claim (Flow G, math §15.3):
///   payout = (global index − personal snapshot) × count / SCALE.
/// Zero payout is a SUCCESSFUL NO-OP, never an abort — PTBs that batch
/// claim-then-act must not fail on a zero day (spec §11). NEVER pause-gated
/// (D6): yield is the holder's money; no admin flag may trap it.
public fun claim_rewards<T>(
    acc: &mut GlobalYieldAccumulator<T>,
    share: &mut GallyShare,
    ctx: &mut TxContext,
): Coin<USDC> {
    assert!(share::asset_id(share) == acc.asset_id, EShareAssetMismatch);

    let payout = pending_payout(acc, share);
    share::set_yield_claimed_index(share, acc.cumulative_yield_index);

    event::emit(YieldClaimedEvent {
        asset_id: acc.asset_id,
        holder: ctx.sender(),
        amount: payout,
        index_at_claim: acc.cumulative_yield_index,
    });

    coin::take(&mut acc.reward_pool, payout, ctx)
}

/// PERMISSIONLESS rescue of revenue parked while the unwrapped supply was
/// zero (Flow F): pushes the reserve through the index exactly as a deposit
/// would. M5's unwrap auto-triggers this so the first unwrapper resurrects
/// stranded revenue without a separate keeper transaction.
public fun sweep_rollover<T>(acc: &mut GlobalYieldAccumulator<T>) {
    assert!(acc.rollover_reserve.value() > 0, EZeroAmount);
    assert!(unwrapped_supply(acc) > 0, EZeroAmount);
    sweep_rollover_internal(acc);
}

/// Merges `victim` into `target` (spec §8.1, v1 rule): force-claim BOTH so
/// their snapshots equal the live index by construction, then sum counts.
/// The combined pending yield comes back as one coin (purity §23.3).
public fun merge_shares<T>(
    acc: &mut GlobalYieldAccumulator<T>,
    target: &mut GallyShare,
    victim: GallyShare,
    ctx: &mut TxContext,
): Coin<USDC> {
    let mut victim = victim;
    let mut claimed = claim_rewards(acc, target, ctx);
    claimed.join(claim_rewards(acc, &mut victim, ctx));

    let (victim_asset, victim_count) = share::burn(victim);
    // Both claims passed the accumulator binding check; the IDs must agree.
    assert!(victim_asset == share::asset_id(target), EShareAssetMismatch);
    let combined_count = share::share_count(target) + victim_count;
    share::set_share_count(target, combined_count);

    claimed
}

// === View Functions ===

/// The yield-earning denominator: shares NOT circulating as Coin<T>.
/// This single subtraction IS the Opportunity Cost Yield Multiplier — as
/// wrapped supply grows, the same revenue divides across fewer shares, and
/// unwrapped holders' effective APY rises with no parameter anywhere (§11).
public fun unwrapped_supply<T>(acc: &GlobalYieldAccumulator<T>): u64 {
    acc.total_minted_shares - acc.total_wrapped_shares
}

/// Yield currently claimable by `share`, without mutating anything.
public fun pending_payout<T>(acc: &GlobalYieldAccumulator<T>, share: &GallyShare): u64 {
    let delta = acc.cumulative_yield_index - share::yield_claimed_index(share);
    let payout = delta * (share::share_count(share) as u128) / SCALE;
    assert!(payout <= MAX_U64, EPayoutOverflow);
    (payout as u64)
}

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

/// Investor-portion intake from `asset::deposit_revenue` (Flow F). Routes
/// through the index, or into the rollover reserve when the unwrapped
/// supply is zero (the Milestone-6-mandated div-by-zero branch). Returns
/// the index after the operation so the caller can emit the deposit event.
public(package) fun add_revenue<T>(
    acc: &mut GlobalYieldAccumulator<T>,
    funds: Balance<USDC>,
): u128 {
    if (unwrapped_supply(acc) == 0) {
        // No division — route to the reserve, rescued by sweep_rollover.
        acc.rollover_reserve.join(funds);
    } else {
        advance_index(acc, funds);
    };
    acc.cumulative_yield_index
}

// === Private Functions ===

/// The index scaler (spec §15.2). u128 throughout; multiply by SCALE before
/// dividing. Truncation dust stays in `reward_pool` — it is the solvency
/// buffer that keeps I-M2 an inequality in the safe direction.
fun advance_index<T>(acc: &mut GlobalYieldAccumulator<T>, funds: Balance<USDC>) {
    let amount = funds.value();
    let delta = (amount as u128) * SCALE / (unwrapped_supply(acc) as u128);
    acc.cumulative_yield_index = acc.cumulative_yield_index + delta; // I-M1: only ever grows
    acc.reward_pool.join(funds);
}

fun sweep_rollover_internal<T>(acc: &mut GlobalYieldAccumulator<T>) {
    let amount = acc.rollover_reserve.value();
    let funds = acc.rollover_reserve.withdraw_all();
    advance_index(acc, funds);

    event::emit(RolloverSweptEvent {
        asset_id: acc.asset_id,
        amount,
        index_after: acc.cumulative_yield_index,
        unwrapped_supply: unwrapped_supply(acc),
    });
}

// === Test Functions ===

#[test_only]
/// Wrapping is M5; tests of the rollover branch and the diamond-hand
/// multiplier fake the wrapped counter directly. Solvency caveat applies:
/// a faked counter does not lock any share object, so only the
/// "still-unwrapped" holders may claim in such tests.
public fun set_total_wrapped_for_testing<T>(acc: &mut GlobalYieldAccumulator<T>, n: u64) {
    acc.total_wrapped_shares = n;
}

#[test_only]
/// Drives the index to extreme values to exercise the overflow guard.
public fun set_index_for_testing<T>(acc: &mut GlobalYieldAccumulator<T>, index: u128) {
    acc.cumulative_yield_index = index;
}
