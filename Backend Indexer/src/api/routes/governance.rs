//! `GET /governance` route (BI-M2): the protocol parameter / pause event log
//! (`logic_flow.md §2.3`), ordered by `(timestamp_ms, id)` with an optional `?type=` filter and
//! the universal `?limit=` / `?cursor=` envelope.

use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;

use crate::api::extractors::{clamp_limit, decode_cursor_ii, encode_cursor, ApiError, Page};
use crate::api::AppState;
use crate::db::models::GovernanceRow;
use crate::db::queries;

/// `GET /governance` query params: optional `?type=` (normalized event name, e.g.
/// `ProtocolParamChanged`) plus the universal `?limit=` / `?cursor=`.
#[derive(Debug, Deserialize)]
pub struct GovernanceQuery {
    #[serde(rename = "type")]
    pub type_filter: Option<String>,
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

/// `GET /governance` — governance events in ascending timestamp order.
pub async fn list_governance(
    State(state): State<AppState>,
    Query(q): Query<GovernanceQuery>,
) -> Result<Json<Page<GovernanceRow>>, ApiError> {
    let limit = clamp_limit(q.limit);
    let cursor = match q.cursor.as_deref() {
        Some(tok) => Some(decode_cursor_ii(tok)?),
        None => None,
    };
    let rows = queries::list_governance(&state.pool, q.type_filter.as_deref(), cursor, limit)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(Page::from_overfetch(
        rows,
        limit,
        |r: &GovernanceRow| encode_cursor(&[&r.timestamp_ms.to_string(), &r.id.to_string()]),
    )))
}
