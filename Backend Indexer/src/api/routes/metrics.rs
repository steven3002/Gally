//! `GET /metrics` — Prometheus text exposition (BI-M7; the metric table in `m7.md`). The cursor
//! gauge is refreshed from the DB at scrape time so a fresh scrape always reflects current
//! ingestion progress; the rest of the metrics are updated live at their source.

use axum::extract::State;
use axum::http::header::CONTENT_TYPE;
use axum::response::IntoResponse;

use crate::api::AppState;
use crate::db::queries;

pub async fn metrics(State(state): State<AppState>) -> impl IntoResponse {
    if let Ok(cursor) = queries::read_cursor(&state.pool).await {
        state.metrics.cursor.set(cursor);
    }
    let body = state.metrics.render();
    ([(CONTENT_TYPE, "text/plain; version=0.0.4")], body)
}
