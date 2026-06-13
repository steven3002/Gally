/// entity_token_template — one-shot per-entity token package
/// (spec: milestone/entity_token_template/template_flow.md).
///
/// Published ONCE per funded Gally asset. The module initializer mints
/// nothing: it creates this asset's fungible `Coin<ENTITY_TOKEN>` with zero
/// supply and 6 decimals, FREEZES its `CoinMetadata` (immutable forever, T5),
/// and hands the virgin `TreasuryCap` to the publisher (T6). The publisher
/// forwards that cap into `gally_core::asset::finalize_successful_raise<T>`,
/// where the accumulator custodies it for the life of the asset; after that
/// this package has no further role.
///
/// The package depends on the Sui framework ONLY (T2, I-T4) and NEVER mints —
/// that is its entire security value (I-T1): the sole mint/burn path for
/// `Coin<ENTITY_TOKEN>` is `gally_core`'s wrap machine, so total supply always
/// equals `total_wrapped_shares` (I-W1).
///
/// Deployment — copy-rename-publish (T1): copy this package, rename the module
/// AND the witness struct to the entity's slug. The witness name MUST equal
/// the module name uppercased, or `coin::create_currency`'s one-time-witness
/// check aborts at runtime. Edit the metadata constants below; DO NOT touch
/// `DECIMALS`. Then `sui client publish`.
module entity_token_template::entity_token;

use sui::coin;
use sui::url;

// === Metadata — EDIT THESE per entity (T3, template_flow.md §6) ===

/// Token name, UTF-8.
const NAME: vector<u8> = b"Gally Entity Deed";
/// Ticker, ASCII.
const SYMBOL: vector<u8> = b"GALLYD";
/// Description; include the Gally asset id once it is known.
const DESCRIPTION: vector<u8> =
    b"Fractional equity deed for a Gally-funded real-world asset.";
/// Icon URL bytes. Leave empty for none (resolved to `option::none()` below).
const ICON_URL: vector<u8> = b"";

// === DO NOT EDIT BELOW ===

/// USDC parity: 1 share == 1 USDC == 1 `Coin` unit (template_flow.md §6).
/// Re-enforced cryptographically at `gally_core` finalize (EInvalidDecimals).
/// NOT an operator knob (T3/T4, I-T2).
const DECIMALS: u8 = 6;

// === One-Time Witness ===

/// The OTW. Name MUST equal the module name uppercased; renamed alongside the
/// module on publish (T1). Packable only in `init` — guarantees exactly one
/// `Coin<ENTITY_TOKEN>` type ever exists (I-T5).
public struct ENTITY_TOKEN has drop {}

// === Init ===

/// Module initializer — runs once at publish. Mints zero supply (T6), freezes
/// the metadata (T5), sends the virgin `TreasuryCap` to the publisher.
///
/// `#[allow(deprecated_usage)]`: `coin::create_currency` is soft-deprecated in
/// favour of `coin_registry::new_currency_with_otw`. We deliberately keep the
/// classic flow (decision T7) — it yields a `CoinMetadata<T>` in ONE tx with
/// `public_freeze_object` immutability, which is exactly the `&CoinMetadata<T>`
/// handoff `finalize_successful_raise<T>` consumes (protocol_flow.md §8) and
/// the standard every wallet/explorer indexes today. The registry flow would
/// force a two-tx ceremony, a system-object dependency, and a co-owned spec
/// rewrite for no protocol benefit. Scope kept tight to this function.
#[allow(deprecated_usage)]
fun init(witness: ENTITY_TOKEN, ctx: &mut TxContext) {
    let icon = if (ICON_URL == b"") {
        option::none()
    } else {
        option::some(url::new_unsafe_from_bytes(ICON_URL))
    };

    let (treasury_cap, metadata) = coin::create_currency(
        witness,
        DECIMALS,
        SYMBOL,
        NAME,
        DESCRIPTION,
        icon,
        ctx,
    );

    // T5: metadata is immutable for the life of the chain — no rug-rename.
    transfer::public_freeze_object(metadata);
    // T6: virgin cap to the publisher, who forwards it into finalize. No mint
    // happens here, so the cap leaves with total_supply == 0.
    transfer::public_transfer(treasury_cap, ctx.sender());
}

// === Test-only ===

#[test_only]
/// Drives `init` with a packed witness so tests can exercise publish behaviour
/// (template_flow.md §11.1). Permitted because `ENTITY_TOKEN` is this module's
/// genuine OTW.
public fun init_for_testing(ctx: &mut TxContext) {
    init(ENTITY_TOKEN {}, ctx)
}
