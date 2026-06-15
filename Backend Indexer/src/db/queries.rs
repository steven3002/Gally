//! SQLx queries. BI-M1: cursor read/write and idempotent raw-event upsert.

use anyhow::Result;
use serde_json::Value;
use sqlx::PgPool;

/// Read the singleton checkpoint cursor. Returns 0 on a fresh database (logic_flow.md §2.1).
pub async fn read_cursor(pool: &PgPool) -> Result<i64> {
    let row: Option<(i64,)> =
        sqlx::query_as("SELECT checkpoint_seq FROM indexer_cursor WHERE id = TRUE")
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|r| r.0).unwrap_or(0))
}

/// Read the persisted JSON-RPC backfill cursor (Sui EventID `{tx_digest, event_seq}`), if set.
pub async fn read_backfill_cursor(pool: &PgPool) -> Result<Option<(String, i32)>> {
    let row: Option<(Option<String>, Option<i32>)> = sqlx::query_as(
        "SELECT backfill_tx_digest, backfill_event_seq FROM indexer_cursor WHERE id = TRUE",
    )
    .fetch_optional(pool)
    .await?;
    Ok(match row {
        Some((Some(tx), Some(seq))) => Some((tx, seq)),
        _ => None,
    })
}

/// Persist the checkpoint cursor (singleton upsert). Leaves the backfill cursor untouched.
pub async fn write_cursor(pool: &PgPool, checkpoint_seq: i64) -> Result<()> {
    sqlx::query(
        "INSERT INTO indexer_cursor (id, checkpoint_seq, updated_at) VALUES (TRUE, $1, now()) \
         ON CONFLICT (id) DO UPDATE SET checkpoint_seq = EXCLUDED.checkpoint_seq, updated_at = now()",
    )
    .bind(checkpoint_seq)
    .execute(pool)
    .await?;
    Ok(())
}

/// Persist the JSON-RPC backfill cursor (Sui EventID) and the checkpoint high-watermark together.
pub async fn write_backfill_cursor(
    pool: &PgPool,
    checkpoint_seq: i64,
    tx_digest: &str,
    event_seq: i32,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO indexer_cursor \
            (id, checkpoint_seq, backfill_tx_digest, backfill_event_seq, updated_at) \
         VALUES (TRUE, $1, $2, $3, now()) \
         ON CONFLICT (id) DO UPDATE SET \
            checkpoint_seq = EXCLUDED.checkpoint_seq, \
            backfill_tx_digest = EXCLUDED.backfill_tx_digest, \
            backfill_event_seq = EXCLUDED.backfill_event_seq, \
            updated_at = now()",
    )
    .bind(checkpoint_seq)
    .bind(tx_digest)
    .bind(event_seq)
    .execute(pool)
    .await?;
    Ok(())
}

/// One event to archive in `raw_events`, keyed idempotently on `(tx_digest, event_seq)`.
pub struct RawEventInsert<'a> {
    pub tx_digest: &'a str,
    pub event_seq: i32,
    pub checkpoint_seq: i64,
    pub timestamp_ms: i64,
    pub event_type: &'a str,
    pub payload: &'a Value,
}

/// Idempotent insert. Returns `true` if a new row was inserted, `false` if it already existed.
pub async fn upsert_raw_event(pool: &PgPool, e: &RawEventInsert<'_>) -> Result<bool> {
    let payload_text = serde_json::to_string(e.payload)?;
    let res = sqlx::query(
        "INSERT INTO raw_events \
            (tx_digest, event_seq, checkpoint_seq, timestamp_ms, event_type, payload) \
         VALUES ($1, $2, $3, $4, $5, $6::jsonb) \
         ON CONFLICT (tx_digest, event_seq) DO NOTHING",
    )
    .bind(e.tx_digest)
    .bind(e.event_seq)
    .bind(e.checkpoint_seq)
    .bind(e.timestamp_ms)
    .bind(e.event_type)
    .bind(payload_text)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() == 1)
}
