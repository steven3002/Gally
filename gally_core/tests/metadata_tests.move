/// M8 test suite (work order: milestone/gally core/m8.md; spec:
/// milestone/live-data-parity/data_parity_plan.md §5).
///
/// Covers the trustless on-chain metadata layer added in M8: asset metadata
/// round-trip + the rich `metadata_blob`, the category-enum and string-cap
/// validations, term-asset metadata, and the validator display name + its cap.
/// The dispute `reason` round-trip lives in `dispute_tests` (it reuses that
/// module's full executing-asset setup); the accumulator `*_after` event
/// balances are read from the same accessors the M7 solvency fuzz validates
/// after every operation.
#[test_only]
module gally_core::metadata_tests;

use gally_core::asset::{Self, Asset, EntityCap};
use gally_core::protocol::{Self, ProtocolConfig};
use usdc::usdc::USDC;
use gally_core::validator::{Self, ValidatorPool};
use sui::clock::{Self, Clock};
use sui::coin;
use sui::test_scenario as ts;

const ADMIN: address = @0xA1;
const ENTITY: address = @0xE5;
const VALIDATOR: address = @0xC3;

const GOAL: u64 = 100_000_000_000;
const COLLATERAL: u64 = 10_000_000_000;
const STAKE: u64 = 30_000_000_000;
const FUNDING_DEADLINE_MS: u64 = 10_000;
const T0_DEADLINE_MS: u64 = 20_000;

// Category enum (LI-D4): 0 Housing … 5 Infrastructure; 6 is out of range.
const CAT_HOUSING: u8 = 0;
const CAT_TRADE_FINANCE: u8 = 2;
const CAT_INFRASTRUCTURE: u8 = 5;
const CAT_INVALID: u8 = 6;

fun make_clock(s: &mut ts::Scenario, ms: u64): Clock {
    let mut c = clock::create_for_testing(s.ctx());
    c.set_for_testing(ms);
    c
}

/// A byte vector of length `n` (for the string-cap boundary tests).
fun bytes_of_len(n: u64): vector<u8> {
    let mut v = vector[];
    let mut i = 0;
    while (i < n) {
        v.push_back(65u8); // 'A'
        i = i + 1;
    };
    v
}

fun begin(): ts::Scenario {
    let mut s = ts::begin(ADMIN);
    protocol::init_for_testing(s.ctx());
    s
}

// === Asset metadata round-trip ===

#[test]
fun test_create_asset_metadata_roundtrip() {
    let mut s = begin();
    s.next_tx(ENTITY);
    {
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, 0);
        asset::create_asset(
            &config,
            GOAL,
            FUNDING_DEADLINE_MS,
            vector[GOAL],
            vector[b"single milestone"],
            vector[T0_DEADLINE_MS],
            5_000,
            b"Lagos Coastal Residences",
            b"LCR",
            CAT_HOUSING,
            b"Lagos, Nigeria",
            b"Eko Atlantic Developments",
            b"walrus-blob-id",
            b"sha256-of-metadata",
            coin::mint_for_testing<USDC>(COLLATERAL, s.ctx()),
            &clock,
            s.ctx(),
        );
        clock.destroy_for_testing();
        ts::return_shared(config);
    };

    s.next_tx(ENTITY);
    {
        let asset = s.take_shared<Asset>();
        assert!(asset::name(&asset) == b"Lagos Coastal Residences", 0);
        assert!(asset::ticker(&asset) == b"LCR", 1);
        assert!(asset::category(&asset) == CAT_HOUSING, 2);
        assert!(asset::location(&asset) == b"Lagos, Nigeria", 3);
        assert!(asset::entity_name(&asset) == b"Eko Atlantic Developments", 4);

        // Rich content is present and content-addressed.
        let blob = asset::metadata_blob(&asset);
        assert!(blob.is_some(), 5);
        let r = blob.borrow();
        assert!(asset::walrus_blob_id(r) == b"walrus-blob-id", 6);
        assert!(asset::walrus_sha256(r) == b"sha256-of-metadata", 7);
        ts::return_shared(asset);

        let cap = s.take_from_sender<EntityCap>();
        s.return_to_sender(cap);
    };
    s.end();
}

#[test]
fun test_create_asset_empty_blob_is_none() {
    let mut s = begin();
    s.next_tx(ENTITY);
    {
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, 0);
        // Empty blob id ⇒ the entity supplied no rich content.
        asset::create_asset(
            &config,
            GOAL,
            FUNDING_DEADLINE_MS,
            vector[GOAL],
            vector[b"m1"],
            vector[T0_DEADLINE_MS],
            5_000,
            b"No Blob Asset",
            b"NBA",
            CAT_INFRASTRUCTURE,
            b"",
            b"Entity",
            b"",
            b"",
            coin::mint_for_testing<USDC>(COLLATERAL, s.ctx()),
            &clock,
            s.ctx(),
        );
        clock.destroy_for_testing();
        ts::return_shared(config);
    };

    s.next_tx(ENTITY);
    {
        let asset = s.take_shared<Asset>();
        assert!(asset::metadata_blob(&asset).is_none(), 0);
        ts::return_shared(asset);
        let cap = s.take_from_sender<EntityCap>();
        s.return_to_sender(cap);
    };
    s.end();
}

#[test]
fun test_create_term_asset_metadata() {
    let mut s = begin();
    s.next_tx(ENTITY);
    {
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, 0);
        asset::create_term_asset(
            &config,
            GOAL,
            FUNDING_DEADLINE_MS,
            vector[GOAL],
            vector[b"shipment finance"],
            vector[T0_DEADLINE_MS],
            8_000,
            b"Sahel Cotton Trade Facility",
            b"SCT",
            CAT_TRADE_FINANCE,
            b"Bamako, Mali",
            b"TransSahel Commodities",
            b"",
            b"",
            GOAL + 20_000_000_000, // return_target >= goal
            coin::mint_for_testing<USDC>(COLLATERAL, s.ctx()),
            &clock,
            s.ctx(),
        );
        clock.destroy_for_testing();
        ts::return_shared(config);
    };

    s.next_tx(ENTITY);
    {
        let asset = s.take_shared<Asset>();
        assert!(asset::is_term_financing(&asset), 0);
        assert!(asset::return_target(&asset) == GOAL + 20_000_000_000, 1);
        assert!(asset::category(&asset) == CAT_TRADE_FINANCE, 2);
        assert!(asset::name(&asset) == b"Sahel Cotton Trade Facility", 3);
        ts::return_shared(asset);
        let cap = s.take_from_sender<EntityCap>();
        s.return_to_sender(cap);
    };
    s.end();
}

// === Validation aborts ===

#[test]
#[expected_failure(abort_code = asset::EInvalidCategory)]
fun test_create_asset_category_out_of_range_aborts() {
    let mut s = begin();
    s.next_tx(ENTITY);
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, 0);
    asset::create_asset(
        &config,
        GOAL,
        FUNDING_DEADLINE_MS,
        vector[GOAL],
        vector[b"m1"],
        vector[T0_DEADLINE_MS],
        5_000,
        b"Bad Category",
        b"BAD",
        CAT_INVALID, // 6 — out of range
        b"Nowhere",
        b"Entity",
        b"",
        b"",
        coin::mint_for_testing<USDC>(COLLATERAL, s.ctx()),
        &clock,
        s.ctx(),
    );
    clock.destroy_for_testing();
    ts::return_shared(config);
    s.end();
}

#[test]
#[expected_failure(abort_code = asset::EMetadataTooLong)]
fun test_create_asset_name_too_long_aborts() {
    let mut s = begin();
    s.next_tx(ENTITY);
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, 0);
    asset::create_asset(
        &config,
        GOAL,
        FUNDING_DEADLINE_MS,
        vector[GOAL],
        vector[b"m1"],
        vector[T0_DEADLINE_MS],
        5_000,
        bytes_of_len(97), // > MAX_NAME_BYTES (96)
        b"TKR",
        CAT_HOUSING,
        b"Loc",
        b"Entity",
        b"",
        b"",
        coin::mint_for_testing<USDC>(COLLATERAL, s.ctx()),
        &clock,
        s.ctx(),
    );
    clock.destroy_for_testing();
    ts::return_shared(config);
    s.end();
}

#[test]
#[expected_failure(abort_code = asset::EMetadataTooLong)]
fun test_create_asset_ticker_too_long_aborts() {
    let mut s = begin();
    s.next_tx(ENTITY);
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, 0);
    asset::create_asset(
        &config,
        GOAL,
        FUNDING_DEADLINE_MS,
        vector[GOAL],
        vector[b"m1"],
        vector[T0_DEADLINE_MS],
        5_000,
        b"Fine Name",
        bytes_of_len(13), // > MAX_TICKER_BYTES (12)
        CAT_HOUSING,
        b"Loc",
        b"Entity",
        b"",
        b"",
        coin::mint_for_testing<USDC>(COLLATERAL, s.ctx()),
        &clock,
        s.ctx(),
    );
    clock.destroy_for_testing();
    ts::return_shared(config);
    s.end();
}

// === Validator display name (LI-D6) ===

#[test]
fun test_validator_name_roundtrip() {
    let mut s = begin();
    s.next_tx(VALIDATOR);
    {
        let config = s.take_shared<ProtocolConfig>();
        let clock = make_clock(&mut s, 0);
        let stake = coin::mint_for_testing<USDC>(STAKE, s.ctx());
        validator::register_validator(&config, stake, b"Meridian Attestation", &clock, s.ctx());
        clock.destroy_for_testing();
        ts::return_shared(config);
    };

    s.next_tx(VALIDATOR);
    {
        let pool = s.take_shared<ValidatorPool>();
        assert!(validator::name(&pool) == b"Meridian Attestation", 0);
        ts::return_shared(pool);
    };
    s.end();
}

#[test]
#[expected_failure(abort_code = validator::EMetadataTooLong)]
fun test_validator_name_too_long_aborts() {
    let mut s = begin();
    s.next_tx(VALIDATOR);
    let config = s.take_shared<ProtocolConfig>();
    let clock = make_clock(&mut s, 0);
    let stake = coin::mint_for_testing<USDC>(STAKE, s.ctx());
    validator::register_validator(&config, stake, bytes_of_len(97), &clock, s.ctx());
    clock.destroy_for_testing();
    ts::return_shared(config);
    s.end();
}
