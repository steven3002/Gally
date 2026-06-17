//! WebSocket live-push fan-out hub (BI-M7; `logic_flow.md §9` constraint 5).
//!
//! One [`Hub`] is shared (`Arc`) between the ingestion loop (which calls [`Hub::publish_event`]
//! after each event commit) and the WS route handlers (which [`Hub::subscribe`] per connection).
//! Channels are keyed `asset:<id>` / `address:<addr>` / `dispute:<id>`; each is a
//! `tokio::sync::broadcast` channel created lazily on first subscribe.
//!
//! **Delivery is best-effort and live-only.** A WebSocket connection never replays events emitted
//! before it subscribed (REST is the source of history, `backend.md §5.2`); if a slow client lags
//! past the channel capacity the broadcast layer drops the oldest frames (surfaced to the handler
//! as `RecvError::Lagged`, which it skips).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde_json::{json, Value};
use tokio::sync::broadcast;

use crate::ingestion::short_event_name;
use crate::sui_client::SuiEvent;

/// Per-channel broadcast buffer depth. A connection that falls more than this many frames behind
/// drops the oldest (it should reconcile via REST, `backend.md §5.2`).
const CHANNEL_CAPACITY: usize = 256;

/// Payload address fields that map an event onto an `address:<addr>` (portfolio) channel — the
/// `actor` columns of `position_events` ∪ `raise_progress` (`/ws/portfolio/:address`,
/// `logic_flow.md §5.2`).
const ADDRESS_FIELDS: [&str; 2] = ["holder", "contributor"];

/// The live-push fan-out hub. The channel map grows as new keys are subscribed and is not pruned
/// (acceptable for v1; the senders are tiny and bounded by the number of distinct subscribed ids).
pub struct Hub {
    channels: Mutex<HashMap<String, broadcast::Sender<String>>>,
    next_id: AtomicU64,
}

impl Hub {
    pub fn new() -> Self {
        Self {
            channels: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }

    /// A monotonic id for the `{ "type": "connected", "id": ... }` handshake frame.
    pub fn next_connection_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    /// Subscribe to one channel key (`asset:<id>` etc.), creating its sender on first use. The
    /// returned receiver only sees frames published **after** this call — callers must subscribe
    /// before emitting their `connected` frame so no live event slips through the gap.
    pub fn subscribe(&self, key: &str) -> broadcast::Receiver<String> {
        let mut channels = self.channels.lock().unwrap();
        channels
            .entry(key.to_string())
            .or_insert_with(|| broadcast::channel(CHANNEL_CAPACITY).0)
            .subscribe()
    }

    /// Send a frame to one channel if it has any active subscribers (no receivers ⇒ silently
    /// dropped — there is no one to deliver to, and history is REST's job).
    fn send(&self, key: &str, msg: &str) {
        let channels = self.channels.lock().unwrap();
        if let Some(tx) = channels.get(key) {
            let _ = tx.send(msg.to_string());
        }
    }

    /// Fan one ingested event out to its asset / address / dispute channels (constraint 5). The
    /// frame is `{ "type": "event", "event_type", "tx_digest", "event_seq", ...payload fields }`
    /// (`backend.md §5.2` — the raw indexed record as JSON).
    pub fn publish_event(&self, ev: &SuiEvent) {
        let payload = &ev.parsed_json;
        let mut frame = serde_json::Map::new();
        frame.insert("type".to_string(), json!("event"));
        frame.insert(
            "event_type".to_string(),
            json!(short_event_name(&ev.event_type)),
        );
        frame.insert("tx_digest".to_string(), json!(ev.id.tx_digest));
        frame.insert("event_seq".to_string(), json!(ev.id.event_seq));
        if let Value::Object(map) = payload {
            for (k, v) in map {
                frame.entry(k.clone()).or_insert_with(|| v.clone());
            }
        }
        let text = Value::Object(frame).to_string();

        if let Some(asset_id) = payload.get("asset_id").and_then(Value::as_str) {
            self.send(&format!("asset:{asset_id}"), &text);
        }
        for field in ADDRESS_FIELDS {
            if let Some(addr) = payload.get(field).and_then(Value::as_str) {
                self.send(&format!("address:{addr}"), &text);
            }
        }
        if let Some(dispute_id) = payload.get("dispute_id").and_then(Value::as_str) {
            self.send(&format!("dispute:{dispute_id}"), &text);
        }
    }
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}
