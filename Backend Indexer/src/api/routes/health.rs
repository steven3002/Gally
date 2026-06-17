//! `GET /health` — liveness + indexer lag (`backend.md §5.1`, Invariant 5).
//!
//! Compares the persisted checkpoint cursor against the live chain tip (cached ≤10s via
//! [`crate::sui_client::ChainTip`]). Behind by more than `LAG_ALERT_CHECKPOINTS` ⇒ `status:
//! "lagging"` + HTTP 503; an unreachable node ⇒ `status: "error"` + 503. Otherwise `status: "ok"`.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;

use crate::api::AppState;
use crate::db::queries;

pub async fn health(State(state): State<AppState>) -> impl IntoResponse {
    let cursor = queries::read_cursor(&state.pool).await.unwrap_or(0);
    state.metrics.cursor.set(cursor);

    match state.tip.latest().await {
        Ok(tip) => {
            let lag = (tip as i64 - cursor).max(0);
            state.metrics.lag.set(lag);
            let lagging = lag > state.lag_alert_checkpoints;
            let status = if lagging { "lagging" } else { "ok" };
            let code = if lagging {
                StatusCode::SERVICE_UNAVAILABLE
            } else {
                StatusCode::OK
            };
            (
                code,
                Json(json!({
                    "status": status,
                    "cursor": cursor,
                    "lag_checkpoints": lag,
                    "latest_chain_checkpoint": tip,
                })),
            )
        }
        // Node unreachable: cannot compute lag, so report degraded (Invariant 5 / `m7.md`).
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "status": "error", "reason": "cannot reach node" })),
        ),
    }
}
