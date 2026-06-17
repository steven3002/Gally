//! Dispute event handlers (BI-M4): DisputeOpened, JurorVoted, DisputeResolved, JurorRewardClaimed
//! [`dispute` module] → `disputes` / `jury_votes` / `juror_rewards` (`logic_flow.md §2.13–2.15`,
//! `§10.3`, verdict integers `§11.3`).
//!
//! `DisputeOpened` inserts the `disputes` row (hex-encoding `evidence_sha256` → `evidence_hash`);
//! `DisputeResolved` updates that row's resolution columns in place (the denormalized dispute
//! status). `JurorVoted` / `JurorRewardClaimed` append to their time-series tables.
//! `JurorRewardClaimedEvent` is a code-only event absent from `protocol_flow.md §18.3` (§10.1).

use anyhow::Result;
use serde_json::Value;
use sqlx::PgPool;

use crate::db::queries;
use crate::ingestion::event_types::{
    DisputeOpenedEvent, DisputeResolvedEvent, JurorRewardClaimedEvent, JurorVotedEvent,
};
use crate::ingestion::handlers::EventMeta;

/// `DisputeOpenedEvent` → insert the `disputes` row.
pub async fn handle_dispute_opened(pool: &PgPool, meta: &EventMeta, payload: &Value) -> Result<()> {
    let e: DisputeOpenedEvent = serde_json::from_value(payload.clone())?;
    queries::insert_dispute_opened(pool, meta, &e).await
}

/// `JurorVotedEvent` → append one `jury_votes` row.
pub async fn handle_juror_voted(pool: &PgPool, meta: &EventMeta, payload: &Value) -> Result<()> {
    let e: JurorVotedEvent = serde_json::from_value(payload.clone())?;
    queries::insert_jury_vote(pool, meta, &e).await
}

/// `DisputeResolvedEvent` → update the `disputes` row's resolution columns (verdict/slashed/bounty/
/// resolved_at_ms/resolved_tx — the denormalized dispute status).
pub async fn handle_dispute_resolved(
    pool: &PgPool,
    meta: &EventMeta,
    payload: &Value,
) -> Result<()> {
    let e: DisputeResolvedEvent = serde_json::from_value(payload.clone())?;
    queries::apply_dispute_resolved(pool, meta, &e).await
}

/// `JurorRewardClaimedEvent` → append one `juror_rewards` row (code-only event, §10.1).
pub async fn handle_juror_reward(pool: &PgPool, meta: &EventMeta, payload: &Value) -> Result<()> {
    let e: JurorRewardClaimedEvent = serde_json::from_value(payload.clone())?;
    queries::insert_juror_reward(pool, meta, &e).await
}
