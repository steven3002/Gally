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

/// Build the API router. BI-M1 exposes only `/health`; feed/object routes land in BI-M2..BI-M7.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(routes::health::health))
        .with_state(state)
}
