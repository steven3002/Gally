/// Canonical USDC coin type for the Gally protocol.
///
/// The protocol settles in `usdc::usdc::USDC` — the SAME fully-qualified type path as
/// **Circle's** on-chain USDC (their Move package is named `usdc`, module `usdc`, struct
/// `USDC`). How `usdc` resolves is environment-specific (see `Move.toml` + `Published.toml`):
///
///   • **mainnet (production):** `Published.toml` [published.mainnet] points the `usdc`
///     dependency at Circle's deployed package id
///     (`0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7`, verified
///     6-decimal `USDC`). A consumer (gally_core) compiled under `--build-env mainnet`
///     therefore references the REAL Circle `USDC`; the `init` below is never published
///     there.
///   • **localnet (live simulation):** this package is published on the local node, so
///     `init` runs and creates a locally-mintable Mock USDC (6 decimals). The Root
///     Simulator holds the sole `TreasuryCap<USDC>` and tops up `gally_mock_faucet`.
///     ⚠️ Mintability is a SIM/LOCAL build property, NEVER a protocol property
///     (live-simulation/guard_rails.md R1) — mainnet has no local minting authority.
///   • **unit tests:** compile against this source and mint via
///     `coin::mint_for_testing<USDC>` (test-only; `init` does not run under test).
module usdc::usdc;

use sui::coin;
use sui::types;

// === Errors ===

/// The packed witness is not a one-time witness — `init` cannot proceed.
const ENotOneTimeWitness: u64 = 0;

// === Constants ===

/// USDC parity: 6 decimals (1 USDC = 1_000_000 μUSDC). Matches Circle's canonical USDC
/// and the per-entity token decimals the protocol enforces at finalize
/// ([CORE] EInvalidDecimals).
const DECIMALS: u8 = 6;

// === One-Time Witness ===

/// The OTW. Name MUST equal the module name uppercased so
/// `coin::create_currency`'s one-time-witness check passes (asserted in `init`).
public struct USDC has drop {}

// === Init ===

/// Module initializer — runs once at publish on a LOCAL node (SIM-D1). Creates the Mock
/// USDC currency, freezes its metadata immutable, and transfers the virgin
/// `TreasuryCap<USDC>` to the publisher (the Root Simulator operator), who becomes the
/// sole minter. NOT published on mainnet (the dependency resolves to Circle's package).
///
/// `#[allow(deprecated_usage)]`: the classic `create_currency` flow yields a frozen
/// `CoinMetadata<T>` in one tx, which is the standard every wallet/explorer indexes today.
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
