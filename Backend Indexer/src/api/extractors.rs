//! Shared API plumbing: the universal cursor-pagination envelope (`backend.md §5.1.1`), an
//! opaque keyset-cursor codec, and a minimal error type. BI-M5 hardens error handling and adds
//! the remaining filters; the envelope shape it builds on is fixed here.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use serde_json::json;

/// Default page size and the hard cap (`backend.md §5.1.1`).
pub const DEFAULT_LIMIT: i64 = 20;
pub const MAX_LIMIT: i64 = 100;

/// Clamp a requested `?limit=` into `[1, MAX_LIMIT]`, defaulting to [`DEFAULT_LIMIT`].
pub fn clamp_limit(requested: Option<i64>) -> i64 {
    requested.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}

/// The universal list envelope: `{ "data": [...], "nextCursor": ..., "hasNextPage": ... }`.
/// Never serialize a bare array (`backend.md §5.1.1`).
#[derive(Debug, Serialize)]
pub struct Page<T> {
    pub data: Vec<T>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: Option<String>,
    #[serde(rename = "hasNextPage")]
    pub has_next_page: bool,
}

impl<T> Page<T> {
    /// Build a page from a `limit + 1` over-fetch: if an extra row came back there is a next
    /// page, so drop it and emit the cursor for the last *kept* row via `cursor_of`.
    pub fn from_overfetch<F>(mut rows: Vec<T>, limit: i64, cursor_of: F) -> Self
    where
        F: Fn(&T) -> String,
    {
        let has_next_page = rows.len() as i64 > limit;
        if has_next_page {
            rows.truncate(limit as usize);
        }
        let next_cursor = if has_next_page {
            rows.last().map(&cursor_of)
        } else {
            None
        };
        Page {
            data: rows,
            next_cursor,
            has_next_page,
        }
    }
}

/// Encode keyset components into one opaque token (`backend.md §5.1.1` — the client echoes it
/// back verbatim and must not parse it). Lowercase-hex of the `\u{1f}`-joined parts;
/// dependency-free and round-trips exactly.
pub fn encode_cursor(parts: &[&str]) -> String {
    let joined = parts.join("\u{1f}");
    crate::ingestion::event_types::hex_encode(joined.as_bytes())
}

/// Inverse of [`encode_cursor`]. Returns `None` if the token is malformed (treated as "no
/// cursor" by callers, i.e. the request is rejected upstream as a bad cursor).
pub fn decode_cursor(token: &str) -> Option<Vec<String>> {
    if token.len() % 2 != 0 {
        return None;
    }
    let mut bytes = Vec::with_capacity(token.len() / 2);
    let raw = token.as_bytes();
    let mut i = 0;
    while i < raw.len() {
        let hi = (raw[i] as char).to_digit(16)?;
        let lo = (raw[i + 1] as char).to_digit(16)?;
        bytes.push(((hi << 4) | lo) as u8);
        i += 2;
    }
    let s = String::from_utf8(bytes).ok()?;
    Some(s.split('\u{1f}').map(|p| p.to_string()).collect())
}

/// A malformed cursor is reported as an `invalid_param` on the `cursor` field (`backend.md §5.1.1`
/// — the client must echo the token verbatim, so a non-round-tripping one is a bad request).
fn bad_cursor() -> ApiError {
    ApiError::invalid_param("cursor", "malformed pagination cursor")
}

/// Decode a 2-component `(i64, i64)` keyset cursor (time-series feeds: `(timestamp_ms, id)`).
pub fn decode_cursor_ii(token: &str) -> Result<(i64, i64), ApiError> {
    let parts = decode_cursor(token).ok_or_else(bad_cursor)?;
    match parts.as_slice() {
        [a, b] => Ok((
            a.parse().map_err(|_| bad_cursor())?,
            b.parse().map_err(|_| bad_cursor())?,
        )),
        _ => Err(bad_cursor()),
    }
}

/// Decode a 2-component `(i64, String)` keyset cursor (the `/assets` list: `(created_at_ms, asset_id)`).
pub fn decode_cursor_is(token: &str) -> Result<(i64, String), ApiError> {
    let parts = decode_cursor(token).ok_or_else(bad_cursor)?;
    match parts.as_slice() {
        [a, b] => Ok((a.parse().map_err(|_| bad_cursor())?, b.clone())),
        _ => Err(bad_cursor()),
    }
}

/// Parse an optional integer query param, mapping a non-numeric value to a `400 invalid_param`
/// (`backend.md §5.1` filter validation). `None`/empty ⇒ no filter. Keeping these params as
/// `String` in the route's `Query` struct (then parsing here) is what lets a bad value surface as
/// our typed error shape rather than axum's default deserialization 400.
pub fn parse_opt_i16(param: &str, raw: Option<&str>) -> Result<Option<i16>, ApiError> {
    match raw.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(s) => s
            .parse::<i16>()
            .map(Some)
            .map_err(|_| ApiError::invalid_param(param, "expected an integer")),
    }
}

/// API error → HTTP status + typed JSON body (`m5.md` error contract): `404 {error:"not_found",id}`,
/// `400 {error:"invalid_param",param,reason}`, `500 {error:"internal"}` (no internals leaked).
#[derive(Debug)]
pub enum ApiError {
    /// Unknown id (carries the looked-up id for the `404` body).
    NotFound(Option<String>),
    /// A malformed / out-of-contract query parameter.
    InvalidParam { param: String, reason: String },
    Internal(anyhow::Error),
}

impl ApiError {
    /// `404 not_found` for a specific id.
    pub fn not_found(id: &str) -> Self {
        ApiError::NotFound(Some(id.to_string()))
    }
    /// `400 invalid_param` for a named query parameter.
    pub fn invalid_param(param: &str, reason: &str) -> Self {
        ApiError::InvalidParam {
            param: param.to_string(),
            reason: reason.to_string(),
        }
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        ApiError::Internal(e)
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        ApiError::Internal(e.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, body) = match self {
            ApiError::NotFound(id) => (
                StatusCode::NOT_FOUND,
                json!({ "error": "not_found", "id": id }),
            ),
            ApiError::InvalidParam { param, reason } => (
                StatusCode::BAD_REQUEST,
                json!({ "error": "invalid_param", "param": param, "reason": reason }),
            ),
            ApiError::Internal(e) => {
                // Logged server-side; the body never leaks internals (`m5.md`).
                tracing::error!(error = %e, "internal API error");
                (StatusCode::INTERNAL_SERVER_ERROR, json!({ "error": "internal" }))
            }
        };
        (status, Json(body)).into_response()
    }
}
