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
}

fn default_api_bind() -> String {
    "0.0.0.0:8080".to_string()
}
fn default_cache_ttl() -> u64 {
    5
}
fn default_lag_alert() -> u64 {
    100
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
