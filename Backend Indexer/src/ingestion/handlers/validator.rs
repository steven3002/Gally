//! Validator registry feed handlers (`validator` module — `logic_flow.md §2.7–2.9`, `§10.3`,
//! status integers `§11.2`).
//!
//! `ValidatorRegistered` creates the pool (initial stake recorded inline, **no** stake-events
//! row). `StakeAdded`/`StakeWithdrawn` append to the stake time-series. `ValidatorStatusChanged`
//! appends to the status timeline and advances `validator_pools.current_status`.

use anyhow::Result;
use serde_json::Value;
use sqlx::PgPool;

use crate::db::queries;
use crate::ingestion::event_types::{
    StakeAddedEvent, StakeWithdrawnEvent, ValidatorRegisteredEvent, ValidatorStatusChangedEvent,
};
use crate::ingestion::handlers::EventMeta;

/// `ValidatorRegisteredEvent` → insert the `validator_pools` row.
pub async fn handle_validator_registered(
    pool: &PgPool,
    meta: &EventMeta,
    payload: &Value,
) -> Result<()> {
    let e: ValidatorRegisteredEvent = serde_json::from_value(payload.clone())?;
    queries::insert_validator_pool(pool, meta, &e).await
}

/// `StakeAddedEvent` → `validator_stake_events` row (`event_type = 'added'`, `depositor` set).
pub async fn handle_stake_added(pool: &PgPool, meta: &EventMeta, payload: &Value) -> Result<()> {
    let e: StakeAddedEvent = serde_json::from_value(payload.clone())?;
    queries::insert_stake_event(
        pool,
        meta,
        &e.pool_id,
        "added",
        Some(&e.depositor),
        e.amount as i64,
        e.stake_after as i64,
    )
    .await
}

/// `StakeWithdrawnEvent` → `validator_stake_events` row (`event_type = 'withdrawn'`; the actor is
/// the pool's `validator`).
pub async fn handle_stake_withdrawn(pool: &PgPool, meta: &EventMeta, payload: &Value) -> Result<()> {
    let e: StakeWithdrawnEvent = serde_json::from_value(payload.clone())?;
    queries::insert_stake_event(
        pool,
        meta,
        &e.pool_id,
        "withdrawn",
        Some(&e.validator),
        e.amount as i64,
        e.stake_after as i64,
    )
    .await
}

/// `ValidatorStatusChangedEvent` → append the status-change row and advance `current_status`.
pub async fn handle_validator_status(
    pool: &PgPool,
    meta: &EventMeta,
    payload: &Value,
) -> Result<()> {
    let e: ValidatorStatusChangedEvent = serde_json::from_value(payload.clone())?;
    queries::apply_status_change(
        pool,
        meta,
        &e.pool_id,
        e.old_status as i16,
        e.new_status as i16,
        e.dispute_id.as_deref(),
    )
    .await
}
