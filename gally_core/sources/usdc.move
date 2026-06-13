/// ⚠️ COMPILE-TIME PLACEHOLDER — NOT A REAL CURRENCY. ⚠️
///
/// Stand-in for the canonical Circle USDC coin type so the package compiles
/// and tests run without a network dependency. No `TreasuryCap` is ever
/// created for this type in production code; only `coin::mint_for_testing`
/// can produce it, and only inside tests.
///
/// BEFORE ANY NON-TEST PUBLICATION: delete this module and replace every
/// `gally_core::usdc::USDC` import with the canonical USDC dependency
/// (Circle's `usdc` package on the target network). Tracked in
/// `milestone/gally core/m2.md` completion notes and root `CLAUDE.md`.
module gally_core::usdc;

/// Placeholder coin type witness.
public struct USDC has drop {}
