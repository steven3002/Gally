//! Asset-lifecycle feed handlers (`asset` module — `logic_flow.md §2.4`, `§2.5`, `§10.3`).
//!
//! These populate `assets` (one row per project, plus its latest state) and
//! `asset_state_changes` (the full transition timeline). `CapitalContributed`, `RaiseAborted`,
//! and `EntityDefaulted` belong to later milestones; `AssetCancelled` is intentionally not
//! written here (the CANCELLED=3 state arrives via `AssetStateChangedEvent` — `§4`).

use anyhow::Result;
use serde_json::Value;
use sqlx::PgPool;

use crate::db::queries::{self, AccumulatorBalanceInsert};
use crate::ingestion::event_types::{
    AssetClosedEvent, AssetCreatedEvent, AssetOperationalEvent, AssetStateChangedEvent,
    AssetVouchedEvent, EntityDefaultedEvent, RaiseFinalizedEvent,
};
use crate::ingestion::handlers::EventMeta;

/// `AssetCreatedEvent` → insert the `assets` row (incl. BI-M8 metadata), persist the full declared
/// tranche schedule (LI-D8, so unreleased tranches are visible), **and** seed the initial
/// PENDING_VOUCH(0→0) row in `asset_state_changes` (create_asset emits no paired state-change
/// event — `§4`).
pub async fn handle_asset_created(pool: &PgPool, meta: &EventMeta, payload: &Value) -> Result<()> {
    let e: AssetCreatedEvent = serde_json::from_value(payload.clone())?;
    queries::insert_asset(pool, meta, &e).await?;
    queries::insert_tranche_schedule(pool, &e).await?;
    // Seed PENDING_VOUCH using the creation event's own (tx_digest, event_seq) idempotency key.
    queries::insert_state_change(pool, meta, &e.asset_id, 0, 0).await
}

/// `EntityDefaultedEvent` → fold the compensation-pool snapshot + grace window into
/// `accumulator_balances` (LI-D9, LI-Q6). DEFAULTED collapses into COMPENSATING via
/// `AssetStateChangedEvent` (§11.5); the seizure figures still have no typed column (archived in
/// `raw_events`), but the grace window is now indexable.
pub async fn handle_entity_defaulted(
    pool: &PgPool,
    meta: &EventMeta,
    payload: &Value,
) -> Result<()> {
    let e: EntityDefaultedEvent = serde_json::from_value(payload.clone())?;
    queries::insert_accumulator_balance(
        pool,
        meta,
        &AccumulatorBalanceInsert {
            asset_id: &e.asset_id,
            event_type: "EntityDefaulted",
            compensation_pool_after: Some(e.compensation_pool_after as i64),
            compensation_unlock_ms: Some(e.compensation_unlock_ms as i64),
            wrapping_frozen: Some(e.wrapping_frozen),
            ..Default::default()
        },
    )
    .await
}

/// `AssetVouchedEvent` → set `validator_pool_id` + `coverage` on the asset. `doc_hashes` is an
/// object-proxy read, not stored here (guard rail R8).
pub async fn handle_asset_vouched(pool: &PgPool, payload: &Value) -> Result<()> {
    let e: AssetVouchedEvent = serde_json::from_value(payload.clone())?;
    queries::update_asset_vouched(pool, &e).await
}

/// `AssetStateChangedEvent` → append the timeline row and advance `assets.current_state`. This
/// is the writer for every transition **after** creation (`logic_flow.md §11.1`).
pub async fn handle_asset_state_change(
    pool: &PgPool,
    meta: &EventMeta,
    payload: &Value,
) -> Result<()> {
    let e: AssetStateChangedEvent = serde_json::from_value(payload.clone())?;
    queries::apply_state_change(pool, meta, &e).await
}

/// `AssetClosedEvent` → record `close_reason` (u8). Does **not** touch `current_state` — the
/// move to CLOSED arrives via `AssetStateChangedEvent` (`§4`).
pub async fn handle_asset_closed(pool: &PgPool, payload: &Value) -> Result<()> {
    let e: AssetClosedEvent = serde_json::from_value(payload.clone())?;
    queries::update_asset_close_reason(pool, &e.asset_id, e.reason as i16).await
}

/// `AssetOperationalEvent` → record the accumulator id.
pub async fn handle_asset_operational(pool: &PgPool, payload: &Value) -> Result<()> {
    let e: AssetOperationalEvent = serde_json::from_value(payload.clone())?;
    queries::update_asset_accumulator(pool, &e.asset_id, &e.accumulator_id).await
}

/// `RaiseFinalizedEvent` → record the accumulator id (same column as `AssetOperationalEvent`, in
/// case the events arrive in a different order — `§4`).
pub async fn handle_raise_finalized(pool: &PgPool, payload: &Value) -> Result<()> {
    let e: RaiseFinalizedEvent = serde_json::from_value(payload.clone())?;
    queries::apply_raise_finalized(pool, &e).await
}
