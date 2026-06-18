//! `/assets*` routes. BI-M2: list (`?state=`/`?entity=` + pagination), detail, and state
//! history. The raise-progress, yield, wrap-ratio, tranche, dispute, and holder feeds land in
//! BI-M3/BI-M4/BI-M5. Response shapes: `logic_flow.md §6.1`; envelope: `backend.md §5.1.1`.

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::api::extractors::{
    clamp_limit, decode_cursor_ii, decode_cursor_is, encode_cursor, parse_opt_i16, ApiError, Page,
};
use crate::api::AppState;
use crate::db::models::{
    AccumulatorBalancesRow, AssetRow, AssetStateChangeRow, DisputeRow, RaiseProgressRow,
    TrancheRow, WrapRatioRow, YieldIndexRow,
};
use crate::db::queries;

/// `GET /assets` query params: optional `?state=` (int) / `?entity=` (address) filters plus the
/// universal `?limit=` / `?cursor=`. `state` is taken as a `String` so a non-numeric value surfaces
/// as `400 invalid_param` (filter validation) rather than axum's default deserialization error.
#[derive(Debug, Deserialize)]
pub struct AssetListQuery {
    pub state: Option<String>,
    pub entity: Option<String>,
    /// BI-M8: `?category=` (LI-D4 enum int) and `?q=` (case-insensitive name search). `category` is a
    /// `String` so a non-numeric value surfaces as `400 invalid_param` (filter validation).
    pub category: Option<String>,
    pub q: Option<String>,
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

/// `GET /assets` — keyset-paginated asset list (newest-key-last, ordered by `(created_at_ms,
/// asset_id)`). BI-M8 adds the `?category=` filter and `?q=` name search.
pub async fn list_assets(
    State(state): State<AppState>,
    Query(q): Query<AssetListQuery>,
) -> Result<Json<Page<AssetRow>>, ApiError> {
    let limit = clamp_limit(q.limit);
    let state_filter = parse_opt_i16("state", q.state.as_deref())?;
    let category = parse_opt_i16("category", q.category.as_deref())?;
    let cursor = match q.cursor.as_deref() {
        Some(tok) => Some(decode_cursor_is(tok)?),
        None => None,
    };
    let rows = queries::list_assets(
        &state.pool,
        state_filter,
        q.entity.as_deref(),
        category,
        q.q.as_deref(),
        cursor,
        limit,
    )
    .await
    .map_err(ApiError::from)?;
    Ok(Json(Page::from_overfetch(rows, limit, |r: &AssetRow| {
        encode_cursor(&[&r.created_at_ms.to_string(), &r.asset_id])
    })))
}

/// `GET /assets/:asset_id` — single asset record (404 if unknown). BI-M8 enriches the record with
/// the backend-served `apy` (§8.3) and the folded `accumulator` balances (LI-D9), so the explorer's
/// detail + token pages read everything from the DB (object proxy is a fallback only).
pub async fn get_asset(
    State(state): State<AppState>,
    Path(asset_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let row = queries::get_asset(&state.pool, &asset_id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(&asset_id))?;
    let apy = queries::compute_apy(&state.pool, &asset_id)
        .await
        .map_err(ApiError::from)?;
    let balances = queries::current_accumulator_balances(&state.pool, &asset_id)
        .await
        .map_err(ApiError::from)?;
    let mut v = serde_json::to_value(&row).map_err(|e| ApiError::from(anyhow::Error::from(e)))?;
    let obj = v.as_object_mut().expect("AssetRow serializes to an object");
    obj.insert("apy".to_string(), json!(apy));
    obj.insert(
        "accumulator".to_string(),
        serde_json::to_value(&balances).map_err(|e| ApiError::from(anyhow::Error::from(e)))?,
    );
    Ok(Json(v))
}

/// `GET /assets/:asset_id/accumulator` — the folded current pool balances (LI-D9; shape =
/// `AccumulatorBalancesRow`). 404 if the asset is unknown; all-`null` fields if no balance event
/// has landed yet (e.g. a never-defaulted asset's compensation pool).
pub async fn accumulator(
    State(state): State<AppState>,
    Path(asset_id): Path<String>,
) -> Result<Json<AccumulatorBalancesRow>, ApiError> {
    // Existence check (same denominator query the holders ledger uses).
    queries::asset_goal(&state.pool, &asset_id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(&asset_id))?;
    let balances = queries::current_accumulator_balances(&state.pool, &asset_id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(balances))
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
        .ok_or_else(|| ApiError::not_found(&asset_id))?;

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

// ===========================================================================
// BI-M4 — yield curve / wrap-ratio / tranches / per-asset disputes
// ===========================================================================

/// `GET /assets/:asset_id/yield` — the index curve ascending by `(timestamp_ms, id)` (shape
/// `logic_flow.md §6.3`).
pub async fn yield_curve(
    State(state): State<AppState>,
    Path(asset_id): Path<String>,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<Page<YieldIndexRow>>, ApiError> {
    let limit = clamp_limit(q.limit);
    let cursor = match q.cursor.as_deref() {
        Some(tok) => Some(decode_cursor_ii(tok)?),
        None => None,
    };
    let rows = queries::list_yield_index(&state.pool, &asset_id, cursor, limit)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(Page::from_overfetch(
        rows,
        limit,
        |r: &YieldIndexRow| encode_cursor(&[&r.timestamp_ms.to_string(), &r.id.to_string()]),
    )))
}

/// `GET /assets/:asset_id/wrap-ratio` — the `total_wrapped_after` series from wrap/unwrap
/// `position_events`, ascending by `(timestamp_ms, id)`.
pub async fn wrap_ratio(
    State(state): State<AppState>,
    Path(asset_id): Path<String>,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<Page<WrapRatioRow>>, ApiError> {
    let limit = clamp_limit(q.limit);
    let cursor = match q.cursor.as_deref() {
        Some(tok) => Some(decode_cursor_ii(tok)?),
        None => None,
    };
    let rows = queries::list_wrap_ratio(&state.pool, &asset_id, cursor, limit)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(Page::from_overfetch(
        rows,
        limit,
        |r: &WrapRatioRow| encode_cursor(&[&r.timestamp_ms.to_string(), &r.id.to_string()]),
    )))
}

/// `GET /assets/:asset_id/tranches` — the milestone **timeline** (`data`, ordered by
/// `(tranche_index, id)`, keyset-paginated as before) **plus** the full declared `schedule` array
/// (BI-M8, LI-D8), so unreleased tranches are visible. The `schedule` is the small bounded set from
/// `AssetCreatedEvent` (not paginated); `data` keeps its keyset cursor magnitude `(tranche_index,
/// id)`.
pub async fn tranches(
    State(state): State<AppState>,
    Path(asset_id): Path<String>,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<Value>, ApiError> {
    let limit = clamp_limit(q.limit);
    let cursor = match q.cursor.as_deref() {
        Some(tok) => Some(decode_cursor_ii(tok)?),
        None => None,
    };
    let rows = queries::list_tranches(&state.pool, &asset_id, cursor, limit)
        .await
        .map_err(ApiError::from)?;
    let schedule = queries::list_tranche_schedule(&state.pool, &asset_id)
        .await
        .map_err(ApiError::from)?;
    let page = Page::from_overfetch(rows, limit, |r: &TrancheRow| {
        encode_cursor(&[&(r.tranche_index as i64).to_string(), &r.id.to_string()])
    });
    Ok(Json(json!({
        "data": page.data,
        "nextCursor": page.next_cursor,
        "hasNextPage": page.has_next_page,
        "schedule": schedule,
    })))
}

/// `GET /assets/:asset_id/disputes` — disputes targeting this asset, ordered by `(opened_at_ms,
/// dispute_id)` (shape `logic_flow.md §6.5`).
pub async fn asset_disputes(
    State(state): State<AppState>,
    Path(asset_id): Path<String>,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<Page<DisputeRow>>, ApiError> {
    let limit = clamp_limit(q.limit);
    let cursor = match q.cursor.as_deref() {
        Some(tok) => Some(decode_cursor_is(tok)?),
        None => None,
    };
    let rows = queries::list_disputes(&state.pool, Some(&asset_id), None, None, None, cursor, limit)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(Page::from_overfetch(rows, limit, |r: &DisputeRow| {
        encode_cursor(&[&r.opened_at_ms.to_string(), &r.dispute_id])
    })))
}
