//! `/assets*` routes. BI-M2: list (`?state=`/`?entity=` + pagination), detail, and state
//! history. The raise-progress, yield, wrap-ratio, tranche, dispute, and holder feeds land in
//! BI-M3/BI-M4/BI-M5. Response shapes: `logic_flow.md §6.1`; envelope: `backend.md §5.1.1`.

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::api::extractors::{
    clamp_limit, decode_cursor_ii, decode_cursor_is, encode_cursor, ApiError, Page,
};
use crate::api::AppState;
use crate::db::models::{AssetRow, AssetStateChangeRow, RaiseProgressRow};
use crate::db::queries;

/// `GET /assets` query params: optional `?state=` (int) / `?entity=` (address) filters plus the
/// universal `?limit=` / `?cursor=`.
#[derive(Debug, Deserialize)]
pub struct AssetListQuery {
    pub state: Option<i16>,
    pub entity: Option<String>,
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

/// `GET /assets` — keyset-paginated asset list (newest-key-last, ordered by `(created_at_ms,
/// asset_id)`).
pub async fn list_assets(
    State(state): State<AppState>,
    Query(q): Query<AssetListQuery>,
) -> Result<Json<Page<AssetRow>>, ApiError> {
    let limit = clamp_limit(q.limit);
    let cursor = match q.cursor.as_deref() {
        Some(tok) => Some(decode_cursor_is(tok)?),
        None => None,
    };
    let rows = queries::list_assets(&state.pool, q.state, q.entity.as_deref(), cursor, limit)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(Page::from_overfetch(rows, limit, |r: &AssetRow| {
        encode_cursor(&[&r.created_at_ms.to_string(), &r.asset_id])
    })))
}

/// `GET /assets/:asset_id` — single asset record (404 if unknown).
pub async fn get_asset(
    State(state): State<AppState>,
    Path(asset_id): Path<String>,
) -> Result<Json<AssetRow>, ApiError> {
    queries::get_asset(&state.pool, &asset_id)
        .await
        .map_err(ApiError::from)?
        .map(Json)
        .ok_or(ApiError::NotFound)
}

/// `GET /assets/:asset_id/history` query params: universal `?limit=` / `?cursor=`.
#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

/// `GET /assets/:asset_id/history` — state transitions in ascending `(timestamp_ms, id)` order.
pub async fn asset_history(
    State(state): State<AppState>,
    Path(asset_id): Path<String>,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<Page<AssetStateChangeRow>>, ApiError> {
    let limit = clamp_limit(q.limit);
    let cursor = match q.cursor.as_deref() {
        Some(tok) => Some(decode_cursor_ii(tok)?),
        None => None,
    };
    let rows = queries::list_asset_history(&state.pool, &asset_id, cursor, limit)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(Page::from_overfetch(
        rows,
        limit,
        |r: &AssetStateChangeRow| encode_cursor(&[&r.timestamp_ms.to_string(), &r.id.to_string()]),
    )))
}

/// `GET /assets/:asset_id/raise-progress` — `CapitalContributed` series ascending by
/// `(timestamp_ms, id)` (BI-M3; shape `logic_flow.md §6.2`).
pub async fn raise_progress(
    State(state): State<AppState>,
    Path(asset_id): Path<String>,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<Page<RaiseProgressRow>>, ApiError> {
    let limit = clamp_limit(q.limit);
    let cursor = match q.cursor.as_deref() {
        Some(tok) => Some(decode_cursor_ii(tok)?),
        None => None,
    };
    let rows = queries::list_raise_progress(&state.pool, &asset_id, cursor, limit)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(Page::from_overfetch(
        rows,
        limit,
        |r: &RaiseProgressRow| encode_cursor(&[&r.timestamp_ms.to_string(), &r.id.to_string()]),
    )))
}

/// One holder-ledger entry (`logic_flow.md §6.6`): all amounts as strings (§9.1).
#[derive(Debug, Serialize)]
struct HolderEntry {
    address: String,
    share_count: String,
    wrapped: String,
    pct_of_supply: String,
    acquired_at_ms: Option<i64>,
    yield_claimed_index: String,
}

/// `GET /assets/:asset_id/holders` — the ranked, protocol-attributed holder ledger **derived**
/// from `position_events` (the `§2.17` signed fold; no table). The envelope is the universal page
/// **plus** `attribution: "protocol"` and `total_minted_shares` (== `assets.goal`, the
/// `pct_of_supply` denominator). Ranked by `holding` DESC, keyset cursor `(holding, address)`.
pub async fn holders(
    State(state): State<AppState>,
    Path(asset_id): Path<String>,
    Query(q): Query<HoldersQuery>,
) -> Result<Json<Value>, ApiError> {
    // total_minted_shares == assets.goal; a 404 if the asset is unknown.
    let goal = queries::asset_goal(&state.pool, &asset_id)
        .await
        .map_err(ApiError::from)?
        .ok_or(ApiError::NotFound)?;

    let limit = clamp_limit(q.limit);
    let cursor = match q.cursor.as_deref() {
        Some(tok) => Some(decode_cursor_is(tok)?),
        None => None,
    };
    let folds = queries::list_holders(&state.pool, &asset_id, cursor, limit)
        .await
        .map_err(ApiError::from)?;

    let page = Page::from_overfetch(folds, limit, |r| {
        encode_cursor(&[&r.holding.to_string(), &r.address])
    });
    let entries: Vec<HolderEntry> = page
        .data
        .iter()
        .map(|r| HolderEntry {
            address: r.address.clone(),
            share_count: r.share_count.to_string(),
            wrapped: r.wrapped.to_string(),
            pct_of_supply: pct_of_supply(r.holding, goal),
            acquired_at_ms: r.acquired_at_ms,
            // §2.17: 0 if the holder never claimed yield.
            yield_claimed_index: r
                .yield_claimed_index
                .clone()
                .unwrap_or_else(|| "0".to_string()),
        })
        .collect();

    Ok(Json(json!({
        "data": entries,
        "nextCursor": page.next_cursor,
        "hasNextPage": page.has_next_page,
        "attribution": "protocol",
        "total_minted_shares": goal.to_string(),
    })))
}

/// `GET /assets/:asset_id/holders` query params: universal `?limit=` / `?cursor=`.
#[derive(Debug, Deserialize)]
pub struct HoldersQuery {
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

/// `(holding / goal) * 100`, two decimals (`logic_flow.md §6.6`, e.g. `"6.00"`).
fn pct_of_supply(holding: i64, goal: i64) -> String {
    if goal <= 0 {
        return "0.00".to_string();
    }
    format!("{:.2}", holding as f64 * 100.0 / goal as f64)
}
