//! Startup: load config → connect DB → run migrations → spawn ingestion loop → serve API.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use gally_indexer::{
    api,
    config::Config,
    db, ingestion,
    metrics::Metrics,
    sui_client::{ChainTip, ObjectProxy, SuiClient},
    ws::Hub,
};
use tracing_subscriber::EnvFilter;

/// Chain-tip cache TTL for `/health` (`m7.md` — the latest checkpoint is cached for 10s).
const CHAIN_TIP_TTL_SECS: u64 = 10;

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

    // Process-wide metrics + WebSocket fan-out hub, shared between ingestion and the API (BI-M7).
    let metrics = Arc::new(Metrics::new());
    let hub = Arc::new(Hub::new());

    // The object proxy (BI-M6) shares the same fullnode; its own cached client is independent of
    // the ingestion sweep's client. It feeds the proxy cache-hit counter (BI-M7).
    let objects = Arc::new(
        ObjectProxy::new(
            Arc::new(SuiClient::new(config.sui_node_url.clone())),
            config.gally_package_id.clone(),
            Duration::from_secs(config.object_cache_ttl_secs),
        )
        .with_metrics(metrics.clone()),
    );

    // Chain-tip reader for `/health` lag alerting (cached ≤10s).
    let tip = Arc::new(ChainTip::new(
        Arc::new(SuiClient::new(config.sui_node_url.clone())),
        Duration::from_secs(CHAIN_TIP_TTL_SECS),
    ));

    // Ingestion loop runs in the background; the API server runs in the foreground.
    let ingest_pool = pool.clone();
    let sui = SuiClient::new(config.sui_node_url.clone());
    let package_id = config.gally_package_id.clone();
    let ingest_hub = hub.clone();
    let ingest_metrics = metrics.clone();
    tokio::spawn(async move {
        if let Err(e) =
            ingestion::run(ingest_pool, sui, package_id, 2, ingest_hub, ingest_metrics).await
        {
            tracing::error!(error = %e, "ingestion loop exited");
        }
    });

    // Abuse resistance for the public, key-less API (`api::limit`): per-IP rate limit
    // + global in-flight cap + timeout + body cap (request-scoped), and a process-wide
    // WebSocket connection cap (set once here).
    api::limit::configure_ws_cap(config.max_ws_connections);
    let limits = api::limit::Limits::new(
        config.rate_limit_per_sec,
        config.rate_limit_burst,
        config.max_concurrent_requests,
        config.request_timeout_secs,
        config.max_body_bytes,
        api::limit::parse_trusted_ips(&config.rate_limit_trusted_ips),
    );
    tracing::info!(
        rate_per_sec = config.rate_limit_per_sec,
        burst = config.rate_limit_burst,
        max_concurrent = config.max_concurrent_requests,
        max_ws = config.max_ws_connections,
        "API abuse-resistance limits active"
    );

    let app = api::router_with_limits(
        api::AppState {
            pool,
            objects,
            hub,
            metrics,
            tip,
            lag_alert_checkpoints: config.lag_alert_checkpoints as i64,
        },
        limits,
    );
    let listener = tokio::net::TcpListener::bind(&config.api_bind)
        .await
        .with_context(|| format!("failed to bind {}", config.api_bind))?;
    tracing::info!(bind = %config.api_bind, "API listening");
    // `into_make_service_with_connect_info` exposes the TCP peer to the rate limiter
    // (the fallback when no `X-Forwarded-For`/`X-Real-IP` proxy header is present).
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await
    .context("API server error")?;
    Ok(())
}
