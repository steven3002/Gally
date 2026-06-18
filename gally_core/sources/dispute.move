/// Dispute court, slashing & restitution (spec: protocol_flow.md §13,
/// Flow I; decisions D5, D7).
///
/// The "Supreme Court" that makes the legal oracle FALSIFIABLE: any address
/// posts a bond to contest a validator's attestation; staked validator peers
/// vote one-pool-one-vote (D7 sybil defense); a guilty verdict slashes the
/// validator's coverage for that asset and routes restitution to investors
/// through the pull-based grace-window mechanism (D5). Without this module a
/// validator's stake is decoration.
///
/// v1 scope (M6 spec amendments): deadline-only resolution (the juror set is
/// open, so no verdict is decided early); dispute window restricted to
/// EXECUTING/OPERATIONAL with coverage still locked; rejected-bond juror half
/// is pull-claimed (the contract holds pool IDs, not objects, and never
/// iterates).
module gally_core::dispute;

// === Imports ===

use gally_core::accumulator::{Self, GlobalYieldAccumulator};
use gally_core::asset::{Self, Asset, WalrusRef};
use gally_core::protocol::{Self, ProtocolConfig};
use gally_core::usdc::USDC;
use gally_core::validator::{Self, ValidatorCap, ValidatorPool};
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;
use sui::vec_set::{Self, VecSet};

// === Errors ===

/// Asset is outside the dispute window, or its coverage is already released.
const EWrongAssetState: u64 = 300;
/// Bond does not equal `ProtocolConfig.challenger_bond` exactly.
const EWrongBond: u64 = 600;
/// A dispute is already open on this asset.
const EDisputeExists: u64 = 601;
/// Juror is the target, inactive, under-staked, or claiming an unearned reward.
const EJurorIneligible: u64 = 602;
/// This pool has already voted in this dispute.
const EAlreadyVoted: u64 = 603;
/// Voting has closed (deadline passed, or already resolved).
const EVotingClosed: u64 = 604;
/// Voting is still open: resolution must wait for the deadline.
const EVotingOpen: u64 = 605;
/// The asset / pool / accumulator passed to resolve don't match the dispute.
const EWrongDisputeObjects: u64 = 606;
/// Juror-reward claim is only valid on a REJECTED dispute.
const ENotRejected: u64 = 607;
/// The dispute `reason` exceeds its byte cap (Live-Data Parity LI-Q2). Shares
/// the code with `asset::EMetadataTooLong` for a uniform metadata error.
const EMetadataTooLong: u64 = 314;

// === Constants ===

/// Byte cap for the challenger's `reason` (LI-Q2). Larger than a name — it is
/// a sentence, but still bounded so gas stays predictable.
const MAX_REASON_BYTES: u64 = 256;

const STATUS_OPEN: u8 = 0;
const STATUS_UPHELD: u8 = 1;
const STATUS_REJECTED: u8 = 2;
const STATUS_EXPIRED: u8 = 3;

const BPS_DENOMINATOR: u64 = 10_000;

// === Structs ===

/// One open contest of a validator's attestation (spec §3.10). Shared so
/// jurors vote concurrently. Votes are tracked by POOL ID, not address —
/// one staked pool, one vote — which closes the trivial sybil of voting from
/// many hot wallets (decision D7).
public struct Dispute has key {
    id: UID,
    asset_id: ID,
    target_pool_id: ID,
    accumulator_id: ID,
    challenger: address,
    /// Held until resolution: returned to the challenger if upheld/expired,
    /// split to target+jurors if rejected.
    bond: Balance<USDC>,
    /// Content-addressed counter-evidence (sha256-pinned).
    evidence: WalrusRef,
    /// Challenger's short, bond-backed statement of the claim (Live-Data
    /// Parity LI-D7). UTF-8 by convention; the full case lives in `evidence`.
    reason: vector<u8>,
    votes_guilty: u64,
    votes_innocent: u64,
    /// Pools that have voted (and, after a REJECTED verdict, not yet claimed
    /// their reward).
    voted: VecSet<ID>,
    voting_deadline_ms: u64,
    status: u8,
    /// Set on REJECTED: each voting pool pulls this much.
    juror_reward_per_vote: u64,
    /// The jurors' half of a rejected bond, drained by `claim_juror_reward`.
    juror_reward_pool: Balance<USDC>,
}

// === Events ===

public struct DisputeOpenedEvent has copy, drop {
    dispute_id: ID,
    asset_id: ID,
    target_pool_id: ID,
    challenger: address,
    bond: u64,
    evidence_sha256: vector<u8>,
    /// Challenger's short claim (LI-D7); indexed for the dispute feed.
    reason: vector<u8>,
}

/// Running tallies let a frontend track the vote live without polling state.
public struct JurorVotedEvent has copy, drop {
    dispute_id: ID,
    juror_pool_id: ID,
    guilty: bool,
    votes_guilty_after: u64,
    votes_innocent_after: u64,
}

public struct DisputeResolvedEvent has copy, drop {
    dispute_id: ID,
    asset_id: ID,
    target_pool_id: ID,
    verdict: u8,
    slashed: u64,
    bounty: u64,
    challenger: address,
    /// Accumulator compensation snapshot after resolution (LI-D9): an UPHELD
    /// verdict seeds the pool + opens the grace window; the indexer/frontend
    /// alert wrapped holders on these (D5).
    compensation_pool_after: u64,
    compensation_unlock_ms: u64,
    wrapping_frozen: bool,
}

public struct JurorRewardClaimedEvent has copy, drop {
    dispute_id: ID,
    juror_pool_id: ID,
    amount: u64,
}

// === Public Functions ===

/// Opens a dispute (Flow I). Freezes the target pool instantly — voiding all
/// its pending approvals everywhere — and sets the asset's dispute flag,
/// halting tranche releases. The fixed bond prices this harshness: a
/// frivolous challenge is a guaranteed loss (spec §13). NEVER pause-gated.
public fun initialize_dispute<T>(
    asset: &mut Asset,
    target_pool: &mut ValidatorPool,
    acc: &GlobalYieldAccumulator<T>,
    config: &ProtocolConfig,
    bond: Coin<USDC>,
    evidence: WalrusRef,
    reason: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    protocol::assert_version(config);

    // Dispute window: a slashable, accumulator-backed asset only (spec §13
    // amendment 2). FUNDING has no accumulator and contributors are already
    // protected by the all-or-nothing clawback.
    assert!(asset::is_executing(asset) || asset::is_operational(asset), EWrongAssetState);
    assert!(asset::coverage_locked(asset) > 0, EWrongAssetState);
    assert!(!asset::is_disputed(asset), EDisputeExists);
    assert!(reason.length() <= MAX_REASON_BYTES, EMetadataTooLong);

    // Bind the objects: the target must be the vouching pool; the accumulator
    // must be the asset's.
    let pool_id = asset::validator_pool_id(asset);
    assert!(pool_id.is_some() && *pool_id.borrow() == object::id(target_pool), EWrongDisputeObjects);
    accumulator::assert_asset(acc, object::id(asset));

    assert!(bond.value() == protocol::challenger_bond(config), EWrongBond);

    let dispute = Dispute {
        id: object::new(ctx),
        asset_id: object::id(asset),
        target_pool_id: object::id(target_pool),
        accumulator_id: object::id(acc),
        challenger: ctx.sender(),
        bond: bond.into_balance(),
        evidence,
        reason,
        votes_guilty: 0,
        votes_innocent: 0,
        voted: vec_set::empty(),
        voting_deadline_ms: clock.timestamp_ms() + protocol::dispute_window_ms(config),
        status: STATUS_OPEN,
        juror_reward_per_vote: 0,
        juror_reward_pool: balance::zero(),
    };
    let dispute_id = object::id(&dispute);

    asset::set_disputed(asset, true);
    validator::freeze_pool(target_pool, option::some(dispute_id));

    event::emit(DisputeOpenedEvent {
        dispute_id,
        asset_id: object::id(asset),
        target_pool_id: object::id(target_pool),
        challenger: ctx.sender(),
        bond: dispute.bond.value(),
        evidence_sha256: asset::walrus_sha256(&dispute.evidence),
        reason: dispute.reason,
    });

    transfer::share_object(dispute);
}

/// Casts one vote (spec §13). Eligibility: not the target, ACTIVE, staked at
/// or above `jury_min_stake`, and not already voted from this pool (D7).
public fun vote_on_dispute(
    dispute: &mut Dispute,
    juror_pool: &ValidatorPool,
    vcap: &ValidatorCap,
    config: &ProtocolConfig,
    guilty: bool,
    clock: &Clock,
) {
    protocol::assert_version(config);
    assert!(dispute.status == STATUS_OPEN, EVotingClosed);
    assert!(clock.timestamp_ms() < dispute.voting_deadline_ms, EVotingClosed);
    validator::assert_cap(juror_pool, vcap);

    let pool_id = object::id(juror_pool);
    assert!(pool_id != dispute.target_pool_id, EJurorIneligible);
    assert!(validator::is_active(juror_pool), EJurorIneligible);
    assert!(
        validator::stake_value(juror_pool) >= protocol::jury_min_stake(config),
        EJurorIneligible,
    );
    assert!(!dispute.voted.contains(&pool_id), EAlreadyVoted);

    dispute.voted.insert(pool_id);
    if (guilty) {
        dispute.votes_guilty = dispute.votes_guilty + 1;
    } else {
        dispute.votes_innocent = dispute.votes_innocent + 1;
    };

    event::emit(JurorVotedEvent {
        dispute_id: object::id(dispute),
        juror_pool_id: pool_id,
        guilty,
        votes_guilty_after: dispute.votes_guilty,
        votes_innocent_after: dispute.votes_innocent,
    });
}

/// Resolves a dispute after its deadline (spec §13, amendment 1: deadline-
/// only, since the juror set is open). PERMISSIONLESS. Three verdicts:
///
/// - UPHELD (quorum met, guilty fraction ≥ threshold): slash the asset's
///   coverage; bounty + bond → challenger; remainder → compensation pool.
///   EXECUTING assets also seize escrow + collateral and move to
///   COMPENSATING (three-layer stack); OPERATIONAL assets keep running.
/// - REJECTED (quorum met, threshold not reached): unfreeze; bond split 50%
///   to the target pool (freeze compensation) and 50% to voting jurors (pull).
/// - EXPIRED (quorum not met): unfreeze; bond returns 100% to the challenger
///   (juror apathy is not the challenger's fault).
public fun resolve_dispute<T>(
    dispute: &mut Dispute,
    target_pool: &mut ValidatorPool,
    asset: &mut Asset,
    acc: &mut GlobalYieldAccumulator<T>,
    config: &ProtocolConfig,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    protocol::assert_version(config);
    assert!(dispute.status == STATUS_OPEN, EVotingClosed);
    assert!(clock.timestamp_ms() >= dispute.voting_deadline_ms, EVotingOpen);
    assert!(object::id(target_pool) == dispute.target_pool_id, EWrongDisputeObjects);
    assert!(object::id(asset) == dispute.asset_id, EWrongDisputeObjects);
    assert!(object::id(acc) == dispute.accumulator_id, EWrongDisputeObjects);

    let dispute_id = object::id(dispute);
    let total_votes = dispute.votes_guilty + dispute.votes_innocent;
    let quorum_met = total_votes >= protocol::jury_quorum(config);
    let upheld =
        quorum_met
            && (dispute.votes_guilty as u128) * (BPS_DENOMINATOR as u128)
                >= (total_votes as u128) * (protocol::jury_threshold_bps(config) as u128);

    let mut slashed_amount = 0;
    let mut bounty_amount = 0;

    if (!quorum_met) {
        // EXPIRED.
        dispute.status = STATUS_EXPIRED;
        validator::unfreeze_pool(target_pool, option::some(dispute_id));
        asset::set_disputed(asset, false);
        let refund = dispute.bond.withdraw_all();
        transfer::public_transfer(coin::from_balance(refund, ctx), dispute.challenger);
    } else if (upheld) {
        // UPHELD.
        dispute.status = STATUS_UPHELD;
        let coverage = asset::coverage_locked(asset);
        slashed_amount = coverage;
        let mut slashed = validator::slash(target_pool, coverage, option::some(dispute_id));

        // Bounty (out of the slash) + full bond → challenger.
        bounty_amount = mul_bps(coverage, protocol::challenger_bounty_bps(config));
        let mut to_challenger = slashed.split(bounty_amount);
        to_challenger.join(dispute.bond.withdraw_all());
        transfer::public_transfer(coin::from_balance(to_challenger, ctx), dispute.challenger);

        // Coverage is consumed; the asset must never release it again.
        asset::clear_coverage(asset);

        // Remainder (+ seized escrow/collateral if pre-operational) →
        // compensation pool, with the grace window opened.
        let unlock_ms = clock.timestamp_ms() + protocol::compensation_grace_ms(config);
        if (asset::is_executing(asset)) {
            let seized = asset::seize_into_compensation(asset);
            slashed.join(seized);
        } else {
            // OPERATIONAL stays operational — revenue must keep flowing to
            // the very victims being compensated.
            asset::set_disputed(asset, false);
        };
        accumulator::add_to_compensation_pool(acc, slashed, unlock_ms);
    } else {
        // REJECTED.
        dispute.status = STATUS_REJECTED;
        validator::unfreeze_pool(target_pool, option::some(dispute_id));
        asset::set_disputed(asset, false);

        // 50% compensates the wrongly-frozen target pool.
        let target_half = dispute.bond.value() / 2;
        let target_funds = dispute.bond.split(target_half);
        validator::restitute_stake(target_pool, target_funds);

        // 50% to the jurors, pulled per vote (total_votes ≥ quorum ≥ 1).
        dispute.juror_reward_per_vote = dispute.bond.value() / total_votes;
        let juror_funds = dispute.bond.withdraw_all();
        dispute.juror_reward_pool.join(juror_funds);
    };

    event::emit(DisputeResolvedEvent {
        dispute_id,
        asset_id: dispute.asset_id,
        target_pool_id: dispute.target_pool_id,
        verdict: dispute.status,
        slashed: slashed_amount,
        bounty: bounty_amount,
        challenger: dispute.challenger,
        compensation_pool_after: accumulator::compensation_pool_value(acc),
        compensation_unlock_ms: accumulator::compensation_unlock_ms(acc),
        wrapping_frozen: accumulator::is_wrapping_frozen(acc),
    });
}

/// A juror pulls its share of a rejected challenger's bond (spec §13
/// amendment 3). One claim per pool, enforced by removing the pool from the
/// voted set. Pure: returns the coin.
public fun claim_juror_reward(
    dispute: &mut Dispute,
    juror_pool: &ValidatorPool,
    vcap: &ValidatorCap,
    ctx: &mut TxContext,
): Coin<USDC> {
    assert!(dispute.status == STATUS_REJECTED, ENotRejected);
    validator::assert_cap(juror_pool, vcap);

    let pool_id = object::id(juror_pool);
    assert!(dispute.voted.contains(&pool_id), EJurorIneligible);
    dispute.voted.remove(&pool_id);

    let amount = dispute.juror_reward_per_vote;
    event::emit(JurorRewardClaimedEvent {
        dispute_id: object::id(dispute),
        juror_pool_id: pool_id,
        amount,
    });
    coin::from_balance(dispute.juror_reward_pool.split(amount), ctx)
}

// === View Functions ===

public fun status(dispute: &Dispute): u8 { dispute.status }

/// Challenger's short, bond-backed claim (LI-D7).
public fun reason(dispute: &Dispute): vector<u8> { dispute.reason }

public fun votes_guilty(dispute: &Dispute): u64 { dispute.votes_guilty }

public fun votes_innocent(dispute: &Dispute): u64 { dispute.votes_innocent }

public fun voting_deadline_ms(dispute: &Dispute): u64 { dispute.voting_deadline_ms }

public fun juror_reward_per_vote(dispute: &Dispute): u64 { dispute.juror_reward_per_vote }

public fun juror_reward_pool_value(dispute: &Dispute): u64 { dispute.juror_reward_pool.value() }

public fun status_open(): u8 { STATUS_OPEN }

public fun status_upheld(): u8 { STATUS_UPHELD }

public fun status_rejected(): u8 { STATUS_REJECTED }

public fun status_expired(): u8 { STATUS_EXPIRED }

// === Test Functions ===

#[test_only]
/// Opens a dispute with a default reason, preserving the pre-M8 signature so
/// existing tests are unchanged by the LI-D7 `reason` addition.
public fun initialize_dispute_for_testing<T>(
    asset: &mut Asset,
    target_pool: &mut ValidatorPool,
    acc: &GlobalYieldAccumulator<T>,
    config: &ProtocolConfig,
    bond: Coin<USDC>,
    evidence: WalrusRef,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    initialize_dispute(
        asset,
        target_pool,
        acc,
        config,
        bond,
        evidence,
        b"Test dispute reason",
        clock,
        ctx,
    );
}

// === Private Functions ===

fun mul_bps(amount: u64, bps: u64): u64 {
    (((amount as u128) * (bps as u128) / (BPS_DENOMINATOR as u128)) as u64)
}
