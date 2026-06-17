//! Typed event handlers, one module per feed family. Wired into [`crate::ingestion::route_event`]
//! per milestone: BI-M2 lands `governance` + `asset`; BI-M3/BI-M4 land the rest.

pub mod asset;
pub mod dispute;
pub mod governance;
pub mod position;
pub mod tranche;
pub mod validator;
pub mod yield_index;

use crate::sui_client::SuiEvent;

/// Per-event provenance carried alongside every typed payload: the idempotency key
/// (`tx_digest`, `event_seq` — guard rail R6) plus the checkpoint/timestamp columns common to
/// every event table (`logic_flow.md §2.0`).
#[derive(Debug, Clone)]
pub struct EventMeta {
    pub tx_digest: String,
    pub event_seq: i32,
    pub checkpoint_seq: i64,
    pub timestamp_ms: i64,
}

impl EventMeta {
    /// Derive the metadata from a raw `suix_queryEvents` record. `event_seq` and `timestamp_ms`
    /// arrive as JSON strings (`§10.2`); `checkpoint_seq` is absent on the JSON-RPC path (it is
    /// supplied by the gRPC checkpoint stream in BI-M7) so it defaults to 0.
    pub fn from_event(ev: &SuiEvent) -> Self {
        Self {
            tx_digest: ev.id.tx_digest.clone(),
            event_seq: ev.id.event_seq.parse().unwrap_or(0),
            checkpoint_seq: 0,
            timestamp_ms: ev
                .timestamp_ms
                .as_deref()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0),
        }
    }
}
