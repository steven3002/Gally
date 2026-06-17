//! `/validators*` routes (BI-M3): keyset-paginated pool list + pool detail with embedded recent
//! stake history and status-change timeline. Track-record enrichment + `?validator=` hardening is
//! BI-M5; the `?status=` / `?validator=` filters are wired here since `backend.md §5.1` defines
//! them on this endpoint.

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::extractors::{clamp_limit, decode_cursor_is, encode_cursor, ApiError, Page};
use crate::api::AppState;
use crate::db::models::ValidatorPoolRow;
use crate::db::queries;

/// Embedded-history cap for the pool detail view (a deep history is paginated via dedicated feeds
/// in later milestones).
const DETAIL_HISTORY_LIMIT: i64 = 100;

/// `GET /validators` query params: optional `?status=` / `?validator=` + universal pagination.
#[derive(Debug, Deserialize)]
pub struct ValidatorListQuery {
    pub status: Option<i16>,
    pub validator: Option<String>,
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

/// `GET /validators` — keyset-paginated pool list (ordered by `(registered_at_ms, pool_id)`).
pub async fn list_validators(
    State(state): State<AppState>,
    Query(q): Query<ValidatorListQuery>,
) -> Result<Json<Page<ValidatorPoolRow>>, ApiError> {
    let limit = clamp_limit(q.limit);
    let cursor = match q.cursor.as_deref() {
        Some(tok) => Some(decode_cursor_is(tok)?),
        None => None,
    };
    let rows = queries::list_validators(&state.pool, q.status, q.validator.as_deref(), cursor, limit)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(Page::from_overfetch(rows, limit, |r: &ValidatorPoolRow| {
        encode_cursor(&[&r.registered_at_ms.to_string(), &r.pool_id])
    })))
}

/// `GET /validators/:pool_id` — pool record + recent stake events + status-change history (404 if
/// the pool is unknown). Single object (not paginated); the embedded arrays are capped.
pub async fn get_validator(
    State(state): State<AppState>,
    Path(pool_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let pool_row = queries::get_validator_pool(&state.pool, &pool_id)
        .await
        .map_err(ApiError::from)?
        .ok_or(ApiError::NotFound)?;
    let stake_events = queries::list_stake_events(&state.pool, &pool_id, DETAIL_HISTORY_LIMIT)
        .await
        .map_err(ApiError::from)?;
    let status_changes = queries::list_status_changes(&state.pool, &pool_id, DETAIL_HISTORY_LIMIT)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({
        "pool_id": pool_row.pool_id,
        "validator": pool_row.validator,
        "initial_stake": pool_row.initial_stake.to_string(),
        "current_status": pool_row.current_status,
        "registered_at_ms": pool_row.registered_at_ms,
        "stake_events": stake_events,
        "status_changes": status_changes,
    })))
}
