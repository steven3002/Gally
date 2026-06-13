/// Asset lifecycle state machine (spec: protocol_flow.md §3.5–§3.7, §4,
/// Flows C, D, E and the default half of Flow J).
///
/// The shared `Asset` object is the on-chain twin of one real-world project:
/// it is the ONLY place escrowed capital lives pre-operation, so auditing
/// custody means auditing this object. Design commitments enforced here:
///
/// - All-or-nothing raise: finalize requires raised == goal exactly; abort
///   and refund are permissionless and never pause-gated (D3, D6).
/// - Capital can never be stranded: every counterparty-absent path
///   (finalize, abort, refund, flag_default) is callable by anyone.
/// - Capital can never be grabbed: tranches release sequentially, only after
///   validator approval, with a public interval between approval and
///   withdrawal (Flow E — approve and release are separate transactions).
/// - Every state transition emits `AssetStateChangedEvent` alongside its
///   specific event (spec §18.3): one type filter rebuilds the lifecycle.
module gally_core::asset;

// === Imports ===

use gally_core::accumulator::{Self, GlobalYieldAccumulator};
use gally_core::protocol::{Self, ProtocolConfig};
use gally_core::share::{Self, GallyShare};
use gally_core::usdc::USDC;
use gally_core::validator::{Self, ValidatorCap, ValidatorPool};
use sui::balance::Balance;
use sui::clock::Clock;
use sui::coin::{Self, Coin, TreasuryCap};
use sui::dynamic_field as df;
use sui::event;

// === Errors ===

/// A quantity that must be non-zero was zero.
const EZeroAmount: u64 = 2;
/// Operation illegal in the asset's current lifecycle state (spec §4).
const EWrongState: u64 = 300;
/// The funding deadline has already passed.
const EDeadlinePassed: u64 = 301;
/// The funding deadline has not been reached yet (abort precondition).
const EDeadlineNotReached: u64 = 302;
/// Funding goal not met (finalize precondition).
const EGoalNotMet: u64 = 303;
/// Funding goal already met (contribution / abort preconditions).
const EGoalAlreadyMet: u64 = 304;
/// Tranche amounts must sum exactly to the funding goal (spec §7).
const ETrancheSumMismatch: u64 = 305;
/// Receipt belongs to a different asset.
const EReceiptAssetMismatch: u64 = 307;
/// Tranche schedule malformed: empty, length-mismatched, or deadlines not
/// strictly ascending past the funding deadline (spec §7).
const EInvalidTrancheSchedule: u64 = 308;
/// Entity collateral below `funding_goal × entity_collateral_bps / 10_000`.
const EInsufficientCollateral: u64 = 309;
/// `EntityCap` does not match the asset being operated on.
const EWrongEntityCap: u64 = 311;
/// `revenue_split_bps` outside [1, 10_000] (mirrors governance code 101).
const EInvalidBps: u64 = 101;
/// Tranche operated out of sequence (spec §9 rule 1).
const ETrancheOutOfOrder: u64 = 400;
/// Tranche not validator-approved yet.
const ENotApproved: u64 = 401;
/// Tranche already released.
const EAlreadyReleased: u64 = 402;
/// Asset under dispute: approvals and releases halt (spec §9 rule 3).
const EAssetDisputed: u64 = 403;
/// No proof submitted for this tranche yet.
const EProofMissing: u64 = 404;
/// Proof already submitted for this tranche.
const EProofAlreadySubmitted: u64 = 405;
/// Approving pool is not the pool that vouched this asset.
const ENotVouchingValidator: u64 = 406;
/// Tranche already approved.
const EAlreadyApproved: u64 = 407;
/// Tranche deadline not missed: default cannot be flagged (spec §14).
const EDeadlineNotMissed: u64 = 701;

// === Constants ===

// Lifecycle states (spec §4). Any transition not implemented below is
// forbidden by construction.
const STATE_PENDING_VOUCH: u8 = 0;
const STATE_FUNDING: u8 = 1;
const STATE_FAILED: u8 = 2;
const STATE_CANCELLED: u8 = 3;
const STATE_EXECUTING: u8 = 4;
const STATE_OPERATIONAL: u8 = 5;
const STATE_COMPENSATING: u8 = 6;

const BPS_DENOMINATOR: u64 = 10_000;

// === Structs ===

/// One deadline-bound, validator-gated slice of escrowed capital (spec §3.5).
public struct Tranche has store {
    amount: u64,
    description: vector<u8>,
    /// Missing this deadline without approval ⇒ permissionless default (Flow J).
    deadline_ms: u64,
    released: bool,
    /// Entity-submitted evidence; inline rather than a dynamic field (spec
    /// §3.5 implementation note 3).
    proof: Option<WalrusRef>,
    approved_by: Option<address>,
}

/// Content-addressed pointer to off-chain evidence on Walrus. The sha256
/// pins document CONTENT, not just the blob pointer — swapping the blob
/// behind the ID is detectable and slashable (spec §3.5, attack A13).
public struct WalrusRef has copy, drop, store {
    blob_id: vector<u8>,
    sha256: vector<u8>,
    attested_by: address,
}

/// The project state machine (spec §3.5).
public struct Asset has key {
    id: UID,
    entity: address,
    state: u8,
    /// Set at vouch (spec §3.5 implementation note 1).
    validator_pool_id: Option<ID>,
    /// Exact coverage locked at vouch time — immune to later config changes
    /// (spec §3.5 implementation note 2).
    coverage_locked: u64,
    /// Also the exact total share supply: 1 share == 1 USDC (spec §2.1 of
    /// protocol.md; decision D4).
    funding_goal: u64,
    raised: u64,
    funding_deadline_ms: u64,
    /// Contributed capital; after finalize, the unreleased tranche capital.
    escrow: Balance<USDC>,
    tranches: vector<Tranche>,
    next_tranche: u64,
    /// Entity's own slashable skin-in-the-game (Triangle 2).
    entity_collateral: Balance<USDC>,
    /// Investors' share of gross revenue (decision D9). Consumed by M4.
    revenue_split_bps: u64,
    /// Set at finalize (spec §3.5 implementation note 1).
    accumulator_id: Option<ID>,
    /// True while any dispute on this asset is open: tranche flow halts.
    disputed: bool,
    created_at_ms: u64,
    // Dynamic fields: LegalDocsKey -> vector<WalrusRef> (set at vouch).
}

/// Gates entity-only actions to the address that created the asset
/// (spec §3.6). `key`-only: not sellable.
public struct EntityCap has key {
    id: UID,
    asset_id: ID,
}

/// Soulbound inverse-key to the escrow during FUNDING (spec §3.7, D8):
/// burn it to exit (refund) or to enter (share conversion). Both paths
/// consume it by value — double-use is unrepresentable.
public struct ContributionReceipt has key {
    id: UID,
    asset_id: ID,
    /// USDC contributed == future share count.
    amount: u64,
}

/// Dynamic-field key for the vouched legal documents.
public struct LegalDocsKey() has copy, drop, store;

// === Events ===

/// Full static config so the indexer never re-reads it (spec §18.3).
public struct AssetCreatedEvent has copy, drop {
    asset_id: ID,
    entity: address,
    funding_goal: u64,
    funding_deadline_ms: u64,
    tranche_count: u64,
    revenue_split_bps: u64,
    collateral: u64,
}

/// Emitted on EVERY transition alongside the specific event — one type
/// filter rebuilds any asset's full state history (spec §18.3).
public struct AssetStateChangedEvent has copy, drop {
    asset_id: ID,
    old_state: u8,
    new_state: u8,
}

public struct AssetVouchedEvent has copy, drop {
    asset_id: ID,
    pool_id: ID,
    validator: address,
    coverage: u64,
    doc_hashes: vector<vector<u8>>,
}

public struct AssetCancelledEvent has copy, drop {
    asset_id: ID,
}

public struct CapitalContributedEvent has copy, drop {
    asset_id: ID,
    contributor: address,
    amount: u64,
    /// Raise-progress chart series (spec P3).
    raised_after: u64,
}

public struct RaiseFinalizedEvent has copy, drop {
    asset_id: ID,
    accumulator_id: ID,
    total_shares: u64,
}

public struct RaiseAbortedEvent has copy, drop {
    asset_id: ID,
    raised: u64,
}

public struct ContributionRefundedEvent has copy, drop {
    asset_id: ID,
    contributor: address,
    amount: u64,
}

public struct SharesClaimedEvent has copy, drop {
    asset_id: ID,
    holder: address,
    count: u64,
    share_object_id: ID,
}

public struct MilestoneProofSubmittedEvent has copy, drop {
    asset_id: ID,
    tranche: u64,
    blob_id: vector<u8>,
    sha256: vector<u8>,
}

public struct MilestoneApprovedEvent has copy, drop {
    asset_id: ID,
    tranche: u64,
    validator: address,
    pool_id: ID,
}

public struct TrancheReleasedEvent has copy, drop {
    asset_id: ID,
    tranche: u64,
    amount: u64,
    /// Escrow drawdown chart series (spec P3).
    escrow_after: u64,
}

public struct AssetOperationalEvent has copy, drop {
    asset_id: ID,
    accumulator_id: ID,
}

public struct EntityDefaultedEvent has copy, drop {
    asset_id: ID,
    tranche_missed: u64,
    collateral_seized: u64,
    escrow_seized: u64,
}

// === Public Functions ===

/// Builds a content-addressed evidence reference, attested by the sender.
public fun new_walrus_ref(
    blob_id: vector<u8>,
    sha256: vector<u8>,
    ctx: &TxContext,
): WalrusRef {
    WalrusRef { blob_id, sha256, attested_by: ctx.sender() }
}

/// Lists a project (Flow C). Validations are spec §7 items 1–5; every
/// escrowed dollar is assigned to exactly one tranche, so there is no
/// discretionary residue. Shares the `Asset`; transfers the `EntityCap` to
/// the sender (soulbound carve-out, §23.3). State: PENDING_VOUCH.
public fun create_asset(
    config: &ProtocolConfig,
    funding_goal: u64,
    funding_deadline_ms: u64,
    tranche_amounts: vector<u64>,
    tranche_descriptions: vector<vector<u8>>,
    tranche_deadlines_ms: vector<u64>,
    revenue_split_bps: u64,
    collateral: Coin<USDC>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    protocol::assert_version(config);
    protocol::assert_not_paused(config);

    // §7 validation 2: goal > 0 and every dollar belongs to one tranche.
    assert!(funding_goal > 0, EZeroAmount);
    let n = tranche_amounts.length();
    assert!(
        n > 0 && tranche_descriptions.length() == n && tranche_deadlines_ms.length() == n,
        EInvalidTrancheSchedule,
    );

    // §7 validation 3: future funding deadline; tranche deadlines strictly
    // ascending and all past the funding deadline.
    let now = clock.timestamp_ms();
    assert!(funding_deadline_ms > now, EDeadlinePassed);

    // §7 validation 4.
    assert!(revenue_split_bps >= 1 && revenue_split_bps <= BPS_DENOMINATOR, EInvalidBps);

    // §7 validation 5: entity skin-in-the-game floor.
    let required_collateral =
        mul_bps(funding_goal, protocol::entity_collateral_bps(config));
    assert!(collateral.value() >= required_collateral, EInsufficientCollateral);

    let mut tranches = vector[];
    let mut sum = 0u64;
    let mut prev_deadline = funding_deadline_ms;
    let mut i = 0;
    while (i < n) {
        let amount = tranche_amounts[i];
        let deadline_ms = tranche_deadlines_ms[i];
        assert!(amount > 0, EZeroAmount);
        assert!(deadline_ms > prev_deadline, EInvalidTrancheSchedule);
        sum = sum + amount;
        prev_deadline = deadline_ms;
        tranches.push_back(Tranche {
            amount,
            description: tranche_descriptions[i],
            deadline_ms,
            released: false,
            proof: option::none(),
            approved_by: option::none(),
        });
        i = i + 1;
    };
    assert!(sum == funding_goal, ETrancheSumMismatch);

    let asset = Asset {
        id: object::new(ctx),
        entity: ctx.sender(),
        state: STATE_PENDING_VOUCH,
        validator_pool_id: option::none(),
        coverage_locked: 0,
        funding_goal,
        raised: 0,
        funding_deadline_ms,
        escrow: sui::balance::zero(),
        tranches,
        next_tranche: 0,
        entity_collateral: collateral.into_balance(),
        revenue_split_bps,
        accumulator_id: option::none(),
        disputed: false,
        created_at_ms: now,
    };
    let asset_id = object::id(&asset);

    event::emit(AssetCreatedEvent {
        asset_id,
        entity: ctx.sender(),
        funding_goal,
        funding_deadline_ms,
        tranche_count: n,
        revenue_split_bps,
        collateral: asset.entity_collateral.value(),
    });

    transfer::transfer(EntityCap { id: object::new(ctx), asset_id }, ctx.sender());
    transfer::share_object(asset);
}

/// Entity withdraws an unvouched listing at any time. Pure: returns the
/// collateral. State: PENDING_VOUCH → CANCELLED.
public fun cancel_unvouched_by_entity(
    asset: &mut Asset,
    cap: &EntityCap,
    ctx: &mut TxContext,
): Coin<USDC> {
    assert_entity_cap(asset, cap);
    cancel_internal(asset, ctx)
}

/// Anyone clears a listing no validator vouched within the timeout —
/// prevents zombie listings and soft-locked collateral (spec §7). The
/// collateral goes home to the entity, not to the caller.
public fun cancel_unvouched_timeout(
    asset: &mut Asset,
    config: &ProtocolConfig,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    protocol::assert_version(config);
    assert!(
        clock.timestamp_ms() > asset.created_at_ms + protocol::vouch_timeout_ms(config),
        EDeadlineNotReached,
    );
    let collateral = cancel_internal(asset, ctx);
    transfer::public_transfer(collateral, asset.entity);
}

/// Validator stakes coverage on the asset's legal reality (Flow C). The
/// locked coverage is a financial signature over the sha256 hashes in
/// `legal_docs`. State: PENDING_VOUCH → FUNDING.
public fun vouch_asset_legals(
    asset: &mut Asset,
    pool: &mut ValidatorPool,
    vcap: &ValidatorCap,
    config: &ProtocolConfig,
    legal_docs: vector<WalrusRef>,
    ctx: &TxContext,
) {
    protocol::assert_version(config);
    protocol::assert_not_paused(config);
    assert_state(asset, STATE_PENDING_VOUCH);
    validator::assert_cap(pool, vcap);
    assert!(legal_docs.length() > 0, EZeroAmount);

    // Lock coverage: asserts the pool is ACTIVE with sufficient free stake.
    let coverage = mul_bps(asset.funding_goal, protocol::vouch_coverage_bps(config));
    validator::lock_coverage(pool, coverage);

    asset.validator_pool_id = option::some(object::id(pool));
    asset.coverage_locked = coverage;

    let mut doc_hashes = vector<vector<u8>>[];
    let mut i = 0;
    while (i < legal_docs.length()) {
        doc_hashes.push_back(legal_docs[i].sha256);
        i = i + 1;
    };
    df::add(&mut asset.id, LegalDocsKey(), legal_docs);

    event::emit(AssetVouchedEvent {
        asset_id: object::id(asset),
        pool_id: object::id(pool),
        validator: ctx.sender(),
        coverage,
        doc_hashes,
    });
    set_state(asset, STATE_FUNDING);
}

/// Contributes to the raise (Flow D). Caps at the goal and RETURNS the
/// excess coin (D4, purity §23.3); the soulbound receipt is transferred
/// internally (a `key`-only object cannot pass through PTB transfers).
public fun contribute_capital(
    asset: &mut Asset,
    config: &ProtocolConfig,
    clock: &Clock,
    mut payment: Coin<USDC>,
    ctx: &mut TxContext,
): Coin<USDC> {
    protocol::assert_version(config);
    protocol::assert_not_paused(config);
    assert_state(asset, STATE_FUNDING);
    assert!(clock.timestamp_ms() < asset.funding_deadline_ms, EDeadlinePassed);
    assert!(asset.raised < asset.funding_goal, EGoalAlreadyMet);
    assert!(payment.value() > 0, EZeroAmount);

    let open = asset.funding_goal - asset.raised;
    let accepted = if (payment.value() < open) { payment.value() } else { open };

    asset.escrow.join(payment.split(accepted, ctx).into_balance());
    asset.raised = asset.raised + accepted;

    let asset_id = object::id(asset);
    transfer::transfer(
        ContributionReceipt { id: object::new(ctx), asset_id, amount: accepted },
        ctx.sender(),
    );

    event::emit(CapitalContributedEvent {
        asset_id,
        contributor: ctx.sender(),
        amount: accepted,
        raised_after: asset.raised,
    });

    payment
}

/// PERMISSIONLESS finalize (D3): once the goal is hit, no absent or
/// malicious entity can strand investor capital. Requires the entity's
/// VIRGIN `TreasuryCap<T>` (checked in the accumulator — pre-minted supply
/// would break I-W1 forever). Creates the accumulator, which custodies the
/// cap permanently. State: FUNDING → EXECUTING.
public fun finalize_successful_raise<T>(
    asset: &mut Asset,
    config: &ProtocolConfig,
    treasury_cap: TreasuryCap<T>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    protocol::assert_version(config);
    assert_state(asset, STATE_FUNDING);
    assert!(asset.raised == asset.funding_goal, EGoalNotMet);
    assert!(clock.timestamp_ms() <= asset.funding_deadline_ms, EDeadlinePassed);

    let asset_id = object::id(asset);
    let acc_id =
        accumulator::new_accumulator<T>(asset_id, asset.funding_goal, treasury_cap, ctx);
    asset.accumulator_id = option::some(acc_id);

    event::emit(RaiseFinalizedEvent {
        asset_id,
        accumulator_id: acc_id,
        total_shares: asset.funding_goal,
    });
    set_state(asset, STATE_EXECUTING);
}

/// PERMISSIONLESS abort after a missed goal (the all-or-nothing clawback,
/// spec §8). Releases the validator's coverage (failure to raise is not the
/// validator's fault) and returns the entity's collateral. NEVER pause-gated
/// (D6). State: FUNDING → FAILED; refunds open.
public fun abort_failed_raise(
    asset: &mut Asset,
    pool: &mut ValidatorPool,
    config: &ProtocolConfig,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    protocol::assert_version(config);
    assert_state(asset, STATE_FUNDING);
    assert!(clock.timestamp_ms() > asset.funding_deadline_ms, EDeadlineNotReached);
    assert!(asset.raised < asset.funding_goal, EGoalAlreadyMet);
    assert_vouching_pool(asset, pool);

    validator::release_coverage(pool, asset.coverage_locked);
    asset.coverage_locked = 0;

    // The raise failing is not a fault event: collateral goes home.
    let collateral = asset.entity_collateral.withdraw_all();
    transfer::public_transfer(coin::from_balance(collateral, ctx), asset.entity);

    event::emit(RaiseAbortedEvent { asset_id: object::id(asset), raised: asset.raised });
    set_state(asset, STATE_FAILED);
}

/// Burns a receipt for the exact principal back (Flow D). NEVER pause-gated
/// (D6, I-X1). Solvency is structural: escrow == Σ outstanding receipts ==
/// raised throughout the refund phase (I-C2).
public fun refund_contribution(
    asset: &mut Asset,
    config: &ProtocolConfig,
    receipt: ContributionReceipt,
    ctx: &mut TxContext,
): Coin<USDC> {
    protocol::assert_version(config);
    assert_state(asset, STATE_FAILED);

    let ContributionReceipt { id, asset_id, amount } = receipt;
    assert!(asset_id == object::id(asset), EReceiptAssetMismatch);
    id.delete();

    asset.raised = asset.raised - amount;

    event::emit(ContributionRefundedEvent {
        asset_id,
        contributor: ctx.sender(),
        amount,
    });

    coin::take(&mut asset.escrow, amount, ctx)
}

/// Converts a receipt into the digital deed (Flow D). The share's index
/// snapshot is the CURRENT global index, not zero: a holder cannot
/// retroactively collect yield from before the share existed (spec §8).
/// Pure: returns the share. Callable in any post-finalize state.
public fun claim_shares<T>(
    asset: &Asset,
    acc: &GlobalYieldAccumulator<T>,
    config: &ProtocolConfig,
    receipt: ContributionReceipt,
    clock: &Clock,
    ctx: &mut TxContext,
): GallyShare {
    protocol::assert_version(config);
    assert!(is_post_finalize(asset), EWrongState);
    accumulator::assert_asset(acc, object::id(asset));

    let ContributionReceipt { id, asset_id, amount } = receipt;
    assert!(asset_id == object::id(asset), EReceiptAssetMismatch);
    id.delete();

    let minted = share::mint(
        asset_id,
        amount,
        accumulator::cumulative_yield_index(acc),
        clock.timestamp_ms(),
        ctx,
    );

    event::emit(SharesClaimedEvent {
        asset_id,
        holder: ctx.sender(),
        count: amount,
        share_object_id: object::id(&minted),
    });

    minted
}

/// Entity attaches milestone evidence for the next tranche (Flow E step 1).
public fun submit_milestone_proof(
    asset: &mut Asset,
    cap: &EntityCap,
    config: &ProtocolConfig,
    tranche_index: u64,
    proof: WalrusRef,
) {
    protocol::assert_version(config);
    protocol::assert_not_paused(config);
    assert_state(asset, STATE_EXECUTING);
    assert_entity_cap(asset, cap);
    assert!(tranche_index == asset.next_tranche, ETrancheOutOfOrder);

    let asset_id = object::id(asset);
    let tranche = &mut asset.tranches[tranche_index];
    assert!(tranche.proof.is_none(), EProofAlreadySubmitted);
    tranche.proof.fill(proof);

    event::emit(MilestoneProofSubmittedEvent {
        asset_id,
        tranche: tranche_index,
        blob_id: proof.blob_id,
        sha256: proof.sha256,
    });
}

/// The vouching validator signs off on the milestone (Flow E step 2).
/// Deliberately a SEPARATE transaction from the release: the approval is
/// publicly visible before money moves, giving challengers a dispute window
/// while the capital is still in escrow (spec §9 rule 2).
public fun approve_milestone(
    asset: &mut Asset,
    pool: &ValidatorPool,
    vcap: &ValidatorCap,
    config: &ProtocolConfig,
    tranche_index: u64,
    ctx: &TxContext,
) {
    protocol::assert_version(config);
    protocol::assert_not_paused(config);
    assert_state(asset, STATE_EXECUTING);
    assert!(!asset.disputed, EAssetDisputed);
    validator::assert_cap(pool, vcap);
    assert_vouching_pool(asset, pool);
    // A frozen validator's pending approvals are void (spec §9 rule 4).
    assert!(validator::is_active(pool), 202 /* EValidatorNotActive */);
    assert!(tranche_index == asset.next_tranche, ETrancheOutOfOrder);

    let asset_id = object::id(asset);
    let tranche = &mut asset.tranches[tranche_index];
    assert!(tranche.proof.is_some(), EProofMissing);
    assert!(tranche.approved_by.is_none(), EAlreadyApproved);
    tranche.approved_by.fill(ctx.sender());

    event::emit(MilestoneApprovedEvent {
        asset_id,
        tranche: tranche_index,
        validator: ctx.sender(),
        pool_id: object::id(pool),
    });
}

/// Entity pulls an approved tranche (Flow E step 3). Pull, not push: a
/// compromised validator key alone cannot move money (spec §9). Pure:
/// returns the tranche coin. The final release flips OPERATIONAL.
public fun release_funding_tranche(
    asset: &mut Asset,
    cap: &EntityCap,
    config: &ProtocolConfig,
    tranche_index: u64,
    ctx: &mut TxContext,
): Coin<USDC> {
    protocol::assert_version(config);
    protocol::assert_not_paused(config);
    assert_state(asset, STATE_EXECUTING);
    assert!(!asset.disputed, EAssetDisputed);
    assert_entity_cap(asset, cap);
    assert!(tranche_index == asset.next_tranche, ETrancheOutOfOrder);

    let asset_id = object::id(asset);
    let tranche = &mut asset.tranches[tranche_index];
    assert!(tranche.approved_by.is_some(), ENotApproved);
    assert!(!tranche.released, EAlreadyReleased);
    tranche.released = true;
    let amount = tranche.amount;

    asset.next_tranche = asset.next_tranche + 1;
    let payout = coin::take(&mut asset.escrow, amount, ctx);

    event::emit(TrancheReleasedEvent {
        asset_id,
        tranche: tranche_index,
        amount,
        escrow_after: asset.escrow.value(),
    });

    if (asset.next_tranche == asset.tranches.length()) {
        event::emit(AssetOperationalEvent {
            asset_id,
            accumulator_id: *asset.accumulator_id.borrow(),
        });
        set_state(asset, STATE_OPERATIONAL);
    };

    payout
}

/// PERMISSIONLESS release of the validator's coverage once the project is
/// safely OPERATIONAL or dead-without-fault (FAILED handled in abort). Kept
/// separate from the last tranche release so that call needs no pool object.
public fun release_vouch_coverage(asset: &mut Asset, pool: &mut ValidatorPool) {
    assert!(asset.state == STATE_OPERATIONAL, EWrongState);
    assert_vouching_pool(asset, pool);
    assert!(asset.coverage_locked > 0, EZeroAmount);

    validator::release_coverage(pool, asset.coverage_locked);
    asset.coverage_locked = 0;
}

/// PERMISSIONLESS default trigger (Flow J): one honest actor and one expired
/// deadline suffice — "the community invokes a contract function" must not
/// require coordination. Seizes the entity collateral AND the unreleased
/// escrow into the accumulator's compensation pool, freezes wrapping, and
/// opens the grace window (swept by M6). NEVER pause-gated.
/// State: EXECUTING → COMPENSATING.
public fun flag_default<T>(
    asset: &mut Asset,
    acc: &mut GlobalYieldAccumulator<T>,
    config: &ProtocolConfig,
    clock: &Clock,
) {
    protocol::assert_version(config);
    assert_state(asset, STATE_EXECUTING);
    accumulator::assert_asset(acc, object::id(asset));

    let now = clock.timestamp_ms();
    let tranche = &asset.tranches[asset.next_tranche];
    assert!(now > tranche.deadline_ms, EDeadlineNotMissed);
    // An approved milestone is not a default: the entity proved the work and
    // merely has to pull (spec §14).
    assert!(tranche.approved_by.is_none(), EAlreadyApproved);

    let mut seized = asset.entity_collateral.withdraw_all();
    let collateral_seized = seized.value();
    let escrow_seized = asset.escrow.value();
    seized.join(asset.escrow.withdraw_all());

    accumulator::add_to_compensation_pool(
        acc,
        seized,
        now + protocol::compensation_grace_ms(config),
    );

    event::emit(EntityDefaultedEvent {
        asset_id: object::id(asset),
        tranche_missed: asset.next_tranche,
        collateral_seized,
        escrow_seized,
    });
    set_state(asset, STATE_COMPENSATING);
}

// === View Functions ===

public fun state(asset: &Asset): u8 { asset.state }

public fun entity(asset: &Asset): address { asset.entity }

public fun funding_goal(asset: &Asset): u64 { asset.funding_goal }

public fun raised(asset: &Asset): u64 { asset.raised }

public fun escrow_value(asset: &Asset): u64 { asset.escrow.value() }

public fun collateral_value(asset: &Asset): u64 { asset.entity_collateral.value() }

public fun revenue_split_bps(asset: &Asset): u64 { asset.revenue_split_bps }

public fun next_tranche(asset: &Asset): u64 { asset.next_tranche }

public fun tranche_count(asset: &Asset): u64 { asset.tranches.length() }

public fun coverage_locked(asset: &Asset): u64 { asset.coverage_locked }

public fun is_disputed(asset: &Asset): bool { asset.disputed }

public fun validator_pool_id(asset: &Asset): Option<ID> { asset.validator_pool_id }

public fun accumulator_id(asset: &Asset): Option<ID> { asset.accumulator_id }

public fun is_operational(asset: &Asset): bool { asset.state == STATE_OPERATIONAL }

public fun tranche_released(asset: &Asset, index: u64): bool {
    asset.tranches[index].released
}

public fun tranche_approved(asset: &Asset, index: u64): bool {
    asset.tranches[index].approved_by.is_some()
}

public fun receipt_amount(receipt: &ContributionReceipt): u64 { receipt.amount }

public fun receipt_asset_id(receipt: &ContributionReceipt): ID { receipt.asset_id }

// === Package Functions ===

/// Dispute lifecycle hook (M6): freezes / unfreezes the tranche flow.
public(package) fun set_disputed(asset: &mut Asset, disputed: bool) {
    asset.disputed = disputed;
}

// === Private Functions ===

fun assert_state(asset: &Asset, expected: u8) {
    assert!(asset.state == expected, EWrongState);
}

fun is_post_finalize(asset: &Asset): bool {
    asset.state == STATE_EXECUTING
        || asset.state == STATE_OPERATIONAL
        || asset.state == STATE_COMPENSATING
}

fun assert_entity_cap(asset: &Asset, cap: &EntityCap) {
    assert!(cap.asset_id == object::id(asset), EWrongEntityCap);
}

fun assert_vouching_pool(asset: &Asset, pool: &ValidatorPool) {
    assert!(
        asset.validator_pool_id.is_some()
            && *asset.validator_pool_id.borrow() == object::id(pool),
        ENotVouchingValidator,
    );
}

/// Every transition funnels through here: the paired state-change event is
/// structurally impossible to forget (spec §18.3).
fun set_state(asset: &mut Asset, new_state: u8) {
    let old_state = asset.state;
    asset.state = new_state;
    event::emit(AssetStateChangedEvent {
        asset_id: object::id(asset),
        old_state,
        new_state,
    });
}

fun cancel_internal(asset: &mut Asset, ctx: &mut TxContext): Coin<USDC> {
    assert_state(asset, STATE_PENDING_VOUCH);
    event::emit(AssetCancelledEvent { asset_id: object::id(asset) });
    set_state(asset, STATE_CANCELLED);
    coin::from_balance(asset.entity_collateral.withdraw_all(), ctx)
}

fun mul_bps(amount: u64, bps: u64): u64 {
    (((amount as u128) * (bps as u128) / (BPS_DENOMINATOR as u128)) as u64)
}

// === Test Functions ===

#[test_only]
/// M6 is not built yet; tests exercise the dispute freeze through this.
public fun set_disputed_for_testing(asset: &mut Asset, disputed: bool) {
    set_disputed(asset, disputed);
}

#[test_only]
public fun state_pending_vouch(): u8 { STATE_PENDING_VOUCH }

#[test_only]
public fun state_funding(): u8 { STATE_FUNDING }

#[test_only]
public fun state_failed(): u8 { STATE_FAILED }

#[test_only]
public fun state_cancelled(): u8 { STATE_CANCELLED }

#[test_only]
public fun state_executing(): u8 { STATE_EXECUTING }

#[test_only]
public fun state_operational(): u8 { STATE_OPERATIONAL }

#[test_only]
public fun state_compensating(): u8 { STATE_COMPENSATING }
