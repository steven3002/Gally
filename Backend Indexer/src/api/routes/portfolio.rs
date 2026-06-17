//! `/portfolio/:address*` routes (BI-M3): the per-actor position-event feed and the distinct
//! asset set. `actor` is the protocol-attributed economic address (`backend.md §4.3`); the
//! canonical account page (`/address/:addr`, roles + holdings) lands in BI-M6.

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::extractors::{clamp_limit, decode_cursor_ii, encode_cursor, ApiError, Page};
use crate::api::AppState;
use crate::db::models::PositionEventRow;
use crate::db::queries;

/// `GET /portfolio/:address` query params: optional `?asset_id=` / `?event_type=` + pagination.
#[derive(Debug, Deserialize)]
pub struct PortfolioQuery {
    pub asset_id: Option<String>,
    pub event_type: Option<String>,
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

/// `GET /portfolio/:address` — the actor's position events ascending by `(timestamp_ms, id)`.
pub async fn portfolio(
    State(state): State<AppState>,
    Path(address): Path<String>,
    Query(q): Query<PortfolioQuery>,
) -> Result<Json<Page<PositionEventRow>>, ApiError> {
    let limit = clamp_limit(q.limit);
    let cursor = match q.cursor.as_deref() {
        Some(tok) => Some(decode_cursor_ii(tok)?),
        None => None,
    };
    let rows = queries::list_portfolio(
        &state.pool,
        &address,
        q.asset_id.as_deref(),
        q.event_type.as_deref(),
        cursor,
        limit,
    )
    .await
    .map_err(ApiError::from)?;
    Ok(Json(Page::from_overfetch(rows, limit, |r: &PositionEventRow| {
        encode_cursor(&[&r.timestamp_ms.to_string(), &r.id.to_string()])
    })))
}

/// `GET /portfolio/:address/assets` — distinct asset ids the address has interacted with
/// (protocol-attributed). Returned wrapped with `attribution` for parity with the holder/address
/// feeds; not cursor-paginated (the distinct set is small).
pub async fn portfolio_assets(
    State(state): State<AppState>,
    Path(address): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let assets = queries::list_portfolio_assets(&state.pool, &address)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({ "data": assets, "attribution": "protocol" })))
}
