//! Checkpoint/event ingestion loop.
//!
//! BI-M1 is the skeleton: it polls events from the `gally_core` package, archives them in
//! `raw_events`, and advances the cursor — there are no typed handlers yet (those land in
//! BI-M2..BI-M4). Every event currently falls through [`dispatch`] to a `warn!` stub.

pub mod event_types;
pub mod handlers;

use std::collections::HashMap;
use std::time::Duration;

use anyhow::Result;
use serde_json::Value;
use sqlx::PgPool;
use tokio::time::sleep;
use tracing::{debug, warn};

use crate::db::queries::{self, RawEventInsert};
use crate::sui_client::{EventId, SuiClient, SuiEvent};

/// `gally_core` modules that emit events (`share` emits none — `logic_flow.md §10.3`).
const EVENT_MODULES: [&str; 5] = ["protocol", "validator", "asset", "accumulator", "dispute"];

/// Page size for `suix_queryEvents` backfill.
const PAGE_LIMIT: usize = 50;

/// Route an event type to its handler. In BI-M1 no handlers are wired yet, so every event
/// type falls through to the `warn!` stub. Returns `true` if the type is handled.
pub fn dispatch(event_type: &str) -> bool {
    match event_type {
        // Typed handlers (handle_governance / handle_asset_created / …) are wired in BI-M2..BI-M4.
        _ => {
            warn!(%event_type, "unhandled event type (BI-M1 skeleton archives raw payload only)");
            false
        }
    }
}

/// Run the ingestion loop forever: sweep each module's events, archive to `raw_events`, and
/// advance the cursor. Ingestion is idempotent — duplicate events (on restart/reconnect) are
/// skipped by the `(tx_digest, event_seq)` key, so a coarse resume cursor is always safe.
///
/// NOTE (BI-M1): `indexer_cursor` holds a single backfill EventID, but `queryEvents` is
/// per-module, so in-memory per-module cursors drive the sweep and reset to genesis on
/// restart; idempotent upserts make the re-scan harmless. Precise per-module persistence is
/// the `logic_flow.md §2.1` per-event-type follow-up. `suix_queryEvents` also returns no
/// per-event checkpoint number, so `checkpoint_seq` stays 0 until the gRPC path (BI-M7).
pub async fn run(pool: PgPool, sui: SuiClient, package_id: String, poll_secs: u64) -> Result<()> {
    match queries::read_backfill_cursor(&pool).await? {
        Some((tx, seq)) => {
            tracing::info!(resume_tx = %tx, resume_seq = seq, "resuming from persisted backfill cursor")
        }
        None => tracing::info!("no persisted backfill cursor; starting from genesis"),
    }

    let mut cursors: HashMap<String, Option<EventId>> =
        EVENT_MODULES.iter().map(|m| (m.to_string(), None)).collect();

    loop {
        for module in EVENT_MODULES {
            match sui
                .query_events_by_module(&package_id, module, cursors[module].clone(), PAGE_LIMIT)
                .await
            {
                Ok(page) => {
                    let count = page.data.len();
                    for ev in &page.data {
                        store_event(&pool, ev).await?;
                        dispatch(&ev.event_type);
                    }
                    if let Some(nc) = page.next_cursor {
                        let seq: i32 = nc.event_seq.parse().unwrap_or(0);
                        queries::write_backfill_cursor(&pool, 0, &nc.tx_digest, seq).await?;
                        cursors.insert(module.to_string(), Some(nc));
                    }
                    debug!(module, events = count, "polled module");
                }
                Err(e) => warn!(module, error = %e, "poll failed; will retry next cycle"),
            }
        }
        sleep(Duration::from_secs(poll_secs)).await;
    }
}

/// Archive one event in `raw_events` (idempotent).
async fn store_event(pool: &PgPool, ev: &SuiEvent) -> Result<()> {
    let event_seq: i32 = ev.id.event_seq.parse().unwrap_or(0);
    let timestamp_ms: i64 = ev
        .timestamp_ms
        .as_deref()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let payload: &Value = &ev.parsed_json;
    let inserted = queries::upsert_raw_event(
        pool,
        &RawEventInsert {
            tx_digest: &ev.id.tx_digest,
            event_seq,
            checkpoint_seq: 0, // queryEvents carries no checkpoint number; gRPC supplies it (BI-M7)
            timestamp_ms,
            event_type: &ev.event_type,
            payload,
        },
    )
    .await?;
    if inserted {
        debug!(event_type = %ev.event_type, "archived new event");
    }
    Ok(())
}
