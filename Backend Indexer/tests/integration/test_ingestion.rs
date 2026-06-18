//! Ingestion + handler integration tests.
//!
//! BI-M1: migrations, cursor read/write, idempotent raw-event upsert, the dispatch path, and
//! `/health`. BI-M2: governance + asset-lifecycle handlers driven end-to-end through
//! [`ingestion::route_event`] (deserialize → handler → DB). All DB tests use `#[sqlx::test]`,
//! which provisions a fresh database per test from `DATABASE_URL`.

use gally_indexer::db;
use gally_indexer::ingestion::{self, route_event};
use gally_indexer::sui_client::{EventId, SuiEvent};
use serde_json::{json, Value};
use sqlx::PgPool;

const PKG: &str = "0x309d0b80";

/// Row shape for the `position_events` wrap/unwrap assertion (`event_type, amount,
/// total_wrapped_after, share_object_id`).
type PositionRow = (String, Option<i64>, Option<i64>, Option<String>);

/// Row shape for the `yield_index_series` revenue-precision assertion (`event_type, gross, fee,
/// investor_portion, entity_portion, index_after::text, unwrapped_supply`).
type RevenueRow = (String, Option<i64>, Option<i64>, Option<i64>, Option<i64>, String, i64);

/// Row shape for the `tranche_events` proof→approved→released assertion (`event_type,
/// tranche_index, blob_id, sha256, validator, amount`).
type TrancheRow = (String, i32, Option<String>, Option<String>, Option<String>, Option<i64>);

/// Build a `SuiEvent` as it would arrive from `suix_queryEvents` (`module::Struct` short name,
/// string `eventSeq`/`timestampMs`).
fn ev(module: &str, struct_name: &str, tx: &str, seq: &str, ts: i64, parsed: Value) -> SuiEvent {
    SuiEvent {
        id: EventId {
            tx_digest: tx.to_string(),
            event_seq: seq.to_string(),
        },
        event_type: format!("{PKG}::{module}::{struct_name}"),
        parsed_json: parsed,
        timestamp_ms: Some(ts.to_string()),
    }
}

/// An `AssetCreatedEvent` payload with every numeric field on the wire as a JSON string (§10.2).
fn asset_created(asset_id: &str, entity: &str, goal: &str) -> Value {
    json!({
        "asset_id": asset_id, "entity": entity,
        "funding_goal": goal, "funding_deadline_ms": "1750000000000",
        "tranche_count": "3", "revenue_split_bps": "7000", "collateral": "200000000"
    })
}

async fn route(pool: &PgPool, e: &SuiEvent) {
    route_event(pool, e).await.expect("handler must succeed");
}

// ---------------------------------------------------------------------------
// BI-M1 carry-over
// ---------------------------------------------------------------------------

async fn table_exists(pool: &PgPool, name: &str) -> bool {
    let row: (bool,) =
        sqlx::query_as("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)")
            .bind(name)
            .fetch_one(pool)
            .await
            .unwrap();
    row.0
}

#[sqlx::test]
async fn test_migrations_run(pool: PgPool) {
    db::run_migrations(&pool).await.expect("migrations should apply");
    for t in [
        "indexer_cursor",
        "raw_events",
        "governance_events",
        "assets",
        "asset_state_changes",
    ] {
        assert!(table_exists(&pool, t).await, "{t} created");
    }
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_cursor_init_zero(pool: PgPool) {
    assert_eq!(db::queries::read_cursor(&pool).await.unwrap(), 0);
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_cursor_write_read(pool: PgPool) {
    db::queries::write_cursor(&pool, 42).await.unwrap();
    assert_eq!(db::queries::read_cursor(&pool).await.unwrap(), 42);
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_raw_event_upsert(pool: PgPool) {
    let payload = json!({ "asset_id": "0xabc", "funding_goal": "1000000" });
    let event = db::queries::RawEventInsert {
        tx_digest: "0xdeadbeef",
        event_seq: 0,
        checkpoint_seq: 1,
        timestamp_ms: 1_749_000_000_000,
        event_type: "0xpkg::asset::AssetCreatedEvent",
        payload: &payload,
    };
    let first = db::queries::upsert_raw_event(&pool, &event).await.unwrap();
    let second = db::queries::upsert_raw_event(&pool, &event).await.unwrap();
    assert!(first, "first insert is new");
    assert!(!second, "duplicate insert is skipped");
    let count: (i64,) = sqlx::query_as("SELECT count(*) FROM raw_events")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count.0, 1, "exactly one row after a duplicate insert");
}

/// Routing an unknown event type does not crash and writes no typed rows (guard rail R7); it is
/// reported as unhandled (`Ok(false)`).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_unknown_event_type_does_not_panic(pool: PgPool) {
    let handled = route_event(&pool, &ev("mystery", "UnknownEvent", "0xtx", "0", 1, json!({})))
        .await
        .unwrap();
    assert!(!handled, "unknown types are not handled");
    let n: (i64,) = sqlx::query_as("SELECT count(*) FROM assets")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n.0, 0, "no typed rows written for an unknown type");
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_health_endpoint_returns_200(pool: PgPool) {
    // BI-M7: /health now compares the cursor to a chain tip; the default test state uses tip = 0,
    // so a fresh DB (cursor 0) is "ok" with zero lag.
    let base = crate::spawn(crate::app_state(pool, crate::default_objects())).await;
    let resp = reqwest::Client::new()
        .get(format!("{base}/health"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
    assert_eq!(body["cursor"], 0);
}

// ---------------------------------------------------------------------------
// BI-M2 — asset lifecycle
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_asset_created_inserts_row(pool: PgPool) {
    route(
        &pool,
        &ev("asset", "AssetCreatedEvent", "0xtx1", "0", 1000, asset_created("0xA", "0xE", "1000000000")),
    )
    .await;

    let n: (i64,) = sqlx::query_as("SELECT count(*) FROM assets")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n.0, 1, "exactly one asset row");

    let row: (String, i64, i32, i32, i64, i16) = sqlx::query_as(
        "SELECT entity, goal, tranche_count, revenue_split_bps, collateral, current_state \
         FROM assets WHERE asset_id = $1",
    )
    .bind("0xA")
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row, ("0xE".to_string(), 1_000_000_000, 3, 7000, 200_000_000, 0));

    // create_asset seeds the PENDING_VOUCH(0→0) row.
    let seed: (i16, i16) =
        sqlx::query_as("SELECT old_state, new_state FROM asset_state_changes WHERE asset_id = $1")
            .bind("0xA")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(seed, (0, 0), "initial PENDING_VOUCH row seeded");
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_asset_vouched_updates_pool(pool: PgPool) {
    route(&pool, &ev("asset", "AssetCreatedEvent", "0xt1", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await;
    route(
        &pool,
        &ev(
            "asset",
            "AssetVouchedEvent",
            "0xt2",
            "0",
            2,
            json!({ "asset_id": "0xA", "pool_id": "0xPOOL", "validator": "0xV",
                    "coverage": "20000000000", "doc_hashes": [[9,9,9,9]] }),
        ),
    )
    .await;

    let row: (Option<String>, Option<i64>) =
        sqlx::query_as("SELECT validator_pool_id, coverage FROM assets WHERE asset_id = $1")
            .bind("0xA")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row, (Some("0xPOOL".to_string()), Some(20_000_000_000)));
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_state_change_sequence(pool: PgPool) {
    route(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await;
    // 0→1 (funding opens), 1→4 (executing), 4→5 (operational).
    let transitions = [("0xs1", 0u8, 1u8, 10i64), ("0xs2", 1, 4, 20), ("0xs3", 4, 5, 30)];
    for (tx, old, new, ts) in transitions {
        route(
            &pool,
            &ev("asset", "AssetStateChangedEvent", tx, "0", ts,
                json!({ "asset_id": "0xA", "old_state": old, "new_state": new })),
        )
        .await;
    }

    let rows: Vec<(i16, i16, i64)> = sqlx::query_as(
        "SELECT old_state, new_state, timestamp_ms FROM asset_state_changes \
         WHERE asset_id = $1 ORDER BY timestamp_ms ASC, id ASC",
    )
    .bind("0xA")
    .fetch_all(&pool)
    .await
    .unwrap();
    // seed (0,0)@1 then the three transitions in order.
    let new_states: Vec<i16> = rows.iter().map(|r| r.1).collect();
    assert_eq!(new_states, vec![0, 1, 4, 5], "ordered transition history");
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_asset_current_state_updated(pool: PgPool) {
    route(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await;
    route(&pool, &ev("asset", "AssetStateChangedEvent", "0xs1", "0", 2, json!({"asset_id":"0xA","old_state":0,"new_state":1}))).await;
    route(&pool, &ev("asset", "AssetStateChangedEvent", "0xs2", "0", 3, json!({"asset_id":"0xA","old_state":1,"new_state":5}))).await;

    let state: (i16,) = sqlx::query_as("SELECT current_state FROM assets WHERE asset_id = $1")
        .bind("0xA")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(state.0, 5, "current_state reflects the latest transition");
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_raise_finalized_sets_accumulator(pool: PgPool) {
    route(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await;
    route(
        &pool,
        &ev("asset", "RaiseFinalizedEvent", "0xf", "0", 2,
            json!({ "asset_id": "0xA", "accumulator_id": "0xACC", "total_shares": "100000000000" })),
    )
    .await;

    let acc: (Option<String>,) =
        sqlx::query_as("SELECT accumulator_id FROM assets WHERE asset_id = $1")
            .bind("0xA")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(acc.0, Some("0xACC".to_string()));
}

/// Regression guard for the §10.2 wire rule: `funding_goal` arriving as the JSON string
/// `"1000000000"` must deserialize and store as the integer `1_000_000_000`.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_u64_fields_deserialize_from_string(pool: PgPool) {
    let payload = json!({
        "asset_id": "0xSTR", "entity": "0xE",
        "funding_goal": "1000000000", "funding_deadline_ms": "1750000000000",
        "tranche_count": "1", "revenue_split_bps": "5000", "collateral": "10000000000"
    });
    route(&pool, &ev("asset", "AssetCreatedEvent", "0xtx", "0", 1, payload)).await;

    let goal: (i64,) = sqlx::query_as("SELECT goal FROM assets WHERE asset_id = $1")
        .bind("0xSTR")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(goal.0, 1_000_000_000, "string u64 parsed to integer");
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_asset_closed_sets_reason(pool: PgPool) {
    route(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await;
    route(&pool, &ev("asset", "AssetClosedEvent", "0xcl", "0", 2, json!({ "asset_id": "0xA", "reason": 1 }))).await;

    let row: (Option<i16>, i16) =
        sqlx::query_as("SELECT close_reason, current_state FROM assets WHERE asset_id = $1")
            .bind("0xA")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row.0, Some(1), "close_reason set from AssetClosedEvent.reason");
    assert_eq!(row.1, 0, "AssetClosed does not move current_state (that arrives via state-change)");
}

// ---------------------------------------------------------------------------
// BI-M2 — governance
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_governance_param_change_stored(pool: PgPool) {
    route(
        &pool,
        &ev("protocol", "ProtocolParamChangedEvent", "0xg", "0", 5,
            json!({ "name": "challenger_bond", "old_value": "1000000", "new_value": "2000000" })),
    )
    .await;

    let row: (String, Option<String>, Option<i64>, Option<i64>) = sqlx::query_as(
        "SELECT event_type, param_name, old_value, new_value FROM governance_events",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0, "ProtocolParamChanged", "event_type normalized (no Event suffix)");
    assert_eq!(row.1, Some("challenger_bond".to_string()));
    assert_eq!(row.2, Some(1_000_000));
    assert_eq!(row.3, Some(2_000_000));
}

/// Replaying the same events twice yields the same final DB state — no duplicate rows (R6).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_idempotent_replay(pool: PgPool) {
    let batch = vec![
        ev("protocol", "ProtocolInitializedEvent", "0xi", "0", 1, json!({"config_id":"0xCFG","admin":"0xADM"})),
        ev("asset", "AssetCreatedEvent", "0xc", "0", 2, asset_created("0xA", "0xE", "1000000000")),
        ev("asset", "AssetVouchedEvent", "0xv", "0", 3, json!({"asset_id":"0xA","pool_id":"0xP","validator":"0xV","coverage":"500","doc_hashes":[]})),
        ev("asset", "AssetStateChangedEvent", "0xs", "0", 4, json!({"asset_id":"0xA","old_state":0,"new_state":1})),
        ev("asset", "RaiseFinalizedEvent", "0xf", "0", 5, json!({"asset_id":"0xA","accumulator_id":"0xACC","total_shares":"100"})),
    ];
    for _ in 0..2 {
        for e in &batch {
            route(&pool, e).await;
        }
    }

    let counts = |label: &'static str, sql: &'static str| {
        let pool = pool.clone();
        async move {
            let c: (i64,) = sqlx::query_as(sql).fetch_one(&pool).await.unwrap();
            (label, c.0)
        }
    };
    assert_eq!(counts("assets", "SELECT count(*) FROM assets").await.1, 1);
    // 1 seed (0→0) + 1 transition (0→1); the replay must not duplicate either.
    assert_eq!(counts("state_changes", "SELECT count(*) FROM asset_state_changes").await.1, 2);
    assert_eq!(counts("governance", "SELECT count(*) FROM governance_events").await.1, 1);

    let final_row: (i16, Option<String>, Option<i64>) =
        sqlx::query_as("SELECT current_state, accumulator_id, coverage FROM assets WHERE asset_id=$1")
            .bind("0xA")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(final_row, (1, Some("0xACC".to_string()), Some(500)));
}

/// `short_event_name` strips the `<pkg>::<module>::` prefix.
#[test]
fn test_short_event_name() {
    assert_eq!(
        ingestion::short_event_name("0xpkg::asset::AssetCreatedEvent"),
        "AssetCreatedEvent"
    );
}

/// Replay **real `parsedJson` payloads captured from a live `gally_core` node** (chain
/// `0b7e184d`, the SIM-M4 soak) through the production ingestion path. This is the live-data
/// counterpart to the synthetic fixtures above: it guards the §10.2 wire forms exactly as the
/// fullnode emits them (string `u64`, numeric `u8`, `doc_hashes` as `[[9,9,9,9]]`).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_real_onchain_payloads_replay(pool: PgPool) {
    // Verbatim parsedJson from suix_queryEvents on the live node.
    route(&pool, &ev("protocol", "ProtocolInitializedEvent", "Cz2G5JBmKJR9", "0", 1, json!({
        "admin": "0xdcd6a95c5b011b880fc76e663358ec4fa4e7665488d14c673c4e25593edbf362",
        "config_id": "0x91ea349c1a3cd2cb53489bff64407dbe884e7aec824b542816bde83832925390"
    }))).await;
    route(&pool, &ev("protocol", "ProtocolParamChangedEvent", "Dej9NnmhbKy3", "0", 2, json!({
        "name": "challenger_bond", "new_value": "1000000000", "old_value": "1000000000"
    }))).await;
    route(&pool, &ev("protocol", "EmergencyStopTriggeredEvent", "2ZtkzcnQGY4y", "0", 3, json!({
        "config_id": "0x91ea349c1a3cd2cb53489bff64407dbe884e7aec824b542816bde83832925390"
    }))).await;
    route(&pool, &ev("asset", "AssetCreatedEvent", "Anx8Uvfjp1rf", "0", 4, json!({
        "asset_id": "0x0ac5eebc025922a4bed2ab117a7e4b234f63aecadc673e5fcccfee72bcdddc09",
        "collateral": "10000000000", "entity": "0xdcd6a95c5b011b880fc76e663358ec4fa4e7665488d14c673c4e25593edbf362",
        "funding_deadline_ms": "4102444800000", "funding_goal": "100000000000",
        "revenue_split_bps": "5000", "tranche_count": "1"
    }))).await;
    route(&pool, &ev("asset", "AssetVouchedEvent", "F2ZsyHnZHk3h", "0", 5, json!({
        "asset_id": "0x0ac5eebc025922a4bed2ab117a7e4b234f63aecadc673e5fcccfee72bcdddc09",
        "coverage": "20000000000", "doc_hashes": [[9, 9, 9, 9]],
        "pool_id": "0x082f683c9429baee0642e200380e439545438518dfbc320729c8d0ff3599d671",
        "validator": "0xdcd6a95c5b011b880fc76e663358ec4fa4e7665488d14c673c4e25593edbf362"
    }))).await;
    route(&pool, &ev("asset", "RaiseFinalizedEvent", "9zHqDWxEiPG7", "0", 6, json!({
        "accumulator_id": "0xde40806f8d436d3cb704f1d239201af41f972c90aff794b59d212e5a63f6fdd5",
        "asset_id": "0x0ac5eebc025922a4bed2ab117a7e4b234f63aecadc673e5fcccfee72bcdddc09",
        "total_shares": "100000000000"
    }))).await;

    let asset: (i64, i64, Option<i64>, Option<String>) = sqlx::query_as(
        "SELECT goal, collateral, coverage, accumulator_id FROM assets WHERE asset_id = $1",
    )
    .bind("0x0ac5eebc025922a4bed2ab117a7e4b234f63aecadc673e5fcccfee72bcdddc09")
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(asset.0, 100_000_000_000, "real funding_goal string parsed");
    assert_eq!(asset.1, 10_000_000_000, "real collateral string parsed");
    assert_eq!(asset.2, Some(20_000_000_000), "real coverage from vouch");
    assert_eq!(
        asset.3,
        Some("0xde40806f8d436d3cb704f1d239201af41f972c90aff794b59d212e5a63f6fdd5".to_string())
    );

    let gov: (i64,) = sqlx::query_as("SELECT count(*) FROM governance_events")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(gov.0, 3, "three real governance events ingested");
}

// ---------------------------------------------------------------------------
// BI-M3 — validator registry
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_validator_registered(pool: PgPool) {
    route(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xvr", "0", 1,
        json!({ "pool_id": "0xPOOL", "validator": "0xVAL", "stake": "5000000000" }))).await;

    let row: (String, i64, i16) =
        sqlx::query_as("SELECT validator, initial_stake, current_status FROM validator_pools WHERE pool_id = $1")
            .bind("0xPOOL")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row, ("0xVAL".to_string(), 5_000_000_000, 0));
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_stake_added_series(pool: PgPool) {
    route(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xvr", "0", 1,
        json!({ "pool_id": "0xPOOL", "validator": "0xVAL", "stake": "5000000000" }))).await;
    // Three deposits; stake_after climbs.
    let adds = [("0xa1", "1000000000", "6000000000", 10i64), ("0xa2", "2000000000", "8000000000", 20), ("0xa3", "500000000", "8500000000", 30)];
    for (tx, amt, after, ts) in adds {
        route(&pool, &ev("validator", "StakeAddedEvent", tx, "0", ts,
            json!({ "pool_id": "0xPOOL", "depositor": "0xDEP", "amount": amt, "stake_after": after }))).await;
    }

    let rows: Vec<(String, i64, i64, Option<String>)> = sqlx::query_as(
        "SELECT event_type, amount, stake_after, depositor FROM validator_stake_events \
         WHERE pool_id = $1 ORDER BY timestamp_ms ASC, id ASC",
    )
    .bind("0xPOOL")
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 3, "three stake-added rows");
    assert!(rows.iter().all(|r| r.0 == "added" && r.3 == Some("0xDEP".to_string())));
    let after: Vec<i64> = rows.iter().map(|r| r.2).collect();
    assert_eq!(after, vec![6_000_000_000, 8_000_000_000, 8_500_000_000], "stake_after time-series");
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_status_frozen_then_slashed(pool: PgPool) {
    route(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xvr", "0", 1,
        json!({ "pool_id": "0xPOOL", "validator": "0xVAL", "stake": "5000000000" }))).await;
    // ACTIVE(0) → FROZEN(1) → SLASHED(2), the second carrying a dispute_id.
    route(&pool, &ev("validator", "ValidatorStatusChangedEvent", "0xs1", "0", 10,
        json!({ "pool_id": "0xPOOL", "old_status": 0, "new_status": 1, "dispute_id": null }))).await;
    route(&pool, &ev("validator", "ValidatorStatusChangedEvent", "0xs2", "0", 20,
        json!({ "pool_id": "0xPOOL", "old_status": 1, "new_status": 2, "dispute_id": "0xDISP" }))).await;

    let cur: (i16,) = sqlx::query_as("SELECT current_status FROM validator_pools WHERE pool_id = $1")
        .bind("0xPOOL")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(cur.0, 2, "current_status reflects latest (SLASHED)");

    let rows: Vec<(i16, i16, Option<String>)> = sqlx::query_as(
        "SELECT old_status, new_status, dispute_id FROM validator_status_changes \
         WHERE pool_id = $1 ORDER BY timestamp_ms ASC, id ASC",
    )
    .bind("0xPOOL")
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows, vec![(0, 1, None), (1, 2, Some("0xDISP".to_string()))]);
}

// ---------------------------------------------------------------------------
// BI-M3 — position ledger
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_capital_contributed_raise_progress(pool: PgPool) {
    route(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await;
    route(&pool, &ev("asset", "CapitalContributedEvent", "0xcc", "0", 5,
        json!({ "asset_id": "0xA", "contributor": "0xINV", "amount": "300000000", "raised_after": "300000000" }))).await;

    let row: (String, i64, i64) =
        sqlx::query_as("SELECT contributor, amount, raised_after FROM raise_progress WHERE asset_id = $1")
            .bind("0xA")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row, ("0xINV".to_string(), 300_000_000, 300_000_000));
    // CapitalContributed does NOT land in position_events (raise_progress feed only, §4).
    let pe: (i64,) = sqlx::query_as("SELECT count(*) FROM position_events").fetch_one(&pool).await.unwrap();
    assert_eq!(pe.0, 0);
}

/// `index_at_claim` is a u128 — stored as NUMERIC(39,0) with no precision loss (use u128::MAX).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_position_yield_claimed(pool: PgPool) {
    route(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await;
    let big = "340282366920938463463374607431768211455"; // u128::MAX, 39 digits
    route(&pool, &ev("accumulator", "YieldClaimedEvent", "0xyc", "0", 5,
        json!({ "asset_id": "0xA", "holder": "0xH", "amount": "12345", "index_at_claim": big }))).await;

    let row: (String, Option<i64>, Option<String>) = sqlx::query_as(
        "SELECT actor, amount, index_at_claim::text FROM position_events WHERE event_type = 'YieldClaimed'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0, "0xH");
    assert_eq!(row.1, Some(12_345));
    assert_eq!(row.2, Some(big.to_string()), "u128 index round-trips exactly via NUMERIC");
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_position_wrap_unwrap_cycle(pool: PgPool) {
    route(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await;
    route(&pool, &ev("accumulator", "SharesWrappedEvent", "0xw", "0", 10,
        json!({ "asset_id": "0xA", "holder": "0xH", "count": "400", "total_wrapped_after": "400" }))).await;
    route(&pool, &ev("accumulator", "SharesUnwrappedEvent", "0xu", "0", 20,
        json!({ "asset_id": "0xA", "holder": "0xH", "count": "150", "share_object_id": "0xSHARE", "total_wrapped_after": "250" }))).await;

    let rows: Vec<PositionRow> = sqlx::query_as(
        "SELECT event_type, amount, total_wrapped_after, share_object_id FROM position_events \
         WHERE actor = $1 ORDER BY timestamp_ms ASC, id ASC",
    )
    .bind("0xH")
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0], ("SharesWrapped".to_string(), Some(400), Some(400), None));
    assert_eq!(rows[1], ("SharesUnwrapped".to_string(), Some(150), Some(250), Some("0xSHARE".to_string())));
}

// ---------------------------------------------------------------------------
// BI-M4 — yield index
// ---------------------------------------------------------------------------

/// `index_after` is a u128 — stored as NUMERIC(39,0) with no precision loss (use u128::MAX). The
/// revenue split columns are persisted; rollover/compensation leave them NULL.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_revenue_deposited_index_precision(pool: PgPool) {
    route(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await;
    let big = "340282366920938463463374607431768211455"; // u128::MAX, 39 digits
    route(&pool, &ev("asset", "RevenueDepositedEvent", "0xrev", "0", 10, json!({
        "asset_id": "0xA", "gross": "10000000", "fee": "100000",
        "investor_portion": "7000000", "entity_portion": "2900000",
        "index_after": big, "unwrapped_supply": "1000000"
    }))).await;

    let row: RevenueRow = sqlx::query_as(
        "SELECT event_type, gross, fee, investor_portion, entity_portion, index_after::text, \
         unwrapped_supply FROM yield_index_series WHERE asset_id = $1",
    )
    .bind("0xA")
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0, "revenue");
    assert_eq!(row.1, Some(10_000_000));
    assert_eq!(row.2, Some(100_000));
    assert_eq!(row.3, Some(7_000_000));
    assert_eq!(row.4, Some(2_900_000));
    assert_eq!(row.5, big.to_string(), "u128 index round-trips exactly via NUMERIC");
    assert_eq!(row.6, 1_000_000);
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_rollover_event_stored(pool: PgPool) {
    route(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await;
    route(&pool, &ev("accumulator", "RolloverSweptEvent", "0xro", "0", 10, json!({
        "asset_id": "0xA", "amount": "500000", "index_after": "8000000000", "unwrapped_supply": "1000000"
    }))).await;

    let row: (String, Option<i64>, String, Option<bool>) = sqlx::query_as(
        "SELECT event_type, gross, index_after::text, routed_to_rollover FROM yield_index_series WHERE asset_id = $1",
    )
    .bind("0xA")
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0, "rollover", "event_type tagged rollover");
    assert_eq!(row.1, None, "revenue split columns NULL for rollover");
    assert_eq!(row.2, "8000000000");
    assert_eq!(row.3, None);
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_compensation_event_stored(pool: PgPool) {
    route(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await;
    route(&pool, &ev("accumulator", "CompensationSweptEvent", "0xco", "0", 10, json!({
        "asset_id": "0xA", "amount": "500000", "index_after": "9000000000",
        "unwrapped_supply": "1000000", "routed_to_rollover": false
    }))).await;

    let row: (String, Option<bool>) =
        sqlx::query_as("SELECT event_type, routed_to_rollover FROM yield_index_series WHERE asset_id = $1")
            .bind("0xA")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row.0, "compensation", "event_type tagged compensation");
    assert_eq!(row.1, Some(false));
}

/// `CompensationSweptEvent.routed_to_rollover = true` is persisted (regression for the §10.1 extra
/// field).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_compensation_routed_to_rollover(pool: PgPool) {
    route(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await;
    route(&pool, &ev("accumulator", "CompensationSweptEvent", "0xco", "0", 10, json!({
        "asset_id": "0xA", "amount": "500000", "index_after": "9000000000",
        "unwrapped_supply": "1000000", "routed_to_rollover": true
    }))).await;

    let routed: (Option<bool>,) =
        sqlx::query_as("SELECT routed_to_rollover FROM yield_index_series WHERE asset_id = $1")
            .bind("0xA")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(routed.0, Some(true), "routed_to_rollover flag stored");
}

// ---------------------------------------------------------------------------
// BI-M4 — tranches
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_tranche_proof_then_approved_then_released(pool: PgPool) {
    route(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await;
    // tranche 0: proof (byte-array hashes) → approved → released.
    route(&pool, &ev("asset", "MilestoneProofSubmittedEvent", "0xt1", "0", 10, json!({
        "asset_id": "0xA", "tranche": "0", "blob_id": [222, 173], "sha256": [190, 239]
    }))).await;
    route(&pool, &ev("asset", "MilestoneApprovedEvent", "0xt2", "0", 20, json!({
        "asset_id": "0xA", "tranche": "0", "validator": "0xVAL", "pool_id": "0xPOOL"
    }))).await;
    route(&pool, &ev("asset", "TrancheReleasedEvent", "0xt3", "0", 30, json!({
        "asset_id": "0xA", "tranche": "0", "amount": "250000000", "escrow_after": "750000000"
    }))).await;

    let rows: Vec<TrancheRow> = sqlx::query_as(
        "SELECT event_type, tranche_index, blob_id, sha256, validator, amount FROM tranche_events \
         WHERE asset_id = $1 ORDER BY tranche_index ASC, id ASC",
    )
    .bind("0xA")
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 3, "three tranche events for tranche 0");
    assert_eq!(rows[0].0, "proof_submitted");
    assert_eq!(rows[0].1, 0);
    assert_eq!(rows[0].2, Some("dead".to_string()), "blob_id hex-encoded");
    assert_eq!(rows[0].3, Some("beef".to_string()), "sha256 hex-encoded");
    assert_eq!(rows[1].0, "approved");
    assert_eq!(rows[1].4, Some("0xVAL".to_string()));
    assert_eq!(rows[2].0, "released");
    assert_eq!(rows[2].5, Some(250_000_000));
}

// ---------------------------------------------------------------------------
// BI-M4 — disputes
// ---------------------------------------------------------------------------

/// Seed an asset + validator pool so the dispute FKs (`asset_id`, `target_pool_id`) resolve.
async fn seed_asset_and_pool(pool: &PgPool) {
    route(pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await;
    route(pool, &ev("validator", "ValidatorRegisteredEvent", "0xvr", "0", 2,
        json!({ "pool_id": "0xPOOL", "validator": "0xVAL", "stake": "5000000000" }))).await;
}

/// DisputeOpened + 3 JurorVoted + DisputeResolved(UPHELD) → one `disputes` row, verdict=1, the
/// resolution columns set, and 3 `jury_votes` rows.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_dispute_lifecycle_upheld(pool: PgPool) {
    seed_asset_and_pool(&pool).await;
    route(&pool, &ev("dispute", "DisputeOpenedEvent", "0xd0", "0", 10, json!({
        "dispute_id": "0xD", "asset_id": "0xA", "target_pool_id": "0xPOOL",
        "challenger": "0xCH", "bond": "1000000", "evidence_sha256": [1, 2, 3, 4]
    }))).await;
    for (i, (juror, guilty, g, n)) in [("0xJ1", true, "1", "0"), ("0xJ2", true, "2", "0"), ("0xJ3", false, "2", "1")].iter().enumerate() {
        route(&pool, &ev("dispute", "JurorVotedEvent", &format!("0xv{i}"), "0", 20 + i as i64, json!({
            "dispute_id": "0xD", "juror_pool_id": juror, "guilty": guilty,
            "votes_guilty_after": g, "votes_innocent_after": n
        }))).await;
    }
    route(&pool, &ev("dispute", "DisputeResolvedEvent", "0xdr", "0", 40, json!({
        "dispute_id": "0xD", "asset_id": "0xA", "target_pool_id": "0xPOOL",
        "verdict": 1, "slashed": "2000000000", "bounty": "1000000000", "challenger": "0xCH"
    }))).await;

    let d: (Option<i16>, Option<i64>, Option<i64>, Option<i64>, String) = sqlx::query_as(
        "SELECT verdict, slashed, bounty, resolved_at_ms, evidence_hash FROM disputes WHERE dispute_id = $1",
    )
    .bind("0xD")
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(d.0, Some(1), "UPHELD verdict");
    assert_eq!(d.1, Some(2_000_000_000), "slashed");
    assert_eq!(d.2, Some(1_000_000_000), "bounty");
    assert_eq!(d.3, Some(40), "resolved_at_ms");
    assert_eq!(d.4, "01020304", "evidence_sha256 hex-encoded into evidence_hash");

    let votes: (i64,) = sqlx::query_as("SELECT count(*) FROM jury_votes WHERE dispute_id = $1")
        .bind("0xD")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(votes.0, 3, "three jury votes recorded");
}

/// Same flow with a REJECTED verdict → verdict=2.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_dispute_lifecycle_rejected(pool: PgPool) {
    seed_asset_and_pool(&pool).await;
    route(&pool, &ev("dispute", "DisputeOpenedEvent", "0xd0", "0", 10, json!({
        "dispute_id": "0xD", "asset_id": "0xA", "target_pool_id": "0xPOOL",
        "challenger": "0xCH", "bond": "1000000", "evidence_sha256": [9]
    }))).await;
    route(&pool, &ev("dispute", "DisputeResolvedEvent", "0xdr", "0", 40, json!({
        "dispute_id": "0xD", "asset_id": "0xA", "target_pool_id": "0xPOOL",
        "verdict": 2, "slashed": "0", "bounty": "0", "challenger": "0xCH"
    }))).await;

    let verdict: (Option<i16>,) = sqlx::query_as("SELECT verdict FROM disputes WHERE dispute_id = $1")
        .bind("0xD")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(verdict.0, Some(2), "REJECTED verdict");
}

/// JurorRewardClaimed → `juror_rewards`; DustSwept → `dust_sweeps`. Regression guard for the two
/// code-only events absent from `protocol_flow.md §18.3` (§10.1).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_juror_reward_and_dust_swept_stored(pool: PgPool) {
    seed_asset_and_pool(&pool).await;
    route(&pool, &ev("dispute", "DisputeOpenedEvent", "0xd0", "0", 10, json!({
        "dispute_id": "0xD", "asset_id": "0xA", "target_pool_id": "0xPOOL",
        "challenger": "0xCH", "bond": "1000000", "evidence_sha256": [1]
    }))).await;
    route(&pool, &ev("dispute", "JurorRewardClaimedEvent", "0xjr", "0", 50, json!({
        "dispute_id": "0xD", "juror_pool_id": "0xJ1", "amount": "333333"
    }))).await;
    route(&pool, &ev("accumulator", "DustSweptEvent", "0xds", "0", 60, json!({
        "asset_id": "0xA", "amount": "7"
    }))).await;

    let reward: (String, i64) =
        sqlx::query_as("SELECT juror_pool_id, amount FROM juror_rewards WHERE dispute_id = $1")
            .bind("0xD")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(reward, ("0xJ1".to_string(), 333_333));

    let dust: (i64,) = sqlx::query_as("SELECT amount FROM dust_sweeps WHERE asset_id = $1")
        .bind("0xA")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(dust.0, 7);
}

/// Feeding a fixture containing **all 36** known event types (`logic_flow.md §10.3`) produces zero
/// "unhandled" results — `route_event` returns `Ok(true)` for every one (it returns `Ok(false)`
/// exactly when it would `warn!` for an unhandled type, R7). FK order: pool + asset + dispute first.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_no_unhandled_event_types(pool: PgPool) {
    // (module, struct, payload) in dependency order. AssetCreated makes 0xA; ValidatorRegistered
    // makes 0xPOOL; DisputeOpened makes 0xD — everything FK-ing those comes after.
    let big = "340282366920938463463374607431768211455";
    let events: Vec<(&str, &str, Value)> = vec![
        ("protocol", "ProtocolInitializedEvent", json!({"config_id":"0xCFG","admin":"0xADM"})),
        ("protocol", "ProtocolParamChangedEvent", json!({"name":"min_stake","old_value":"1","new_value":"2"})),
        ("protocol", "ProtocolTreasuryChangedEvent", json!({"old_treasury":"0xT1","new_treasury":"0xT2"})),
        ("protocol", "EmergencyStopTriggeredEvent", json!({"config_id":"0xCFG"})),
        ("protocol", "ProtocolResumedEvent", json!({"config_id":"0xCFG"})),
        ("validator", "ValidatorRegisteredEvent", json!({"pool_id":"0xPOOL","validator":"0xVAL","stake":"5000000000"})),
        ("asset", "AssetCreatedEvent", asset_created("0xA", "0xE", "1000000000")),
        ("asset", "AssetStateChangedEvent", json!({"asset_id":"0xA","old_state":0,"new_state":1})),
        ("asset", "AssetVouchedEvent", json!({"asset_id":"0xA","pool_id":"0xPOOL","validator":"0xVAL","coverage":"20000000000","doc_hashes":[[9,9,9]]})),
        ("asset", "AssetCancelledEvent", json!({"asset_id":"0xA"})),
        ("asset", "CapitalContributedEvent", json!({"asset_id":"0xA","contributor":"0xINV","amount":"100","raised_after":"100"})),
        ("asset", "RaiseFinalizedEvent", json!({"asset_id":"0xA","accumulator_id":"0xACC","total_shares":"1000000000"})),
        ("asset", "RaiseAbortedEvent", json!({"asset_id":"0xA","raised":"100"})),
        ("asset", "ContributionRefundedEvent", json!({"asset_id":"0xA","contributor":"0xINV","amount":"100"})),
        ("asset", "SharesClaimedEvent", json!({"asset_id":"0xA","holder":"0xH","count":"100","share_object_id":"0xSH"})),
        ("asset", "MilestoneProofSubmittedEvent", json!({"asset_id":"0xA","tranche":"0","blob_id":[1],"sha256":[2]})),
        ("asset", "MilestoneApprovedEvent", json!({"asset_id":"0xA","tranche":"0","validator":"0xVAL","pool_id":"0xPOOL"})),
        ("asset", "TrancheReleasedEvent", json!({"asset_id":"0xA","tranche":"0","amount":"10","escrow_after":"90"})),
        ("asset", "AssetOperationalEvent", json!({"asset_id":"0xA","accumulator_id":"0xACC"})),
        ("asset", "EntityDefaultedEvent", json!({"asset_id":"0xA","tranche_missed":"1","collateral_seized":"5","escrow_seized":"5"})),
        ("asset", "AssetClosedEvent", json!({"asset_id":"0xA","reason":1})),
        ("asset", "RevenueDepositedEvent", json!({"asset_id":"0xA","gross":"10","fee":"1","investor_portion":"7","entity_portion":"2","index_after":big,"unwrapped_supply":"100"})),
        ("validator", "StakeAddedEvent", json!({"pool_id":"0xPOOL","depositor":"0xDEP","amount":"1","stake_after":"5000000001"})),
        ("validator", "StakeWithdrawnEvent", json!({"pool_id":"0xPOOL","validator":"0xVAL","amount":"1","stake_after":"5000000000"})),
        ("validator", "ValidatorStatusChangedEvent", json!({"pool_id":"0xPOOL","old_status":0,"new_status":1,"dispute_id":null})),
        ("accumulator", "RolloverSweptEvent", json!({"asset_id":"0xA","amount":"5","index_after":"8000000000","unwrapped_supply":"100"})),
        ("accumulator", "YieldClaimedEvent", json!({"asset_id":"0xA","holder":"0xH","amount":"5","index_at_claim":"7000000000"})),
        ("accumulator", "CompensationSweptEvent", json!({"asset_id":"0xA","amount":"5","index_after":"9000000000","unwrapped_supply":"100","routed_to_rollover":false})),
        ("accumulator", "SharesWrappedEvent", json!({"asset_id":"0xA","holder":"0xH","count":"10","total_wrapped_after":"10"})),
        ("accumulator", "SharesUnwrappedEvent", json!({"asset_id":"0xA","holder":"0xH","count":"5","share_object_id":"0xSH","total_wrapped_after":"5"})),
        ("accumulator", "ShareRedeemedEvent", json!({"asset_id":"0xA","holder":"0xH","count":"5","total_minted_after":"999999995"})),
        ("accumulator", "DustSweptEvent", json!({"asset_id":"0xA","amount":"3"})),
        ("dispute", "DisputeOpenedEvent", json!({"dispute_id":"0xD","asset_id":"0xA","target_pool_id":"0xPOOL","challenger":"0xCH","bond":"1000000","evidence_sha256":[1,2]})),
        ("dispute", "JurorVotedEvent", json!({"dispute_id":"0xD","juror_pool_id":"0xJ1","guilty":true,"votes_guilty_after":"1","votes_innocent_after":"0"})),
        ("dispute", "DisputeResolvedEvent", json!({"dispute_id":"0xD","asset_id":"0xA","target_pool_id":"0xPOOL","verdict":2,"slashed":"0","bounty":"0","challenger":"0xCH"})),
        ("dispute", "JurorRewardClaimedEvent", json!({"dispute_id":"0xD","juror_pool_id":"0xJ1","amount":"500"})),
    ];
    assert_eq!(events.len(), 36, "fixture covers all 36 event types (§10.3)");

    for (i, (module, struct_name, payload)) in events.iter().enumerate() {
        let e = ev(module, struct_name, &format!("0xall{i}"), "0", 100 + i as i64, payload.clone());
        let handled = route_event(&pool, &e).await.expect("handler must not error");
        assert!(handled, "{struct_name} must be handled (no unhandled-event warning)");
    }
}

/// BI-M8: the backend reputation formula (`data_parity_plan.md §8.2`, LI-Q5) is a pure function of
/// the track record. No DB needed — exercises the clamp and the milestone cap directly.
#[test]
fn test_reputation_formula() {
    use gally_indexer::db::models::ValidatorTrackRecord;
    use gally_indexer::db::queries::compute_reputation;

    // 50 + min(30, 2*8)=16 + 3*(10-1)=27 - 25*0 - 5*1=5 → 88.
    let good = ValidatorTrackRecord {
        assets_vouched: 10,
        milestones_approved: 8,
        assets_defaulted: 1,
        disputes_filed_against: 1,
        disputes_upheld: 0,
    };
    assert_eq!(compute_reputation(&good), 88);

    // 50 + 0 + 3*(2-2)=0 - 25*3=75 - 5*3=15 → -40 → clamped to 0.
    let bad = ValidatorTrackRecord {
        assets_vouched: 2,
        milestones_approved: 0,
        assets_defaulted: 2,
        disputes_filed_against: 3,
        disputes_upheld: 3,
    };
    assert_eq!(compute_reputation(&bad), 0);

    // Milestone bonus caps at +30 → 50 + 30 = 80.
    let capped = ValidatorTrackRecord {
        assets_vouched: 0,
        milestones_approved: 100,
        assets_defaulted: 0,
        disputes_filed_against: 0,
        disputes_upheld: 0,
    };
    assert_eq!(compute_reputation(&capped), 80);

    // Empty record → base 50.
    let empty = ValidatorTrackRecord {
        assets_vouched: 0,
        milestones_approved: 0,
        assets_defaulted: 0,
        disputes_filed_against: 0,
        disputes_upheld: 0,
    };
    assert_eq!(compute_reputation(&empty), 50);
}
