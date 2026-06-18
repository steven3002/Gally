//! Position-ledger feed handlers (`asset` + `accumulator` modules — `logic_flow.md §2.6`,
//! `§2.10`, `§10.3`).
//!
//! `CapitalContributed` is its own feed (`raise_progress`, not `position_events` — `§4`). The
//! rest land one row each in `position_events` with `actor` = `holder` (share events) or
//! `contributor` (refunds), and only the fields the subtype carries set (`§2.10`).

use anyhow::Result;
use serde_json::Value;
use sqlx::PgPool;

use crate::db::queries::{self, AccumulatorBalanceInsert, PositionInsert};
use crate::ingestion::event_types::{
    CapitalContributedEvent, ContributionRefundedEvent, ShareRedeemedEvent, SharesClaimedEvent,
    SharesUnwrappedEvent, SharesWrappedEvent, YieldClaimedEvent,
};
use crate::ingestion::handlers::EventMeta;

/// `CapitalContributedEvent` → `raise_progress` (the funding time-series).
pub async fn handle_capital_contributed(
    pool: &PgPool,
    meta: &EventMeta,
    payload: &Value,
) -> Result<()> {
    let e: CapitalContributedEvent = serde_json::from_value(payload.clone())?;
    queries::insert_raise_progress(pool, meta, &e).await
}

/// Route one position-ledger event (by `Event`-suffixed struct short name) into
/// `position_events`. The stored `event_type` is the normalized name (no `Event` suffix), which
/// the holder fold (`§2.17`) and `/portfolio` filter match on.
pub async fn handle_position_event(
    pool: &PgPool,
    meta: &EventMeta,
    short_name: &str,
    payload: &Value,
) -> Result<()> {
    match short_name {
        "SharesClaimedEvent" => {
            let e: SharesClaimedEvent = serde_json::from_value(payload.clone())?;
            queries::insert_position_event(
                pool,
                meta,
                &PositionInsert {
                    event_type: "SharesClaimed",
                    asset_id: &e.asset_id,
                    actor: &e.holder,
                    amount: Some(e.count as i64),
                    share_object_id: Some(&e.share_object_id),
                    ..Default::default()
                },
            )
            .await
        }
        "SharesWrappedEvent" => {
            let e: SharesWrappedEvent = serde_json::from_value(payload.clone())?;
            queries::insert_position_event(
                pool,
                meta,
                &PositionInsert {
                    event_type: "SharesWrapped",
                    asset_id: &e.asset_id,
                    actor: &e.holder,
                    amount: Some(e.count as i64),
                    total_wrapped_after: Some(e.total_wrapped_after as i64),
                    ..Default::default()
                },
            )
            .await
        }
        "SharesUnwrappedEvent" => {
            let e: SharesUnwrappedEvent = serde_json::from_value(payload.clone())?;
            queries::insert_position_event(
                pool,
                meta,
                &PositionInsert {
                    event_type: "SharesUnwrapped",
                    asset_id: &e.asset_id,
                    actor: &e.holder,
                    amount: Some(e.count as i64),
                    share_object_id: Some(&e.share_object_id),
                    total_wrapped_after: Some(e.total_wrapped_after as i64),
                    ..Default::default()
                },
            )
            .await
        }
        "YieldClaimedEvent" => {
            let e: YieldClaimedEvent = serde_json::from_value(payload.clone())?;
            queries::insert_position_event(
                pool,
                meta,
                &PositionInsert {
                    event_type: "YieldClaimed",
                    asset_id: &e.asset_id,
                    actor: &e.holder,
                    amount: Some(e.amount as i64),
                    index_at_claim: Some(e.index_at_claim),
                    ..Default::default()
                },
            )
            .await?;
            // BI-M8 (LI-D9): the claim drains the reward pool — fold its post-claim balance.
            queries::insert_accumulator_balance(
                pool,
                meta,
                &AccumulatorBalanceInsert {
                    asset_id: &e.asset_id,
                    event_type: "YieldClaimed",
                    reward_pool_after: Some(e.reward_pool_after as i64),
                    ..Default::default()
                },
            )
            .await
        }
        "ShareRedeemedEvent" => {
            let e: ShareRedeemedEvent = serde_json::from_value(payload.clone())?;
            queries::insert_position_event(
                pool,
                meta,
                &PositionInsert {
                    event_type: "ShareRedeemed",
                    asset_id: &e.asset_id,
                    actor: &e.holder,
                    amount: Some(e.count as i64),
                    ..Default::default()
                },
            )
            .await
        }
        "ContributionRefundedEvent" => {
            let e: ContributionRefundedEvent = serde_json::from_value(payload.clone())?;
            queries::insert_position_event(
                pool,
                meta,
                &PositionInsert {
                    event_type: "ContributionRefunded",
                    asset_id: &e.asset_id,
                    actor: &e.contributor,
                    amount: Some(e.amount as i64),
                    ..Default::default()
                },
            )
            .await
        }
        other => anyhow::bail!("handle_position_event called with non-position type {other}"),
    }
}
