//! Configuration from environment variables (12-factor; logic_flow.md §7).

use anyhow::{Context, Result};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    /// PostgreSQL connection string (required).
    pub database_url: String,
    /// Sui fullnode JSON-RPC URL (required).
    pub sui_node_url: String,
    /// Sui fullnode gRPC URL (optional; live streaming lands in BI-M7).
    #[serde(default)]
    pub sui_grpc_url: Option<String>,
    /// Published `gally_core` package address (required).
    pub gally_package_id: String,
    /// Checkpoint to begin ingestion from (0 = genesis; ignored if a DB cursor exists).
    #[serde(default)]
    pub gally_start_checkpoint: u64,
    /// HTTP listen address.
    #[serde(default = "default_api_bind")]
    pub api_bind: String,
    /// Object proxy cache TTL in seconds (BI-M6).
    #[serde(default = "default_cache_ttl")]
    pub object_cache_ttl_secs: u64,
    /// Checkpoints behind before `/health` returns 503 (BI-M7).
    #[serde(default = "default_lag_alert")]
    pub lag_alert_checkpoints: u64,

    // --- abuse resistance for the public, key-less API (`api::limit`) ---
    /// Sustained per-IP request rate (req/sec) once the burst is spent; `0` disables.
    #[serde(default = "default_rate_per_sec")]
    pub rate_limit_per_sec: f64,
    /// Per-IP burst allowance (instant requests from a fresh IP).
    #[serde(default = "default_burst")]
    pub rate_limit_burst: f64,
    /// Process-wide cap on concurrently-served requests before shedding `503`.
    #[serde(default = "default_max_concurrent")]
    pub max_concurrent_requests: usize,
    /// Cap on concurrent WebSocket connections before refusing the upgrade with `503`.
    #[serde(default = "default_max_ws")]
    pub max_ws_connections: usize,
    /// Per-request wall-clock budget before `408`.
    #[serde(default = "default_request_timeout")]
    pub request_timeout_secs: u64,
    /// Inbound request-body cap (bytes).
    #[serde(default = "default_max_body")]
    pub max_body_bytes: usize,
    /// Comma-separated IPs exempt from the per-IP rate limit (default loopback, so a
    /// co-located frontend SSR / reverse proxy isn't throttled).
    #[serde(default = "default_trusted_ips")]
    pub rate_limit_trusted_ips: String,
}

fn default_api_bind() -> String {
    // Honour a platform-injected `$PORT` (Render / Railway / Fly / Cloud Run) when
    // `API_BIND` is not set explicitly; fall back to 8080 for local runs.
    match std::env::var("PORT") {
        Ok(p) if !p.trim().is_empty() => format!("0.0.0.0:{}", p.trim()),
        _ => "0.0.0.0:8080".to_string(),
    }
}
fn default_cache_ttl() -> u64 {
    5
}
fn default_lag_alert() -> u64 {
    100
}
fn default_rate_per_sec() -> f64 {
    crate::api::limit::DEFAULT_RATE_PER_SEC
}
fn default_burst() -> f64 {
    crate::api::limit::DEFAULT_BURST
}
fn default_max_concurrent() -> usize {
    crate::api::limit::DEFAULT_MAX_CONCURRENT
}
fn default_max_ws() -> usize {
    crate::api::limit::DEFAULT_MAX_WS
}
fn default_request_timeout() -> u64 {
    crate::api::limit::DEFAULT_TIMEOUT_SECS
}
fn default_max_body() -> usize {
    crate::api::limit::DEFAULT_MAX_BODY_BYTES
}
fn default_trusted_ips() -> String {
    crate::api::limit::DEFAULT_TRUSTED_IPS.to_string()
}

impl Config {
    /// Read configuration from the process environment. Fails fast with a clear message if
    /// a required variable (`DATABASE_URL`, `SUI_NODE_URL`, `GALLY_PACKAGE_ID`) is missing.
    pub fn from_env() -> Result<Self> {
        config::Config::builder()
            .add_source(config::Environment::default().try_parsing(true))
            .build()
            .context("failed to read environment configuration")?
            .try_deserialize()
            .context(
                "missing or invalid configuration; required env vars: \
                 DATABASE_URL, SUI_NODE_URL, GALLY_PACKAGE_ID",
            )
    }
}
