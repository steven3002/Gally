/// ⚠️ SIM-ONLY BUILD PROFILE — locally-mintable Mock USDC. ⚠️
///
/// Stand-in for the canonical Circle USDC coin type. The **SIM-D1** profile
/// (milestone/live-simulation/protocol_flow.md §3) turns this module into a
/// REAL but MOCK currency so a live local node can mint it: `init` calls
/// `coin::create_currency<USDC>` (6 decimals), freezes the `CoinMetadata`, and
/// hands the `TreasuryCap<USDC>` to the publisher. The Root Simulator bot then
/// holds the sole minting authority and tops up the `gally_mock_faucet`
/// reservoir; the protocol consumes `Coin<USDC>` exactly as before.
///
/// ⚠️ This is NOT the production swap. For testnet/mainnet, delete this module
/// and repoint every `gally_core::usdc::USDC` import at Circle's canonical
/// `usdc` package — which has NO local minting authority. The sim profile and
/// the production swap are two distinct, mutually-exclusive build targets and
/// must never be conflated (live-simulation/guard_rails.md R1). "USDC is
/// mintable" is a SIM-BUILD property, never a protocol property.
///
/// Unit tests still mint via `coin::mint_for_testing<USDC>` (test-only) and are
/// unaffected by `init` (which only runs at publish).
module gally_core::usdc;

use sui::coin;
use sui::types;

// === Errors ===

/// The packed witness is not a one-time witness — `init` cannot proceed.
const ENotOneTimeWitness: u64 = 0;

// === Constants ===

/// USDC parity: 6 decimals (1 USDC = 1_000_000 μUSDC), matching the per-entity
/// token decimals the protocol enforces at finalize ([CORE] EInvalidDecimals).
const DECIMALS: u8 = 6;

// === One-Time Witness ===

/// The OTW. Name MUST equal the module name uppercased so
/// `coin::create_currency`'s one-time-witness check passes (asserted in `init`).
public struct USDC has drop {}

// === Init ===

/// Module initializer — runs once at publish (SIM-D1). Creates the Mock USDC
/// currency, freezes its metadata immutable, and transfers the virgin
/// `TreasuryCap<USDC>` to the publisher (the Root Simulator operator), who
/// becomes the sole minter.
///
/// `#[allow(deprecated_usage)]`: same rationale as the entity-token template —
/// the classic `create_currency` flow yields a frozen `CoinMetadata<T>` in one
/// tx, which is the standard every wallet/explorer indexes today.
#[allow(deprecated_usage)]
fun init(witness: USDC, ctx: &mut TxContext) {
    assert!(types::is_one_time_witness(&witness), ENotOneTimeWitness);

    let (treasury_cap, metadata) = coin::create_currency(
        witness,
        DECIMALS,
        b"USDC",
        b"Mock USDC",
        b"local-sim mock USDC",
        option::none(),
        ctx,
    );

    // Metadata is immutable for the life of the chain (6 decimals, fixed name).
    transfer::public_freeze_object(metadata);
    // Sole minting authority to the publisher/operator (SIM-D2).
    transfer::public_transfer(treasury_cap, ctx.sender());
}
