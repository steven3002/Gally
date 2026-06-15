//! Thin Sui fullnode JSON-RPC client (`suix_queryEvents` + `sui_getObject`).
//!
//! BI-M1 deliberately avoids the heavy `sui-sdk` git dependency: the indexer needs only a
//! couple of JSON-RPC methods, and a `reqwest`-based client builds fast and offline. The
//! wire-type rules it must honor (`u64`/`u128` as JSON strings, `vector<u8>` as byte arrays)
//! are catalogued in `logic_flow.md §10.2`; typed deserialization lands in BI-M2.

use anyhow::{Context, Result};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};

/// Sui event identity (`{txDigest, eventSeq}`). `eventSeq` arrives as a JSON string.
#[derive(Debug, Clone, Deserialize)]
pub struct EventId {
    #[serde(rename = "txDigest")]
    pub tx_digest: String,
    #[serde(rename = "eventSeq")]
    pub event_seq: String,
}

/// One event as returned by `suix_queryEvents`.
#[derive(Debug, Clone, Deserialize)]
pub struct SuiEvent {
    pub id: EventId,
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(rename = "parsedJson")]
    pub parsed_json: Value,
    #[serde(rename = "timestampMs")]
    pub timestamp_ms: Option<String>,
}

/// A page of events plus its pagination cursor.
#[derive(Debug, Clone, Deserialize)]
pub struct EventPage {
    pub data: Vec<SuiEvent>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: Option<EventId>,
    #[serde(rename = "hasNextPage")]
    pub has_next_page: bool,
}

/// HTTP JSON-RPC client against a single Sui fullnode.
pub struct SuiClient {
    http: Client,
    rpc_url: String,
}

impl SuiClient {
    pub fn new(rpc_url: impl Into<String>) -> Self {
        Self {
            http: Client::new(),
            rpc_url: rpc_url.into(),
        }
    }

    async fn rpc(&self, method: &str, params: Value) -> Result<Value> {
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let mut resp: Value = self
            .http
            .post(&self.rpc_url)
            .json(&body)
            .send()
            .await
            .with_context(|| format!("{method}: request failed"))?
            .json()
            .await
            .with_context(|| format!("{method}: invalid JSON response"))?;
        if !resp["error"].is_null() {
            anyhow::bail!("{method}: RPC error: {}", resp["error"]);
        }
        Ok(resp["result"].take())
    }

    /// `suix_queryEvents` filtered by `MoveEventModule { package, module }`, ascending,
    /// cursor-paginated. `queryEvents` cannot filter by package alone, so the ingestion loop
    /// sweeps each module (see the per-event-type caveat in `logic_flow.md §2.1`).
    pub async fn query_events_by_module(
        &self,
        package: &str,
        module: &str,
        cursor: Option<EventId>,
        limit: usize,
    ) -> Result<EventPage> {
        let filter = json!({ "MoveEventModule": { "package": package, "module": module } });
        let cursor_val = match cursor {
            Some(c) => json!({ "txDigest": c.tx_digest, "eventSeq": c.event_seq }),
            None => Value::Null,
        };
        let params = json!([filter, cursor_val, limit, false]);
        let result = self.rpc("suix_queryEvents", params).await?;
        serde_json::from_value(result).context("suix_queryEvents: failed to parse event page")
    }

    /// `sui_getObject` with content + type + owner. Returns the raw RPC `result` (used by the
    /// object proxy in BI-M6).
    pub async fn get_object(&self, id: &str) -> Result<Value> {
        let opts = json!({ "showType": true, "showContent": true, "showOwner": true });
        self.rpc("sui_getObject", json!([id, opts])).await
    }
}
