//! `/disputes*` routes (BI-M4): the global dispute feed with `?verdict=` / `?pool_id=` filters and
//! cursor pagination, plus a detail view that embeds the per-juror vote log. Response item shape:
//! `logic_flow.md §6.5`; envelope: `backend.md §5.1.1`. The per-asset variant lives on
//! `/assets/:id/disputes` (`routes::assets::asset_disputes`).

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::extractors::{
    clamp_limit, decode_cursor_is, encode_cursor, parse_opt_i16, ApiError, Page,
};
use crate::api::AppState;
use crate::db::models::DisputeRow;
use crate::db::queries;

/// Embedded vote-log cap for the detail view.
const DETAIL_VOTES_LIMIT: i64 = 100;

/// `GET /disputes` query params: optional `?verdict=` (int) / `?pool_id=` (target pool) /
/// `?challenger=` (filer address) filters plus the universal `?limit=` / `?cursor=`. `verdict` is a
/// `String` so a non-numeric value surfaces as `400 invalid_param` (filter validation).
#[derive(Debug, Deserialize)]
pub struct DisputeListQuery {
    pub verdict: Option<String>,
    pub pool_id: Option<String>,
    pub challenger: Option<String>,
    pub asset_id: Option<String>,
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

/// `GET /disputes` — keyset-paginated dispute list (ordered by `(opened_at_ms, dispute_id)`).
pub async fn list_disputes(
    State(state): State<AppState>,
    Query(q): Query<DisputeListQuery>,
) -> Result<Json<Page<DisputeRow>>, ApiError> {
    let limit = clamp_limit(q.limit);
    let verdict = parse_opt_i16("verdict", q.verdict.as_deref())?;
    let cursor = match q.cursor.as_deref() {
        Some(tok) => Some(decode_cursor_is(tok)?),
        None => None,
    };
    let rows = queries::list_disputes(
        &state.pool,
        q.asset_id.as_deref(),
        verdict,
        q.pool_id.as_deref(),
        q.challenger.as_deref(),
        cursor,
        limit,
    )
    .await
    .map_err(ApiError::from)?;
    Ok(Json(Page::from_overfetch(rows, limit, |r: &DisputeRow| {
        encode_cursor(&[&r.opened_at_ms.to_string(), &r.dispute_id])
    })))
}

/// `GET /disputes/:dispute_id` — the dispute row (with vote tallies) + the full per-juror vote log
/// (404 if unknown). Single object; the embedded `jury_votes` array is capped.
pub async fn get_dispute(
    State(state): State<AppState>,
    Path(dispute_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let d = queries::get_dispute(&state.pool, &dispute_id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(&dispute_id))?;
    let votes = queries::list_jury_votes(&state.pool, &dispute_id, DETAIL_VOTES_LIMIT)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({
        "dispute_id": d.dispute_id,
        "asset_id": d.asset_id,
        "target_pool_id": d.target_pool_id,
        "challenger": d.challenger,
        "bond": d.bond.to_string(),
        "evidence_hash": d.evidence_hash,
        "opened_at_ms": d.opened_at_ms,
        "resolved_at_ms": d.resolved_at_ms,
        "verdict": d.verdict,
        "slashed": d.slashed.map(|v| v.to_string()),
        "bounty": d.bounty.map(|v| v.to_string()),
        "votes_guilty": d.votes_guilty,
        "votes_innocent": d.votes_innocent,
        "votes_guilty_after": d.votes_guilty_after,
        "votes_innocent_after": d.votes_innocent_after,
        "jury_votes": votes,
    })))
}
