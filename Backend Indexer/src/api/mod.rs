//! Axum router assembly + shared application state.

pub mod extractors;
pub mod routes;

use axum::{routing::get, Router};
use sqlx::PgPool;

/// Shared state handed to every request handler.
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
}

/// Build the API router. BI-M2 added `/assets*` + `/governance`; BI-M3 adds validator, portfolio,
/// raise-progress, and holder-ledger endpoints. Dispute, object-proxy, and WebSocket routes land
/// in BI-M4..BI-M7.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(routes::health::health))
        .route("/assets", get(routes::assets::list_assets))
        .route("/assets/:asset_id", get(routes::assets::get_asset))
        .route("/assets/:asset_id/history", get(routes::assets::asset_history))
        .route(
            "/assets/:asset_id/raise-progress",
            get(routes::assets::raise_progress),
        )
        .route("/assets/:asset_id/holders", get(routes::assets::holders))
        .route("/governance", get(routes::governance::list_governance))
        .route("/validators", get(routes::validators::list_validators))
        .route("/validators/:pool_id", get(routes::validators::get_validator))
        .route("/portfolio/:address", get(routes::portfolio::portfolio))
        .route(
            "/portfolio/:address/assets",
            get(routes::portfolio::portfolio_assets),
        )
        .with_state(state)
}
