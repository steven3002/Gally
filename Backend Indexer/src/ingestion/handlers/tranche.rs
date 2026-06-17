//! Tranche/milestone event handlers (BI-M4): MilestoneProofSubmitted, MilestoneApproved,
//! TrancheReleased [`asset` module] → `tranche_events` (`logic_flow.md §2.12`, `§10.3`).
//!
//! One row each, `event_type` = `'proof_submitted'` / `'approved'` / `'released'`, with only the
//! subtype's columns set. `blob_id`/`sha256` are `vector<u8>` hex-encoded for storage (§10.2); the
//! Move `tranche` (u64) is the `tranche_index` (INT).

use anyhow::Result;
use serde_json::Value;
use sqlx::PgPool;

use crate::db::queries::{self, TrancheInsert};
use crate::ingestion::event_types::{
    MilestoneApprovedEvent, MilestoneProofSubmittedEvent, TrancheReleasedEvent,
};
use crate::ingestion::handlers::EventMeta;

/// Route one tranche event (by `Event`-suffixed struct short name) into `tranche_events`.
pub async fn handle_tranche_event(
    pool: &PgPool,
    meta: &EventMeta,
    short_name: &str,
    payload: &Value,
) -> Result<()> {
    match short_name {
        "MilestoneProofSubmittedEvent" => {
            let e: MilestoneProofSubmittedEvent = serde_json::from_value(payload.clone())?;
            queries::insert_tranche_event(
                pool,
                meta,
                &TrancheInsert {
                    event_type: "proof_submitted",
                    asset_id: &e.asset_id,
                    tranche_index: e.tranche as i32,
                    blob_id: Some(e.blob_id_hex()),
                    sha256: Some(e.sha256_hex()),
                    ..Default::default()
                },
            )
            .await
        }
        "MilestoneApprovedEvent" => {
            let e: MilestoneApprovedEvent = serde_json::from_value(payload.clone())?;
            queries::insert_tranche_event(
                pool,
                meta,
                &TrancheInsert {
                    event_type: "approved",
                    asset_id: &e.asset_id,
                    tranche_index: e.tranche as i32,
                    validator: Some(&e.validator),
                    pool_id: Some(&e.pool_id),
                    ..Default::default()
                },
            )
            .await
        }
        "TrancheReleasedEvent" => {
            let e: TrancheReleasedEvent = serde_json::from_value(payload.clone())?;
            queries::insert_tranche_event(
                pool,
                meta,
                &TrancheInsert {
                    event_type: "released",
                    asset_id: &e.asset_id,
                    tranche_index: e.tranche as i32,
                    amount: Some(e.amount as i64),
                    escrow_after: Some(e.escrow_after as i64),
                    ..Default::default()
                },
            )
            .await
        }
        other => anyhow::bail!("handle_tranche_event called with non-tranche type {other}"),
    }
}
