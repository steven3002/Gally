/// OTW fixtures for the gally_core test suite (template_flow.md §11.3, ET-M2).
///
/// `finalize_successful_raise<T>` now takes a `&CoinMetadata<T>` and asserts 6
/// decimals. A real `CoinMetadata<T>` can only come from `coin::create_currency`,
/// whose native `is_one_time_witness` check requires a genuine OTW — a struct
/// whose name equals its module name uppercased — and `CoinMetadata` has no
/// public constructor to fake. So each per-suite token type lives in its own
/// `#[test_only]` module here (struct name == module name uppercased) and
/// exposes a `new` helper returning `(TreasuryCap<T>, CoinMetadata<T>)`. Keeping
/// the original type names (`ASSET_TOKEN`, `WRAP_TOKEN`, …) means the suites'
/// existing generic usages are untouched; only the witness moves out and the
/// finalize call changes.
///
/// `bad_decimals_token` mints at 9 decimals to drive the `EInvalidDecimals`
/// negative path. Braced module form is used so all fixtures share one file.
///
/// `#[allow(deprecated_usage)]`: `coin::create_currency` is soft-deprecated
/// (decision T7); the classic flow is the one the protocol consumes.

#[test_only]
module gally_core::asset_token {
    use sui::coin::{Self, TreasuryCap, CoinMetadata};

    public struct ASSET_TOKEN has drop {}

    #[allow(deprecated_usage)]
    public fun new(ctx: &mut TxContext): (TreasuryCap<ASSET_TOKEN>, CoinMetadata<ASSET_TOKEN>) {
        coin::create_currency(ASSET_TOKEN {}, 6, b"ASSET", b"Asset Token", b"gally_core test fixture", option::none(), ctx)
    }
}

#[test_only]
module gally_core::wrap_token {
    use sui::coin::{Self, TreasuryCap, CoinMetadata};

    public struct WRAP_TOKEN has drop {}

    #[allow(deprecated_usage)]
    public fun new(ctx: &mut TxContext): (TreasuryCap<WRAP_TOKEN>, CoinMetadata<WRAP_TOKEN>) {
        coin::create_currency(WRAP_TOKEN {}, 6, b"WRAP", b"Wrap Token", b"gally_core test fixture", option::none(), ctx)
    }
}

#[test_only]
module gally_core::dispute_token {
    use sui::coin::{Self, TreasuryCap, CoinMetadata};

    public struct DISPUTE_TOKEN has drop {}

    #[allow(deprecated_usage)]
    public fun new(ctx: &mut TxContext): (TreasuryCap<DISPUTE_TOKEN>, CoinMetadata<DISPUTE_TOKEN>) {
        coin::create_currency(DISPUTE_TOKEN {}, 6, b"DISP", b"Dispute Token", b"gally_core test fixture", option::none(), ctx)
    }
}

#[test_only]
module gally_core::acc_token {
    use sui::coin::{Self, TreasuryCap, CoinMetadata};

    public struct ACC_TOKEN has drop {}

    #[allow(deprecated_usage)]
    public fun new(ctx: &mut TxContext): (TreasuryCap<ACC_TOKEN>, CoinMetadata<ACC_TOKEN>) {
        coin::create_currency(ACC_TOKEN {}, 6, b"ACC", b"Acc Token", b"gally_core test fixture", option::none(), ctx)
    }
}

#[test_only]
module gally_core::int_token {
    use sui::coin::{Self, TreasuryCap, CoinMetadata};

    public struct INT_TOKEN has drop {}

    #[allow(deprecated_usage)]
    public fun new(ctx: &mut TxContext): (TreasuryCap<INT_TOKEN>, CoinMetadata<INT_TOKEN>) {
        coin::create_currency(INT_TOKEN {}, 6, b"INT", b"Int Token", b"gally_core test fixture", option::none(), ctx)
    }
}

/// 9 decimals — drives the `EInvalidDecimals` negative test (off-spec token).
#[test_only]
module gally_core::bad_decimals_token {
    use sui::coin::{Self, TreasuryCap, CoinMetadata};

    public struct BAD_DECIMALS_TOKEN has drop {}

    #[allow(deprecated_usage)]
    public fun new(ctx: &mut TxContext): (TreasuryCap<BAD_DECIMALS_TOKEN>, CoinMetadata<BAD_DECIMALS_TOKEN>) {
        coin::create_currency(BAD_DECIMALS_TOKEN {}, 9, b"BAD", b"Bad Decimals Token", b"gally_core test fixture", option::none(), ctx)
    }
}
