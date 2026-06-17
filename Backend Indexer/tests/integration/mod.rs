//! Integration test crate. One submodule per area: ingestion + DB + handlers
//! (`test_ingestion`), the HTTP API surface (`test_api`, BI-M2), and the end-to-end protocol
//! lifecycle replay (`test_lifecycle`, BI-M7).

mod test_api;
mod test_ingestion;
mod test_lifecycle;

use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use gally_indexer::api::AppState;
use gally_indexer::metrics::Metrics;
use gally_indexer::sui_client::{ChainTip, CheckpointSource, ObjectProxy, SuiClient};
use gally_indexer::ws::Hub;
use sqlx::PgPool;

/// A throwaway object proxy for endpoints that don't touch the Sui RPC (the bulk of the suite).
/// Points at an unroutable URL — any handler that actually calls it would error, which is how we
/// know the DB-only paths never do. Proxy tests inject their own fixture source instead.
pub fn default_objects() -> Arc<ObjectProxy> {
    Arc::new(ObjectProxy::new(
        Arc::new(SuiClient::new("http://127.0.0.1:1")),
        "0xpkg",
        Duration::from_secs(5),
    ))
}

/// A fresh WebSocket fan-out hub (BI-M7). Tests that assert live push keep a clone to publish on.
pub fn default_hub() -> Arc<Hub> {
    Arc::new(Hub::new())
}

/// A fresh metrics registry (BI-M7). Each test gets its own so counter assertions are isolated.
pub fn default_metrics() -> Arc<Metrics> {
    Arc::new(Metrics::new())
}

/// A fixture [`CheckpointSource`]: `Some(n)` reports tip `n`; `None` models an unreachable node.
struct MockTip(Option<u64>);

#[async_trait]
impl CheckpointSource for MockTip {
    async fn latest_checkpoint(&self) -> Result<u64> {
        self.0.ok_or_else(|| anyhow!("node unreachable"))
    }
}

/// A [`ChainTip`] backed by a fixture: `Some(n)` ⇒ tip `n`; `None` ⇒ `/health` sees the node as
/// unreachable. TTL is short so cache freshness never masks the fixture value within a test.
pub fn tip_at(value: Option<u64>) -> Arc<ChainTip> {
    Arc::new(ChainTip::new(Arc::new(MockTip(value)), Duration::from_secs(1)))
}

/// Build an [`AppState`] from parts, defaulting the BI-M7 fields a given test doesn't care about
/// (hub/metrics fresh, tip at 0 ⇒ `/health` "ok", lag threshold 100).
pub fn app_state(pool: PgPool, objects: Arc<ObjectProxy>) -> AppState {
    AppState {
        pool,
        objects,
        hub: default_hub(),
        metrics: default_metrics(),
        tip: tip_at(Some(0)),
        lag_alert_checkpoints: 100,
    }
}

/// Bind the app on an ephemeral port, spawn it, and return its base URL (`http://127.0.0.1:PORT`).
pub async fn spawn(state: AppState) -> String {
    let app = gally_indexer::api::router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}
