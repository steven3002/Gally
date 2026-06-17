//! Checkpoint/event ingestion loop.
//!
//! The loop polls events from the `gally_core` package, archives the raw payload in
//! `raw_events`, advances the cursor, and routes each event to its typed handler via
//! [`route_event`]. As of BI-M4 all 36 `gally_core` event types (`logic_flow.md §10.3`) are
//! wired — governance + asset-lifecycle (BI-M2), validator + position (BI-M3), and yield-index +
//! tranche + dispute (BI-M4). The `warn!` fall-through now fires only for a genuinely new
//! (future) type, which is still archived in `raw_events` and never fatal (guard rail R7).

pub mod event_types;
pub mod handlers;

use std::collections::HashMap;
use std::time::Duration;

use anyhow::Result;
use serde_json::Value;
use sqlx::PgPool;
use tokio::time::sleep;
use tracing::{debug, warn};

use std::sync::Arc;

use crate::db::queries::{self, RawEventInsert};
use crate::metrics::Metrics;
use crate::sui_client::{EventId, SuiClient, SuiEvent};
use crate::ws::Hub;
use handlers::{asset, dispute, governance, position, tranche, validator, yield_index, EventMeta};

/// `gally_core` modules that emit events (`share` emits none — `logic_flow.md §10.3`).
const EVENT_MODULES: [&str; 5] = ["protocol", "validator", "asset", "accumulator", "dispute"];

/// Page size for `suix_queryEvents` backfill.
const PAGE_LIMIT: usize = 50;

/// The `StructNameEvent` part of a full `MoveEventType` (`<pkg>::<module>::<Struct>`).
pub fn short_event_name(event_type: &str) -> &str {
    event_type.rsplit("::").next().unwrap_or(event_type)
}

/// Route one event to its typed handler by struct short name. Returns `Ok(true)` if a handler
/// processed it, `Ok(false)` if the type is unknown / not yet wired (already archived in
/// `raw_events`; logged, never an error — guard rail R7). A handler error is returned so the
/// caller can log it and continue without crashing the loop.
pub async fn route_event(pool: &PgPool, ev: &SuiEvent) -> Result<bool> {
    let meta = EventMeta::from_event(ev);
    let payload = &ev.parsed_json;
    match short_event_name(&ev.event_type) {
        // ---- governance feed (BI-M2) ----
        name @ ("ProtocolInitializedEvent"
        | "ProtocolParamChangedEvent"
        | "ProtocolTreasuryChangedEvent"
        | "EmergencyStopTriggeredEvent"
        | "ProtocolResumedEvent") => {
            governance::handle_governance(pool, &meta, name, payload).await?;
            Ok(true)
        }
        // ---- asset-lifecycle feed (BI-M2) ----
        "AssetCreatedEvent" => {
            asset::handle_asset_created(pool, &meta, payload).await?;
            Ok(true)
        }
        "AssetVouchedEvent" => {
            asset::handle_asset_vouched(pool, payload).await?;
            Ok(true)
        }
        "AssetStateChangedEvent" => {
            asset::handle_asset_state_change(pool, &meta, payload).await?;
            Ok(true)
        }
        "AssetClosedEvent" => {
            asset::handle_asset_closed(pool, payload).await?;
            Ok(true)
        }
        "AssetOperationalEvent" => {
            asset::handle_asset_operational(pool, payload).await?;
            Ok(true)
        }
        "RaiseFinalizedEvent" => {
            asset::handle_raise_finalized(pool, payload).await?;
            Ok(true)
        }
        // CANCELLED=3 arrives via AssetStateChangedEvent; this is archived in raw_events only (§4).
        "AssetCancelledEvent" => {
            debug!("AssetCancelledEvent: no-op (CANCELLED state arrives via AssetStateChangedEvent)");
            Ok(true)
        }
        // ---- validator registry feed (BI-M3) ----
        "ValidatorRegisteredEvent" => {
            validator::handle_validator_registered(pool, &meta, payload).await?;
            Ok(true)
        }
        "StakeAddedEvent" => {
            validator::handle_stake_added(pool, &meta, payload).await?;
            Ok(true)
        }
        "StakeWithdrawnEvent" => {
            validator::handle_stake_withdrawn(pool, &meta, payload).await?;
            Ok(true)
        }
        "ValidatorStatusChangedEvent" => {
            validator::handle_validator_status(pool, &meta, payload).await?;
            Ok(true)
        }
        // ---- position ledger feed (BI-M3) ----
        "CapitalContributedEvent" => {
            position::handle_capital_contributed(pool, &meta, payload).await?;
            Ok(true)
        }
        name @ ("SharesClaimedEvent"
        | "SharesWrappedEvent"
        | "SharesUnwrappedEvent"
        | "YieldClaimedEvent"
        | "ShareRedeemedEvent"
        | "ContributionRefundedEvent") => {
            position::handle_position_event(pool, &meta, name, payload).await?;
            Ok(true)
        }
        // FAILED=2 arrives via AssetStateChangedEvent; the asset has no raise-aborted table/column,
        // so this is an explicit no-op (full payload archived in raw_events, §4 / §11.5).
        "RaiseAbortedEvent" => {
            debug!("RaiseAbortedEvent: no-op (FAILED state arrives via AssetStateChangedEvent)");
            Ok(true)
        }
        // DEFAULTED collapses into COMPENSATING=6 via AssetStateChangedEvent (§11.5); the seizure
        // figures have no typed destination column, so this is an explicit no-op (archived raw).
        "EntityDefaultedEvent" => {
            debug!("EntityDefaultedEvent: no-op (DEFAULTED collapses into COMPENSATING state-change)");
            Ok(true)
        }
        // ---- yield-index feed (BI-M4) ----
        name @ ("RevenueDepositedEvent" | "RolloverSweptEvent" | "CompensationSweptEvent") => {
            yield_index::handle_yield_index(pool, &meta, name, payload).await?;
            Ok(true)
        }
        "DustSweptEvent" => {
            yield_index::handle_dust_swept(pool, &meta, payload).await?;
            Ok(true)
        }
        // ---- tranche / milestone feed (BI-M4) ----
        name @ ("MilestoneProofSubmittedEvent"
        | "MilestoneApprovedEvent"
        | "TrancheReleasedEvent") => {
            tranche::handle_tranche_event(pool, &meta, name, payload).await?;
            Ok(true)
        }
        // ---- dispute feed (BI-M4) ----
        "DisputeOpenedEvent" => {
            dispute::handle_dispute_opened(pool, &meta, payload).await?;
            Ok(true)
        }
        "JurorVotedEvent" => {
            dispute::handle_juror_voted(pool, &meta, payload).await?;
            Ok(true)
        }
        "DisputeResolvedEvent" => {
            dispute::handle_dispute_resolved(pool, &meta, payload).await?;
            Ok(true)
        }
        "JurorRewardClaimedEvent" => {
            dispute::handle_juror_reward(pool, &meta, payload).await?;
            Ok(true)
        }
        // All 36 known event types are now wired (BI-M4). This only fires for a genuinely new
        // (future) type: archived in raw_events, never fatal (R7).
        other => {
            warn!(event_type = %other, "no typed handler; archived in raw_events only");
            Ok(false)
        }
    }
}

/// Archive → route → record → broadcast one event (BI-M7). This is the single ingestion unit: it
/// writes `raw_events`, dispatches to the typed handler, updates the metrics counters/histogram,
/// and fans the event out to any open WebSocket channels (`logic_flow.md §4` "broadcast to any
/// open WebSocket subscriptions" + §9 constraint 5). A typed-handler error is logged, not
/// propagated — the raw payload is already archived, so the loop keeps advancing (R7); only a
/// store failure (DB down) bubbles up.
pub async fn process_event(
    pool: &PgPool,
    hub: &Hub,
    metrics: &Metrics,
    ev: &SuiEvent,
) -> Result<()> {
    let timer = metrics.db_write_duration.start_timer();
    store_event(pool, ev).await?;
    match route_event(pool, ev).await {
        Ok(true) => metrics.record_event(short_event_name(&ev.event_type)),
        Ok(false) => metrics.record_unknown(),
        Err(e) => warn!(event_type = %ev.event_type, error = %e,
            "typed handler failed; raw payload retained, continuing"),
    }
    timer.observe_duration();
    hub.publish_event(ev);
    Ok(())
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
pub async fn run(
    pool: PgPool,
    sui: SuiClient,
    package_id: String,
    poll_secs: u64,
    hub: Arc<Hub>,
    metrics: Arc<Metrics>,
) -> Result<()> {
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
                        // store → route → record → broadcast; only a store failure propagates.
                        process_event(&pool, &hub, &metrics, ev).await?;
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
