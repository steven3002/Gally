/// gally_mock_faucet — the On-Chain Faucet for the Root Simulator
/// (spec: milestone/live-simulation/protocol_flow.md §2).
///
/// Publishes one shared `MockFaucet` object: a reservoir of Mock USDC that any
/// address may draw a single fixed `allocation` from. It is the ONLY thing a
/// frontend wallet talks to in order to obtain test funds, and the only new
/// on-chain artifact the Live Simulation track introduces.
///
/// The faucet NEVER mints (SIM-D2): minting authority is the `TreasuryCap<USDC>`
/// held by the Root Simulator bot/operator, which periodically `refill`s the
/// reservoir. The faucet only ever splits the reservoir on `claim`. One claim
/// per address is enforced by O(1) `Table` membership — never a loop (honours
/// [CORE] I-M4 in spirit).
///
/// Conventions follow [CORE] §23: object-first / cap-second, coins by value,
/// purity (`claim` returns the coin and lets the caller's PTB route it),
/// `admin_`-prefixed setters, `E`-PascalCase errors, `*Event`-suffixed events.
module gally_mock_faucet::faucet;

// === Imports ===

use usdc::usdc::USDC;
use std::string::String;
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;
use sui::table::{Self, Table};

// === Errors ===

/// Sender already drew their one allocation (spec §2.4).
const EAlreadyClaimed: u64 = 0;
/// Reservoir balance is below `allocation`; nothing to pay out (spec §2.4).
const EReservoirEmpty: u64 = 1;
/// A refill, or a parameter setter, was given a zero value (spec §2.4).
const EZeroAmount: u64 = 2;

// === Constants ===

/// Fixed payout per claim, in μUSDC: 25,000 USDC (spec §2.5). Enough to
/// contribute to several demo assets.
const DEFAULT_ALLOCATION: u64 = 25_000_000_000;
/// Bot re-seeds when the reservoir drops below this: 100,000 USDC (spec §2.5).
const DEFAULT_LOW_WATER_MARK: u64 = 100_000_000_000;

// === Structs ===

/// The single shared treasury the whole simulation revolves around (spec §2.1).
/// Shared so any wallet and the bot can mutate it concurrently.
public struct MockFaucet has key {
    id: UID,
    /// Mock USDC available for claims; topped up by the bot via `refill`.
    reservoir: Balance<USDC>,
    /// Fixed payout per claim, in μUSDC (1 USDC = 1_000_000).
    allocation: u64,
    /// Bot re-seeds when `value(reservoir) < this`.
    low_water_mark: u64,
    /// Lifetime μUSDC paid out (telemetry).
    total_claimed: u64,
    /// Lifetime number of successful claims (telemetry).
    claim_count: u64,
    /// address -> amount claimed; enforces ONE claim per address (O(1)).
    claimants: Table<address, u64>,
}

/// Operator authority for the parameter setters. Soulbound (`key`-only, no
/// `store`): it cannot be wrapped, sold, or moved by generic transfer code.
/// Minted once to the publisher in `init`.
public struct FaucetOperatorCap has key { id: UID }

// === Events ===

/// Emitted once, at package publication — the indexer's anchor row (spec §2.3).
public struct FaucetCreatedEvent has copy, drop {
    faucet_id: ID,
    operator: address,
    allocation: u64,
    low_water_mark: u64,
}

/// Emitted on each successful `claim`. `reservoir_after` is a drawdown series.
public struct FaucetClaimedEvent has copy, drop {
    faucet_id: ID,
    recipient: address,
    amount: u64,
    reservoir_after: u64,
}

/// Emitted on each `refill` — the bot's re-seed history.
public struct FaucetRefilledEvent has copy, drop {
    faucet_id: ID,
    depositor: address,
    amount: u64,
    reservoir_after: u64,
}

/// Emitted by each operator parameter setter — the operator audit log.
public struct FaucetParamChangedEvent has copy, drop {
    faucet_id: ID,
    name: String,
    old_value: u64,
    new_value: u64,
}

// === Init ===

/// Runs exactly once at publication: creates the `MockFaucet` with the §2.5
/// defaults (reservoir starts empty — the bot's first re-seed fills it), shares
/// it, mints the `FaucetOperatorCap` to the publisher, and emits
/// `FaucetCreatedEvent`.
fun init(ctx: &mut TxContext) {
    let faucet = MockFaucet {
        id: object::new(ctx),
        reservoir: balance::zero<USDC>(),
        allocation: DEFAULT_ALLOCATION,
        low_water_mark: DEFAULT_LOW_WATER_MARK,
        total_claimed: 0,
        claim_count: 0,
        claimants: table::new<address, u64>(ctx),
    };

    event::emit(FaucetCreatedEvent {
        faucet_id: object::id(&faucet),
        operator: ctx.sender(),
        allocation: faucet.allocation,
        low_water_mark: faucet.low_water_mark,
    });

    transfer::share_object(faucet);
    transfer::transfer(FaucetOperatorCap { id: object::new(ctx) }, ctx.sender());
}

// === Public Functions ===

/// Draw the one fixed `allocation` for the sender. Purity (§23.3): returns the
/// `Coin<USDC>` and lets the caller's PTB transfer it to self. One claim per
/// address — a second call aborts `EAlreadyClaimed`.
public fun claim(faucet: &mut MockFaucet, ctx: &mut TxContext): Coin<USDC> {
    let sender = ctx.sender();
    assert!(!faucet.claimants.contains(sender), EAlreadyClaimed);
    assert!(faucet.reservoir.value() >= faucet.allocation, EReservoirEmpty);

    let amount = faucet.allocation;
    let payout = coin::take(&mut faucet.reservoir, amount, ctx);

    faucet.claimants.add(sender, amount);
    faucet.total_claimed = faucet.total_claimed + amount;
    faucet.claim_count = faucet.claim_count + 1;

    event::emit(FaucetClaimedEvent {
        faucet_id: object::id(faucet),
        recipient: sender,
        amount,
        reservoir_after: faucet.reservoir.value(),
    });

    payout
}

/// Permissionless top-up (anyone may refill, like `add_stake` in [CORE]). The
/// bot uses this every re-seed after minting with its `TreasuryCap<USDC>`.
public fun refill(faucet: &mut MockFaucet, deposit: Coin<USDC>, ctx: &TxContext) {
    let amount = deposit.value();
    assert!(amount > 0, EZeroAmount);

    faucet.reservoir.join(deposit.into_balance());

    event::emit(FaucetRefilledEvent {
        faucet_id: object::id(faucet),
        depositor: ctx.sender(),
        amount,
        reservoir_after: faucet.reservoir.value(),
    });
}

// === Admin Functions (FaucetOperatorCap) ===

/// Set the per-claim allocation. Cap-gated; a zero value aborts `EZeroAmount`.
public fun admin_set_allocation(faucet: &mut MockFaucet, _: &FaucetOperatorCap, new: u64) {
    assert!(new > 0, EZeroAmount);
    let old = faucet.allocation;
    faucet.allocation = new;
    emit_param_changed(faucet, b"allocation".to_string(), old, new);
}

/// Set the re-seed low-water mark. Cap-gated; a zero value aborts `EZeroAmount`.
public fun admin_set_low_water_mark(faucet: &mut MockFaucet, _: &FaucetOperatorCap, new: u64) {
    assert!(new > 0, EZeroAmount);
    let old = faucet.low_water_mark;
    faucet.low_water_mark = new;
    emit_param_changed(faucet, b"low_water_mark".to_string(), old, new);
}

// === View Functions ===

/// Current reservoir balance, in μUSDC.
public fun reservoir_value(faucet: &MockFaucet): u64 { faucet.reservoir.value() }

public fun allocation(faucet: &MockFaucet): u64 { faucet.allocation }

public fun low_water_mark(faucet: &MockFaucet): u64 { faucet.low_water_mark }

public fun total_claimed(faucet: &MockFaucet): u64 { faucet.total_claimed }

public fun claim_count(faucet: &MockFaucet): u64 { faucet.claim_count }

/// Whether `who` has already drawn their one allocation (`Table` membership).
public fun has_claimed(faucet: &MockFaucet, who: address): bool {
    faucet.claimants.contains(who)
}

// === Internal ===

/// Shared emitter for the two parameter setters.
fun emit_param_changed(faucet: &MockFaucet, name: String, old_value: u64, new_value: u64) {
    event::emit(FaucetParamChangedEvent {
        faucet_id: object::id(faucet),
        name,
        old_value,
        new_value,
    });
}

// === Test-only ===

#[test_only]
/// Drives `init` so tests can stand up a shared `MockFaucet` + operator cap.
public fun init_for_testing(ctx: &mut TxContext) {
    init(ctx)
}
