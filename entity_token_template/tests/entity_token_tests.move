/// ET-M1 test suite (work order: milestone/entity_token_template/m1.md).
/// Proves the publish-time shape promised by template_flow.md §11.1–§11.2:
/// frozen 6-decimal metadata (T5/I-T3/I-T2), a virgin TreasuryCap to the
/// publisher (T6/I-T1/I-T5), and that the package mints no coin.
#[test_only]
module entity_token_template::entity_token_tests;

use entity_token_template::entity_token::{Self, ENTITY_TOKEN};
use sui::coin::{Self, Coin, CoinMetadata, TreasuryCap};
use sui::test_scenario as ts;

const PUBLISHER: address = @0xA11CE;

/// I-T3 + I-T2: `init` freezes the `CoinMetadata` (lands in the immutable
/// pool) and it reports 6 decimals.
#[test]
fun test_init_freezes_metadata_at_6_decimals() {
    let mut s = ts::begin(PUBLISHER);
    entity_token::init_for_testing(s.ctx());

    s.next_tx(PUBLISHER);
    assert!(ts::has_most_recent_immutable<CoinMetadata<ENTITY_TOKEN>>(), 0);
    let metadata = s.take_immutable<CoinMetadata<ENTITY_TOKEN>>();
    assert!(coin::get_decimals(&metadata) == 6, 1);
    ts::return_immutable(metadata);

    s.end();
}

/// I-T1 + I-T5: the publisher receives exactly one `TreasuryCap`, and it is
/// virgin — `init` never mints, so total supply is 0.
#[test]
fun test_init_cap_is_virgin() {
    let mut s = ts::begin(PUBLISHER);
    entity_token::init_for_testing(s.ctx());

    s.next_tx(PUBLISHER);
    let cap = s.take_from_sender<TreasuryCap<ENTITY_TOKEN>>();
    assert!(coin::total_supply(&cap) == 0, 0);
    s.return_to_sender(cap);

    s.end();
}

/// I-T1: no `Coin<ENTITY_TOKEN>` exists anywhere after publish — the package
/// has no mint path.
#[test]
fun test_init_mints_no_coin() {
    let mut s = ts::begin(PUBLISHER);
    entity_token::init_for_testing(s.ctx());

    s.next_tx(PUBLISHER);
    assert!(!s.has_most_recent_for_sender<Coin<ENTITY_TOKEN>>(), 0);

    s.end();
}
