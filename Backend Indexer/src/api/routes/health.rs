//! `GET /health` — liveness + current checkpoint cursor (`backend.md §5.1`).
//! BI-M7 adds lag-based 503 responses; BI-M1 always returns 200.

use axum::{extract::State, Json};
use serde_json::{json, Value};

use crate::api::AppState;
use crate::db::queries;

pub async fn health(State(state): State<AppState>) -> Json<Value> {
    let cursor = queries::read_cursor(&state.pool).await.unwrap_or(0);
    Json(json!({ "status": "ok", "cursor": cursor }))
}
