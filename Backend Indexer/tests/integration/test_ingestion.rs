//! BI-M1 integration tests: migrations, cursor read/write, idempotent raw-event upsert,
//! the dispatch stub, and the `/health` endpoint. All DB tests use `#[sqlx::test]`, which
//! creates a fresh database per test from `DATABASE_URL`.

use gally_indexer::{api, db, ingestion};
use serde_json::json;
use sqlx::PgPool;

/// Helper: does a table exist in the current database?
async fn table_exists(pool: &PgPool, name: &str) -> bool {
    let row: (bool,) = sqlx::query_as(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
    )
    .bind(name)
    .fetch_one(pool)
    .await
    .unwrap();
    row.0
}

/// Running migrations against a fresh DB succeeds and creates the BI-M1 tables.
#[sqlx::test]
async fn test_migrations_run(pool: PgPool) {
    db::run_migrations(&pool).await.expect("migrations should apply");
    assert!(table_exists(&pool, "indexer_cursor").await, "indexer_cursor created");
    assert!(table_exists(&pool, "raw_events").await, "raw_events created");
}

/// On a fresh DB, the cursor reads back as 0.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_cursor_init_zero(pool: PgPool) {
    let cursor = db::queries::read_cursor(&pool).await.unwrap();
    assert_eq!(cursor, 0);
}

/// Writing the cursor and reading it back round-trips (the restart-resume mechanism).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_cursor_write_read(pool: PgPool) {
    db::queries::write_cursor(&pool, 42).await.unwrap();
    let cursor = db::queries::read_cursor(&pool).await.unwrap();
    assert_eq!(cursor, 42);
}

/// Inserting the same `(tx_digest, event_seq)` twice yields exactly one row (idempotent).
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

/// Feeding an unrecognized event type through the dispatch stub logs a warning and does not
/// panic (BI-M1 has no handlers, so every type is unhandled).
#[test]
fn test_unknown_event_type_does_not_panic() {
    let handled = ingestion::dispatch("0xpkg::mystery::UnknownEvent");
    assert!(!handled, "no event type is handled in the BI-M1 skeleton");
}

/// Spinning up the Axum app and hitting `GET /health` returns HTTP 200 with the cursor.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_health_endpoint_returns_200(pool: PgPool) {
    let app = api::router(api::AppState { pool });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let resp = reqwest::Client::new()
        .get(format!("http://{addr}/health"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
    assert_eq!(body["cursor"], 0);
}
