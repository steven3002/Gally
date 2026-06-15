//! Startup: load config → connect DB → run migrations → spawn ingestion loop → serve API.

use anyhow::{Context, Result};
use gally_indexer::{api, config::Config, db, ingestion, sui_client::SuiClient};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = Config::from_env()?;
    tracing::info!(package = %config.gally_package_id, "starting gally indexer");

    let pool = db::connect(&config.database_url).await?;
    db::run_migrations(&pool).await?;
    tracing::info!("migrations applied");

    // Ingestion loop runs in the background; the API server runs in the foreground.
    let ingest_pool = pool.clone();
    let sui = SuiClient::new(config.sui_node_url.clone());
    let package_id = config.gally_package_id.clone();
    tokio::spawn(async move {
        if let Err(e) = ingestion::run(ingest_pool, sui, package_id, 2).await {
            tracing::error!(error = %e, "ingestion loop exited");
        }
    });

    let app = api::router(api::AppState { pool });
    let listener = tokio::net::TcpListener::bind(&config.api_bind)
        .await
        .with_context(|| format!("failed to bind {}", config.api_bind))?;
    tracing::info!(bind = %config.api_bind, "API listening");
    axum::serve(listener, app).await.context("API server error")?;
    Ok(())
}
