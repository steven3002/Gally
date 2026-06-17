//! Object-proxy routes (BI-M6): `GET /objects/:id`, `/objects/:id/legal-docs` (a dynamic-field
//! read), and `/objects/:id/token-metadata` (the per-entity `CoinMetadata<T>` two-step). These let
//! the frontend read live on-chain state through the indexer's host (`backend.md §4.2`/`§4.4`).
//! All three are served and cached by [`crate::sui_client::ObjectProxy`] at `OBJECT_CACHE_TTL_SECS`.

use axum::extract::{Path, State};
use axum::Json;
use serde_json::Value;

use crate::api::extractors::ApiError;
use crate::api::AppState;

/// `GET /objects/:object_id` — the raw Sui object read (cached). 404 if the object does not exist.
pub async fn get_object(
    State(state): State<AppState>,
    Path(object_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    state
        .objects
        .object(&object_id)
        .await
        .map_err(ApiError::from)?
        .map(Json)
        .ok_or_else(|| ApiError::not_found(&object_id))
}

/// `GET /objects/:object_id/legal-docs` — the asset's `LegalDocsKey` dynamic field reshaped into
/// `[{blob_id, sha256, attested_by}]` (`§6.9`). 404 if the asset/field does not exist.
pub async fn legal_docs(
    State(state): State<AppState>,
    Path(object_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    state
        .objects
        .legal_docs(&object_id)
        .await
        .map_err(ApiError::from)?
        .map(Json)
        .ok_or_else(|| ApiError::not_found(&object_id))
}

/// `GET /objects/:object_id/token-metadata` — given an accumulator id, recover `T` from its type
/// string and resolve `CoinMetadata<T>` → `{ coin_type, symbol, name, decimals }` (`§4.4`). 404 if
/// the accumulator does not exist or its type carries no `<T>`.
pub async fn token_metadata(
    State(state): State<AppState>,
    Path(object_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    state
        .objects
        .token_metadata(&object_id)
        .await
        .map_err(ApiError::from)?
        .map(Json)
        .ok_or_else(|| ApiError::not_found(&object_id))
}
