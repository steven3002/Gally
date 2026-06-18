//! Yield-index event handlers (BI-M4): RevenueDeposited [`asset` module], RolloverSwept,
//! CompensationSwept, DustSwept [`accumulator` module] → `yield_index_series` / `dust_sweeps`
//! (`logic_flow.md §2.11`, `§2.16`, `§10.3`).
//!
//! The indexer stores raw values only — it never recomputes the index (`protocol_flow.md §15`).
//! `index_after` is the running cumulative index (u128) AFTER the event; the curve IS the
//! time-series (there is no denormalized index column on `assets`). RolloverSwept/CompensationSwept
//! carry an `amount` the `§2.11` schema does not materialize (retained in `raw_events`).

use anyhow::Result;
use serde_json::Value;
use sqlx::PgPool;

use crate::db::queries::{self, AccumulatorBalanceInsert, YieldIndexInsert};
use crate::ingestion::event_types::{
    CompensationSweptEvent, DustSweptEvent, RevenueDepositedEvent, RolloverSweptEvent,
};
use crate::ingestion::handlers::EventMeta;

/// Route one yield-index event (by `Event`-suffixed struct short name) into `yield_index_series`.
/// The stored `event_type` is `'revenue'` / `'rollover'` / `'compensation'` (`§2.11`).
pub async fn handle_yield_index(
    pool: &PgPool,
    meta: &EventMeta,
    short_name: &str,
    payload: &Value,
) -> Result<()> {
    match short_name {
        "RevenueDepositedEvent" => {
            let e: RevenueDepositedEvent = serde_json::from_value(payload.clone())?;
            queries::insert_yield_index(
                pool,
                meta,
                &YieldIndexInsert {
                    event_type: "revenue",
                    asset_id: &e.asset_id,
                    gross: Some(e.gross as i64),
                    fee: Some(e.fee as i64),
                    investor_portion: Some(e.investor_portion as i64),
                    entity_portion: Some(e.entity_portion as i64),
                    index_after: e.index_after,
                    unwrapped_supply: e.unwrapped_supply as i64,
                    ..Default::default()
                },
            )
            .await?;
            // BI-M8 (LI-D9): fold post-deposit pool balances.
            queries::insert_accumulator_balance(
                pool,
                meta,
                &AccumulatorBalanceInsert {
                    asset_id: &e.asset_id,
                    event_type: "RevenueDeposited",
                    reward_pool_after: Some(e.reward_pool_after as i64),
                    rollover_reserve_after: Some(e.rollover_reserve_after as i64),
                    ..Default::default()
                },
            )
            .await
        }
        "RolloverSweptEvent" => {
            let e: RolloverSweptEvent = serde_json::from_value(payload.clone())?;
            queries::insert_yield_index(
                pool,
                meta,
                &YieldIndexInsert {
                    event_type: "rollover",
                    asset_id: &e.asset_id,
                    index_after: e.index_after,
                    unwrapped_supply: e.unwrapped_supply as i64,
                    ..Default::default()
                },
            )
            .await?;
            queries::insert_accumulator_balance(
                pool,
                meta,
                &AccumulatorBalanceInsert {
                    asset_id: &e.asset_id,
                    event_type: "RolloverSwept",
                    reward_pool_after: Some(e.reward_pool_after as i64),
                    rollover_reserve_after: Some(e.rollover_reserve_after as i64),
                    ..Default::default()
                },
            )
            .await
        }
        "CompensationSweptEvent" => {
            let e: CompensationSweptEvent = serde_json::from_value(payload.clone())?;
            queries::insert_yield_index(
                pool,
                meta,
                &YieldIndexInsert {
                    event_type: "compensation",
                    asset_id: &e.asset_id,
                    routed_to_rollover: Some(e.routed_to_rollover),
                    index_after: e.index_after,
                    unwrapped_supply: e.unwrapped_supply as i64,
                    ..Default::default()
                },
            )
            .await?;
            // The sweep reports the full post-op snapshot (LI-Q6).
            queries::insert_accumulator_balance(
                pool,
                meta,
                &AccumulatorBalanceInsert {
                    asset_id: &e.asset_id,
                    event_type: "CompensationSwept",
                    reward_pool_after: Some(e.reward_pool_after as i64),
                    rollover_reserve_after: Some(e.rollover_reserve_after as i64),
                    compensation_pool_after: Some(e.compensation_pool_after as i64),
                    wrapping_frozen: Some(e.wrapping_frozen),
                    ..Default::default()
                },
            )
            .await
        }
        other => anyhow::bail!("handle_yield_index called with non-yield type {other}"),
    }
}

/// `DustSweptEvent` → one `dust_sweeps` row (`§2.16`) + the emptied-pool balance fold (LI-D9).
pub async fn handle_dust_swept(pool: &PgPool, meta: &EventMeta, payload: &Value) -> Result<()> {
    let e: DustSweptEvent = serde_json::from_value(payload.clone())?;
    queries::insert_dust_sweep(pool, meta, &e.asset_id, e.amount as i64).await?;
    queries::insert_accumulator_balance(
        pool,
        meta,
        &AccumulatorBalanceInsert {
            asset_id: &e.asset_id,
            event_type: "DustSwept",
            reward_pool_after: Some(e.reward_pool_after as i64),
            rollover_reserve_after: Some(e.rollover_reserve_after as i64),
            ..Default::default()
        },
    )
    .await
}
