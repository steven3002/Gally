//! Integration test crate. One submodule per area: ingestion + DB + handlers
//! (`test_ingestion`) and the HTTP API surface (`test_api`, added in BI-M2).

mod test_api;
mod test_ingestion;

use std::sync::Arc;
use std::time::Duration;

use gally_indexer::sui_client::{ObjectProxy, SuiClient};

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
