//! `GET /tx/:digest` (BI-M6) — every event emitted in one transaction, plus the union of objects /
//! addresses they reference (`backend.md §5.1`, shape `logic_flow.md §6.8`). Assembled from
//! `raw_events` (BI-M1 already archives the full payload), ordered by `event_seq`. 404 if the
//! digest is unknown.

use std::collections::BTreeSet;

use axum::extract::{Path, State};
use axum::Json;
use serde_json::{json, Value};

use crate::api::extractors::ApiError;
use crate::api::AppState;
use crate::db::queries;
use crate::ingestion::short_event_name;

/// Payload keys that carry an object id or an address (`logic_flow.md §10.3`). Their string values
/// across a tx's events form the `affected` set (`§6.8`).
const REFERENCE_KEYS: &[&str] = &[
    "asset_id",
    "accumulator_id",
    "config_id",
    "pool_id",
    "target_pool_id",
    "juror_pool_id",
    "dispute_id",
    "share_object_id",
    "entity",
    "validator",
    "holder",
    "contributor",
    "challenger",
    "depositor",
    "admin",
    "actor",
    "old_treasury",
    "new_treasury",
];

/// `GET /tx/:digest` — the transaction's events + affected objects/addresses.
pub async fn get_tx(
    State(state): State<AppState>,
    Path(digest): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let rows = queries::list_raw_events_by_tx(&state.pool, &digest)
        .await
        .map_err(ApiError::from)?;
    if rows.is_empty() {
        return Err(ApiError::not_found(&digest));
    }

    let timestamp_ms = rows[0].timestamp_ms;
    let checkpoint_seq = rows[0].checkpoint_seq;
    let mut affected: BTreeSet<String> = BTreeSet::new();
    let mut events: Vec<Value> = Vec::with_capacity(rows.len());

    for r in &rows {
        // `payload` is stored JSONB read back as text (`§6.8`); re-parse for the response body.
        let payload: Value = serde_json::from_str(&r.payload).unwrap_or(Value::Null);
        collect_references(&payload, &mut affected);
        events.push(json!({
            "event_seq": r.event_seq,
            "event_type": short_event_name(&r.event_type),
            "payload": payload,
        }));
    }

    Ok(Json(json!({
        "tx_digest": digest,
        "timestamp_ms": timestamp_ms,
        "checkpoint_seq": checkpoint_seq,
        "events": events,
        "affected": affected.into_iter().collect::<Vec<_>>(),
    })))
}

/// Add every reference-key string value in `payload` to `out`.
fn collect_references(payload: &Value, out: &mut BTreeSet<String>) {
    if let Some(obj) = payload.as_object() {
        for key in REFERENCE_KEYS {
            if let Some(Value::String(s)) = obj.get(*key) {
                out.insert(s.clone());
            }
        }
    }
}
