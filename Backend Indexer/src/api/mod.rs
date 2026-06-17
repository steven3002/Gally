//! Axum router assembly + shared application state.

pub mod extractors;
pub mod routes;

use std::sync::Arc;

use axum::http::HeaderValue;
use axum::{routing::get, Router};
use sqlx::PgPool;
use tower_http::cors::{Any, CorsLayer};

use crate::metrics::Metrics;
use crate::sui_client::{ChainTip, ObjectProxy};
use crate::ws::Hub;

/// Shared state handed to every request handler. BI-M6 added the cached object proxy; BI-M7 adds
/// the WebSocket fan-out [`Hub`], the Prometheus [`Metrics`], the cached chain-tip reader
/// ([`ChainTip`], for `/health` lag), and the lag-alert threshold. `Arc` keeps each shared across
/// handler clones; the threshold is a plain copy.
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub objects: Arc<ObjectProxy>,
    pub hub: Arc<Hub>,
    pub metrics: Arc<Metrics>,
    pub tip: Arc<ChainTip>,
    /// Checkpoints behind the chain tip before `/health` reports `lagging` + 503 (`LAG_ALERT_CHECKPOINTS`).
    pub lag_alert_checkpoints: i64,
}

/// Build the API router. BI-M2 added `/assets*` + `/governance`; BI-M3 added validator, portfolio,
/// raise-progress, and holder-ledger endpoints; BI-M4 added the yield curve, wrap-ratio, tranche,
/// and dispute feeds; BI-M5 hardened filtering/pagination; BI-M6 completes the surface with the
/// account page (`/address/:addr`), the transaction lookup (`/tx/:digest`), and the object proxy
/// (`/objects/:id` + legal-docs + token-metadata), and applies CORS. BI-M7 adds the three
/// WebSocket channels, upgrades `/health` with lag alerting, and adds `/metrics`.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(routes::health::health))
        .route("/metrics", get(routes::metrics::metrics))
        .route("/assets", get(routes::assets::list_assets))
        .route("/assets/:asset_id", get(routes::assets::get_asset))
        .route("/assets/:asset_id/history", get(routes::assets::asset_history))
        .route(
            "/assets/:asset_id/raise-progress",
            get(routes::assets::raise_progress),
        )
        .route("/assets/:asset_id/holders", get(routes::assets::holders))
        .route("/assets/:asset_id/yield", get(routes::assets::yield_curve))
        .route("/assets/:asset_id/wrap-ratio", get(routes::assets::wrap_ratio))
        .route("/assets/:asset_id/tranches", get(routes::assets::tranches))
        .route("/assets/:asset_id/disputes", get(routes::assets::asset_disputes))
        .route("/governance", get(routes::governance::list_governance))
        .route("/validators", get(routes::validators::list_validators))
        .route("/validators/:pool_id", get(routes::validators::get_validator))
        .route("/address/:address", get(routes::address::address_summary))
        .route("/portfolio/:address", get(routes::portfolio::portfolio))
        .route(
            "/portfolio/:address/assets",
            get(routes::portfolio::portfolio_assets),
        )
        .route("/disputes", get(routes::disputes::list_disputes))
        .route("/disputes/:dispute_id", get(routes::disputes::get_dispute))
        .route("/tx/:digest", get(routes::tx::get_tx))
        .route("/objects/:object_id", get(routes::proxy::get_object))
        .route(
            "/objects/:object_id/legal-docs",
            get(routes::proxy::legal_docs),
        )
        .route(
            "/objects/:object_id/token-metadata",
            get(routes::proxy::token_metadata),
        )
        .route("/ws/assets/:asset_id", get(routes::ws::ws_asset))
        .route("/ws/portfolio/:address", get(routes::ws::ws_portfolio))
        .route("/ws/disputes/:dispute_id", get(routes::ws::ws_dispute))
        .layer(cors_layer())
        .with_state(state)
}

/// CORS middleware so the Next.js frontend can call this API cross-origin (`m6.md`). Allowed
/// origins come from `CORS_ALLOWED_ORIGINS` (comma-separated); the default (`*` / unset) is a
/// permissive dev policy. Any unparseable explicit origin is dropped.
fn cors_layer() -> CorsLayer {
    match std::env::var("CORS_ALLOWED_ORIGINS") {
        Ok(v) if !v.trim().is_empty() && v.trim() != "*" => {
            let origins: Vec<HeaderValue> = v
                .split(',')
                .filter_map(|s| s.trim().parse::<HeaderValue>().ok())
                .collect();
            CorsLayer::new()
                .allow_origin(origins)
                .allow_methods(Any)
                .allow_headers(Any)
        }
        _ => CorsLayer::permissive(),
    }
}
