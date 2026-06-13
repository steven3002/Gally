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

use gally_core::protocol::{Self, AdminCap, ProtocolConfig};
use gally_core::share::{Self, GallyShare};
use gally_core::usdc::USDC;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
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
/// Wrapping halted during a compensation grace window (decision D5).
const EWrappingFrozen: u64 = 501;
/// Share acquired too recently to wrap (defense-in-depth, spec §12).
const EWrapCooldown: u64 = 502;
/// Computed payout exceeds u64 — beyond the stated capacity limit (§15.1).
const EPayoutOverflow: u64 = 503;
/// Compensation grace window has not elapsed yet (decision D5).
const EGraceNotElapsed: u64 = 702;
/// Accumulator not in the terminal CLOSED phase: redemption/dust sweep barred (§14).
const ENotClosed: u64 = 703;
/// Dust sweep attempted while shares are still minted or wrapped (spec §14).
const ESharesOutstanding: u64 = 707;
/// Swept residue exceeds the tracked truncation-dust bound (spec §15.4).
const EDustBoundExceeded: u64 = 708;

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
    /// Set once by `asset::close_*` (mirrors the asset's CLOSED state, §14):
    /// gates `redeem_share` / `admin_sweep_dust` without needing the `Asset`.
    closed: bool,
    /// Σ of every investor portion ever routed in (Flow F). Close trigger (a)
    /// ends a term-financing asset when this reaches the asset's return target.
    lifetime_investor_revenue: u64,
    /// Running UPPER bound on the truncation dust strandable in the pools
    /// (each index advance floors `< unwrapped/SCALE`, each settled claim
    /// `< 1`). `admin_sweep_dust` asserts the reclaimed residue is within it
    /// — a belt-and-braces solvency check at closure (spec §15.4).
    dust_bound: u64,
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

/// Restitution distributed after a grace window (Flow I, decision D5).
public struct CompensationSweptEvent has copy, drop {
    asset_id: ID,
    amount: u64,
    index_after: u128,
    /// Required for historical reconstruction (spec P3).
    unwrapped_supply: u64,
    /// True when no unwrapped supply existed and funds went to rollover.
    routed_to_rollover: bool,
}

/// Wrap-ratio time series (Flow H, spec P3).
public struct SharesWrappedEvent has copy, drop {
    asset_id: ID,
    holder: address,
    count: u64,
    total_wrapped_after: u64,
}

public struct SharesUnwrappedEvent has copy, drop {
    asset_id: ID,
    holder: address,
    count: u64,
    share_object_id: ID,
    total_wrapped_after: u64,
}

/// A deed burned for good at closure (Flow J, §14). `total_minted_after`
/// drives the redemption-progress feed; reaching zero unlocks the dust sweep.
public struct ShareRedeemedEvent has copy, drop {
    asset_id: ID,
    holder: address,
    count: u64,
    total_minted_after: u64,
}

/// Truncation residue reclaimed by the admin after full redemption (§15.4).
public struct DustSweptEvent has copy, drop {
    asset_id: ID,
    amount: u64,
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

    // A nonzero delta floors away < 1 raw unit into the pool; count it toward
    // the closure-time dust bound (§15.4). Zero-delta no-op claims strand
    // nothing, so they must not inflate the bound.
    if (acc.cumulative_yield_index > share::yield_claimed_index(share)) {
        acc.dust_bound = acc.dust_bound + 1;
    };

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

/// PERMISSIONLESS distribution of slashed/seized restitution after the
/// grace window (Flow I, decision D5). The window let wrapped holders
/// unwrap and join the unwrapped denominator; this divides the pool across
/// them through the index exactly like a revenue deposit (SCALE included —
/// omitting it would strand the pool as dust). Fallback: if NObody is
/// unwrapped even now, the funds route to the rollover reserve (rescued by
/// the first unwrap) instead of dividing by zero. Either way wrapping
/// unfreezes. NEVER pause-gated (D6, exit path).
public fun sweep_compensation<T>(acc: &mut GlobalYieldAccumulator<T>, clock: &Clock) {
    assert!(clock.timestamp_ms() >= acc.compensation_unlock_ms, EGraceNotElapsed);
    assert!(acc.compensation_pool.value() > 0, EZeroAmount);

    let amount = acc.compensation_pool.value();
    let funds = acc.compensation_pool.withdraw_all();
    let routed_to_rollover = unwrapped_supply(acc) == 0;
    if (routed_to_rollover) {
        acc.rollover_reserve.join(funds);
    } else {
        advance_index(acc, funds);
    };
    acc.wrapping_frozen = false;

    event::emit(CompensationSweptEvent {
        asset_id: acc.asset_id,
        amount,
        index_after: acc.cumulative_yield_index,
        unwrapped_supply: unwrapped_supply(acc),
        routed_to_rollover,
    });
}

/// Wraps a deed into vanilla `Coin<T>` (Flow H, decision D2: burn-and-
/// remint, not object-locking). Exact order is normative (spec §12):
///   1. guards: pause (capital entry), compensation freeze, cooldown;
///   2. FORCE-CLAIM history — once wrapped the holder is ineligible, so
///      unsettled yield must leave now or strand forever;
///   3. supply counter up, deed destroyed, coin minted 1:1.
/// Returns (wrapped coin, force-claimed yield) per purity §23.3. Supply
/// parity I-W1 is structural: this is the ONLY mint path for Coin<T>, and
/// the cap never leaves the accumulator.
public fun wrap_shares<T>(
    acc: &mut GlobalYieldAccumulator<T>,
    config: &ProtocolConfig,
    share: GallyShare,
    clock: &Clock,
    ctx: &mut TxContext,
): (Coin<T>, Coin<USDC>) {
    protocol::assert_version(config);
    protocol::assert_not_paused(config);
    // Wrapping halts during a compensation grace window AND permanently once
    // the asset is CLOSED — both leave no legitimate reason to enter the
    // wrapped form (spec §14: "deposits and wraps abort" on CLOSED).
    assert!(!acc.wrapping_frozen && !acc.closed, EWrappingFrozen);
    assert!(
        clock.timestamp_ms()
            >= share::acquired_at_ms(&share) + protocol::min_wrap_duration_ms(config),
        EWrapCooldown,
    );

    // Settle history first (also enforces the share↔accumulator binding).
    let mut share = share;
    let claimed = claim_rewards(acc, &mut share, ctx);

    let (_, count) = share::burn(share);
    acc.total_wrapped_shares = acc.total_wrapped_shares + count;

    event::emit(SharesWrappedEvent {
        asset_id: acc.asset_id,
        holder: ctx.sender(),
        count,
        total_wrapped_after: acc.total_wrapped_shares,
    });

    (coin::mint(&mut acc.treasury_cap, count, ctx), claimed)
}

/// Unwraps `Coin<T>` back into a fresh deed (Flow H). Exact order is
/// normative (spec §12, corrected at M5):
///   1. burn the coin, decrement the wrapped counter;
///   2. mint the fresh share at the CURRENT (pre-sweep) index — the
///      anti-retroactive-yield write: every wrapped-period delta is
///      unrepresentable on this snapshot;
///   3. THEN auto-sweep any rollover — the sweep's delta lands on the fresh
///      share ("the first unwrapper shares in stranded revenue"), which is a
///      fresh distribution to an unwrapped holder, not retroactive yield.
/// EXIT PATH: no pause check, no freeze check — unwrapping must work
/// ESPECIALLY during a compensation grace window (D5/D6).
public fun unwrap_coins<T>(
    acc: &mut GlobalYieldAccumulator<T>,
    coin: Coin<T>,
    clock: &Clock,
    ctx: &mut TxContext,
): GallyShare {
    let amount = coin.value();
    assert!(amount > 0, EZeroAmount);

    coin::burn(&mut acc.treasury_cap, coin);
    acc.total_wrapped_shares = acc.total_wrapped_shares - amount;

    let fresh = share::mint(
        acc.asset_id,
        amount,
        acc.cumulative_yield_index,
        clock.timestamp_ms(),
        ctx,
    );

    if (acc.rollover_reserve.value() > 0 && unwrapped_supply(acc) > 0) {
        sweep_rollover_internal(acc);
    };

    event::emit(SharesUnwrappedEvent {
        asset_id: acc.asset_id,
        holder: ctx.sender(),
        count: amount,
        share_object_id: object::id(&fresh),
        total_wrapped_after: acc.total_wrapped_shares,
    });

    fresh
}

/// Merges `victim` into `target` (spec §8.1, v1 rule): force-claim BOTH so
/// their snapshots equal the live index by construction, then sum counts.
/// The combined pending yield comes back as one coin (purity §23.3). The
/// merged share inherits the MORE RECENT `acquired_at_ms` of the two, so a
/// freshly-acquired position cannot launder its wrap cooldown (§12) by
/// merging under an older share (spec §8.1, §20 A5).
public fun merge_shares<T>(
    acc: &mut GlobalYieldAccumulator<T>,
    target: &mut GallyShare,
    victim: GallyShare,
    ctx: &mut TxContext,
): Coin<USDC> {
    let mut victim = victim;
    let mut claimed = claim_rewards(acc, target, ctx);
    claimed.join(claim_rewards(acc, &mut victim, ctx));

    // Capture the victim's cooldown clock before it is burned away.
    let victim_acquired = share::acquired_at_ms(&victim);
    let (victim_asset, victim_count) = share::burn(victim);
    // Both claims passed the accumulator binding check; the IDs must agree.
    assert!(victim_asset == share::asset_id(target), EShareAssetMismatch);
    let combined_count = share::share_count(target) + victim_count;
    share::set_share_count(target, combined_count);

    // Inherit the MOST RECENT acquisition time: a merge must never reduce a
    // share's cooldown clock, or a fresh position could launder its
    // min_wrap_duration_ms (§12) by hiding under an older share (spec §8.1).
    if (victim_acquired > share::acquired_at_ms(target)) {
        share::set_acquired_at_ms(target, victim_acquired);
    };

    claimed
}

/// Burns a deed for good once the asset is CLOSED (Flow J, §14). EXIT PATH:
/// no pause check, no config — a closed asset's holders must always be able
/// to settle and exit (D6, I-X1). Force-claims the final yield, burns the
/// share, and decrements `total_minted_shares`; when it (and the wrapped
/// counter) reach zero the dust sweep unlocks. Returns the force-claimed
/// yield (purity §23.3).
public fun redeem_share<T>(
    acc: &mut GlobalYieldAccumulator<T>,
    share: GallyShare,
    ctx: &mut TxContext,
): Coin<USDC> {
    assert!(acc.closed, ENotClosed);

    let mut share = share;
    // Settle history first — this also enforces the share↔accumulator binding.
    let proceeds = claim_rewards(acc, &mut share, ctx);

    let (asset, count) = share::burn(share);
    assert!(asset == acc.asset_id, EShareAssetMismatch);
    acc.total_minted_shares = acc.total_minted_shares - count;

    event::emit(ShareRedeemedEvent {
        asset_id: acc.asset_id,
        holder: ctx.sender(),
        count,
        total_minted_after: acc.total_minted_shares,
    });

    proceeds
}

/// Reclaims the truncation residue after the asset is fully wound down
/// (§14, §15.4). Admin housekeeping, NOT an exit: gated on the upgrade
/// kill-switch like every other governance entry. Three guards make this the
/// only safe moment: the asset is CLOSED, no shares remain minted or wrapped
/// (so every entitlement is zero by I-M2 — there is nothing to take from a
/// holder), and the residue is within the dust bound accumulated over the
/// asset's life. Sweeps the reward pool and any unswept rollover; leaves the
/// compensation pool untouched (restitution, never the admin's to take).
public fun admin_sweep_dust<T>(
    acc: &mut GlobalYieldAccumulator<T>,
    config: &ProtocolConfig,
    _: &AdminCap,
    ctx: &mut TxContext,
): Coin<USDC> {
    protocol::assert_version(config);
    assert!(acc.closed, ENotClosed);
    assert!(
        acc.total_minted_shares == 0 && acc.total_wrapped_shares == 0,
        ESharesOutstanding,
    );

    let residue = acc.reward_pool.value() + acc.rollover_reserve.value();
    assert!(residue <= acc.dust_bound, EDustBoundExceeded);

    let mut dust = acc.reward_pool.withdraw_all();
    dust.join(acc.rollover_reserve.withdraw_all());

    event::emit(DustSweptEvent { asset_id: acc.asset_id, amount: residue });

    coin::from_balance(dust, ctx)
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

/// Live total supply of Coin<T>, read from the custodied cap. Invariant
/// I-W1: this must equal `total_wrapped_shares` at every instant outside a
/// single PTB — the fuzz suite asserts it after every operation.
public fun wrapped_coin_supply<T>(acc: &GlobalYieldAccumulator<T>): u64 {
    coin::total_supply(&acc.treasury_cap)
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

public fun is_closed<T>(acc: &GlobalYieldAccumulator<T>): bool { acc.closed }

/// Σ investor revenue ever routed in — the close-at-target denominator (§14).
public fun lifetime_investor_revenue<T>(acc: &GlobalYieldAccumulator<T>): u64 {
    acc.lifetime_investor_revenue
}

public fun dust_bound<T>(acc: &GlobalYieldAccumulator<T>): u64 { acc.dust_bound }

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
        closed: false,
        lifetime_investor_revenue: 0,
        dust_bound: 0,
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
    // Count investor inflow once, here at intake — the later rollover sweep
    // routes the SAME funds through the index, so it must not re-count (§14).
    acc.lifetime_investor_revenue = acc.lifetime_investor_revenue + funds.value();
    if (unwrapped_supply(acc) == 0) {
        // No division — route to the reserve, rescued by sweep_rollover.
        acc.rollover_reserve.join(funds);
    } else {
        advance_index(acc, funds);
    };
    acc.cumulative_yield_index
}

/// Mirrors the asset's terminal CLOSED transition onto the accumulator
/// (§14): from here `redeem_share` / `admin_sweep_dust` are unlocked and no
/// further revenue can be deposited (the asset gates that). Idempotent intent
/// — only `asset::close_*` calls it, exactly once.
public(package) fun mark_closed<T>(acc: &mut GlobalYieldAccumulator<T>) {
    acc.closed = true;
}

// === Private Functions ===

/// The index scaler (spec §15.2). u128 throughout; multiply by SCALE before
/// dividing. Truncation dust stays in `reward_pool` — it is the solvency
/// buffer that keeps I-M2 an inequality in the safe direction.
fun advance_index<T>(acc: &mut GlobalYieldAccumulator<T>, funds: Balance<USDC>) {
    let amount = funds.value();
    let unwrapped = unwrapped_supply(acc);
    let delta = (amount as u128) * SCALE / (unwrapped as u128);
    acc.cumulative_yield_index = acc.cumulative_yield_index + delta; // I-M1: only ever grows
    // The floor strands `< unwrapped/SCALE` raw units in the pool as dust
    // (§15.2); record a safe integer upper bound for the closure sweep check.
    acc.dust_bound = acc.dust_bound + unwrapped / (SCALE as u64) + 1;
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
