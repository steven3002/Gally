//! `GET /address/:address` (BI-M6) — the canonical account page: derived `roles` + per-asset
//! current `holdings` (`backend.md §5.1`, shape `logic_flow.md §6.7`). Both are computed, not
//! stored: `roles` is a set of EXISTS lookups, `holdings` the §2.17 signed fold grouped by asset.
//! Protocol-attributed (`backend.md §4.3`) — every response carries `attribution: "protocol"`. The
//! `holdings` collection is itself cursor-paginated when large (`backend.md §5.1.1`).

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::extractors::{clamp_limit, decode_cursor, encode_cursor, ApiError};
use crate::api::AppState;
use crate::db::models::HoldingRow;
use crate::db::queries;

/// `GET /address/:address` query params: the universal `?limit=` / `?cursor=` for the `holdings`
/// sub-collection (keyset on `asset_id`).
#[derive(Debug, Deserialize)]
pub struct AddressQuery {
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

/// `GET /address/:address` — single account object: `{ address, roles, holdings,
/// holdingsNextCursor, holdingsHasNextPage, attribution }`.
pub async fn address_summary(
    State(state): State<AppState>,
    Path(address): Path<String>,
    Query(q): Query<AddressQuery>,
) -> Result<Json<Value>, ApiError> {
    let limit = clamp_limit(q.limit);
    // The holdings cursor is a single opaque part (the last asset_id); decode it tolerantly.
    let cursor = match q.cursor.as_deref() {
        Some(tok) => Some(
            decode_cursor(tok)
                .and_then(|parts| parts.into_iter().next())
                .ok_or_else(|| ApiError::invalid_param("cursor", "malformed pagination cursor"))?,
        ),
        None => None,
    };

    let roles = queries::address_roles(&state.pool, &address)
        .await
        .map_err(ApiError::from)?;
    let mut holdings = queries::list_address_holdings(&state.pool, &address, cursor, limit)
        .await
        .map_err(ApiError::from)?;

    // Over-fetch by one to compute the holdings page cursor (`backend.md §5.1.1`).
    let has_next = holdings.len() as i64 > limit;
    if has_next {
        holdings.truncate(limit as usize);
    }
    let next_cursor: Option<String> = if has_next {
        holdings
            .last()
            .map(|h: &HoldingRow| encode_cursor(&[&h.asset_id]))
    } else {
        None
    };

    Ok(Json(json!({
        "address": address,
        "roles": roles,
        "holdings": holdings,
        "holdingsNextCursor": next_cursor,
        "holdingsHasNextPage": has_next,
        "attribution": "protocol",
    })))
}
