//! Thin Sui fullnode JSON-RPC client (`suix_queryEvents` + object reads) and the BI-M6 object
//! proxy.
//!
//! BI-M1 deliberately avoids the heavy `sui-sdk` git dependency: the indexer needs only a
//! couple of JSON-RPC methods, and a `reqwest`-based client builds fast and offline. The
//! wire-type rules it must honor (`u64`/`u128` as JSON strings, `vector<u8>` as byte arrays)
//! are catalogued in `logic_flow.md §10.2`.
//!
//! BI-M6 adds the **object proxy** (`backend.md §4.2`): the frontend reads live object state
//! through the indexer's host rather than talking to Sui directly. The proxy is split into an
//! [`ObjectSource`] trait (the three RPC reads it needs) and an [`ObjectProxy`] wrapper that adds
//! the short-TTL in-memory cache (`logic_flow.md §9.6`). Splitting the two lets the integration
//! tests drive the proxy with a fixture source that counts calls, without a live node.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::Mutex;

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

/// The three object reads the proxy needs (`backend.md §4.2`/`§4.4`). Each returns the raw Sui RPC
/// `result` JSON; the proxy decides 404 vs. hit and reshapes. A trait (not a concrete client) so
/// the API tests can substitute a fixture source that counts calls — see [`ObjectProxy`].
#[async_trait]
pub trait ObjectSource: Send + Sync {
    /// `sui_getObject` with content/type/owner. A non-existent object is **not** an RPC error —
    /// the result carries `{ data: null, error: { code: "notExists", .. } }` (`ObjectProxy`
    /// treats absence of `data` as 404).
    async fn get_object(&self, id: &str) -> Result<Value>;
    /// `suix_getDynamicFieldObject` — used for the asset's `LegalDocsKey` field (`§4.2`). A plain
    /// `sui_getObject` does not return dynamic fields.
    async fn get_dynamic_field_object(
        &self,
        parent_id: &str,
        name_type: &str,
        name_value: Value,
    ) -> Result<Value>;
    /// `suix_getCoinMetadata::<T>` — the per-entity token's `symbol`/`name`/`decimals` (`§4.4`).
    async fn get_coin_metadata(&self, coin_type: &str) -> Result<Value>;
}

/// The chain-tip read `/health` needs (BI-M7): the latest checkpoint sequence number. A trait so
/// the lag-alert tests can drive [`ChainTip`] with a fixture (a fixed tip, or an "unreachable"
/// error) without a live node.
#[async_trait]
pub trait CheckpointSource: Send + Sync {
    async fn latest_checkpoint(&self) -> Result<u64>;
}

#[async_trait]
impl CheckpointSource for SuiClient {
    /// `sui_getLatestCheckpointSequenceNumber` — the result is a `BigInt` rendered as a JSON
    /// string (occasionally a bare number on some nodes); accept both.
    async fn latest_checkpoint(&self) -> Result<u64> {
        let result = self
            .rpc("sui_getLatestCheckpointSequenceNumber", json!([]))
            .await?;
        result
            .as_str()
            .and_then(|s| s.parse::<u64>().ok())
            .or_else(|| result.as_u64())
            .context("sui_getLatestCheckpointSequenceNumber: unparseable result")
    }
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
}

#[async_trait]
impl ObjectSource for SuiClient {
    async fn get_object(&self, id: &str) -> Result<Value> {
        let opts = json!({ "showType": true, "showContent": true, "showOwner": true });
        self.rpc("sui_getObject", json!([id, opts])).await
    }

    async fn get_dynamic_field_object(
        &self,
        parent_id: &str,
        name_type: &str,
        name_value: Value,
    ) -> Result<Value> {
        let name = json!({ "type": name_type, "value": name_value });
        self.rpc("suix_getDynamicFieldObject", json!([parent_id, name]))
            .await
    }

    async fn get_coin_metadata(&self, coin_type: &str) -> Result<Value> {
        self.rpc("suix_getCoinMetadata", json!([coin_type])).await
    }
}

/// A short-TTL caching wrapper over an [`ObjectSource`] — the live read path behind
/// `GET /objects/:id`, `/objects/:id/legal-docs`, and the per-entity token metadata resolution.
///
/// Cache (`logic_flow.md §9.6`): keyed on `<kind>:<id>` (`obj:`/`ld:`/`cm:`), TTL from
/// `OBJECT_CACHE_TTL_SECS`. Eviction is lazy — TTL is checked on read and the stale entry
/// replaced. Only successful (found) reads are cached; a 404 is re-checked each time.
pub struct ObjectProxy {
    source: Arc<dyn ObjectSource>,
    /// Published `gally_core` package id — needed to build the `LegalDocsKey` dynamic-field name
    /// type string (`<pkg>::asset::LegalDocsKey`).
    package_id: String,
    ttl: Duration,
    cache: Mutex<HashMap<String, (Instant, Value)>>,
    /// Optional metrics sink (BI-M7): counts cache hits/misses. `None` in tests that don't assert
    /// the counter, so the BI-M6 proxy fixtures keep working unchanged.
    metrics: Option<Arc<crate::metrics::Metrics>>,
}

impl ObjectProxy {
    pub fn new(source: Arc<dyn ObjectSource>, package_id: impl Into<String>, ttl: Duration) -> Self {
        Self {
            source,
            package_id: package_id.into(),
            ttl,
            cache: Mutex::new(HashMap::new()),
            metrics: None,
        }
    }

    /// Attach a metrics sink so cache hits/misses feed `gally_indexer_object_proxy_requests_total`.
    pub fn with_metrics(mut self, metrics: Arc<crate::metrics::Metrics>) -> Self {
        self.metrics = Some(metrics);
        self
    }

    /// Record one proxy call (`hit` = served from cache) if a metrics sink is attached.
    fn record(&self, hit: bool) {
        if let Some(m) = &self.metrics {
            m.record_proxy(hit);
        }
    }

    /// Return a live (non-stale) cache entry, evicting it if the TTL has elapsed.
    async fn cached(&self, key: &str) -> Option<Value> {
        let now = Instant::now();
        let mut guard = self.cache.lock().await;
        if let Some((at, v)) = guard.get(key) {
            if now.duration_since(*at) < self.ttl {
                return Some(v.clone());
            }
            guard.remove(key);
        }
        None
    }

    async fn store(&self, key: &str, v: Value) {
        self.cache
            .lock()
            .await
            .insert(key.to_string(), (Instant::now(), v));
    }

    /// `GET /objects/:id` — the raw Sui object read, cached. `None` ⇒ object does not exist (404).
    pub async fn object(&self, id: &str) -> Result<Option<Value>> {
        let key = format!("obj:{id}");
        if let Some(v) = self.cached(&key).await {
            self.record(true);
            return Ok(Some(v));
        }
        self.record(false);
        let result = self.source.get_object(id).await?;
        if !object_present(&result) {
            return Ok(None);
        }
        self.store(&key, result.clone()).await;
        Ok(Some(result))
    }

    /// `GET /objects/:id/legal-docs` — the asset's `LegalDocsKey` dynamic field reshaped into the
    /// §6.9 `[{blob_id, sha256, attested_by}]` array. `None` ⇒ the field (or asset) does not exist.
    pub async fn legal_docs(&self, asset_id: &str) -> Result<Option<Value>> {
        let key = format!("ld:{asset_id}");
        if let Some(v) = self.cached(&key).await {
            self.record(true);
            return Ok(Some(v));
        }
        self.record(false);
        let name_type = format!("{}::asset::LegalDocsKey", self.package_id);
        let result = self
            .source
            .get_dynamic_field_object(asset_id, &name_type, json!({}))
            .await?;
        if !object_present(&result) {
            return Ok(None);
        }
        let docs = Value::Array(extract_walrus_refs(&result));
        self.store(&key, docs.clone()).await;
        Ok(Some(docs))
    }

    /// Per-entity token metadata for an accumulator (`§4.4`): recover `T` from the accumulator
    /// object's type string, then resolve `CoinMetadata<T>`. Returns `{ coin_type, symbol, name,
    /// decimals }`. `None` ⇒ the accumulator does not exist or its type carries no `<T>`.
    pub async fn token_metadata(&self, accumulator_id: &str) -> Result<Option<Value>> {
        let obj = match self.object(accumulator_id).await? {
            Some(v) => v,
            None => return Ok(None),
        };
        let coin_type = match obj
            .pointer("/data/type")
            .and_then(Value::as_str)
            .and_then(extract_type_param)
        {
            Some(t) => t,
            None => return Ok(None),
        };
        let key = format!("cm:{coin_type}");
        if let Some(v) = self.cached(&key).await {
            return Ok(Some(v));
        }
        let meta = self.source.get_coin_metadata(&coin_type).await?;
        let fields = meta.get("data").unwrap_or(&meta); // tolerate `{data:{..}}` or a flat result
        let out = json!({
            "coin_type": coin_type,
            "symbol": fields.get("symbol").cloned().unwrap_or(Value::Null),
            "name": fields.get("name").cloned().unwrap_or(Value::Null),
            "decimals": fields.get("decimals").cloned().unwrap_or(Value::Null),
        });
        self.store(&key, out.clone()).await;
        Ok(Some(out))
    }
}

/// A short-TTL cache over a [`CheckpointSource`] — the chain tip `/health` compares the indexer
/// cursor against (BI-M7). The tip is fetched at most once per `ttl` (the spec's 10s) so a burst of
/// `/health` probes does not hammer the fullnode.
pub struct ChainTip {
    source: Arc<dyn CheckpointSource>,
    ttl: Duration,
    cache: Mutex<Option<(Instant, u64)>>,
}

impl ChainTip {
    pub fn new(source: Arc<dyn CheckpointSource>, ttl: Duration) -> Self {
        Self {
            source,
            ttl,
            cache: Mutex::new(None),
        }
    }

    /// The latest chain checkpoint, served from the ≤`ttl` cache when fresh. A source error
    /// propagates (so `/health` can answer `503 cannot reach node`) and is not cached.
    pub async fn latest(&self) -> Result<u64> {
        if let Some((at, value)) = *self.cache.lock().await {
            if Instant::now().duration_since(at) < self.ttl {
                return Ok(value);
            }
        }
        let value = self.source.latest_checkpoint().await?;
        *self.cache.lock().await = Some((Instant::now(), value));
        Ok(value)
    }
}

/// A `sui_getObject` / dynamic-field result represents an existing object iff its `data` is a
/// non-null value (a missing object yields `{ data: null, error: {..} }`).
fn object_present(result: &Value) -> bool {
    result.get("data").map(|d| !d.is_null()).unwrap_or(false)
}

/// Extract the single type parameter `T` from a fully-qualified type string, e.g.
/// `..::accumulator::GlobalYieldAccumulator<0xPKG::entity_token::ENTITY_TOKEN>` → the inner type.
fn extract_type_param(type_str: &str) -> Option<String> {
    let start = type_str.find('<')?;
    let end = type_str.rfind('>')?;
    (end > start + 1).then(|| type_str[start + 1..end].to_string())
}

/// Reshape a `LegalDocsKey` dynamic-field object into the §6.9 array. The field value is a
/// `vector<WalrusRef>` under `data.content.fields.value`; each element's `blob_id`/`sha256` may be
/// hex strings or raw `vector<u8>` byte arrays (`§10.2`) — both are normalized to hex.
fn extract_walrus_refs(result: &Value) -> Vec<Value> {
    let items = result
        .pointer("/data/content/fields/value")
        .and_then(Value::as_array);
    let mut out = Vec::new();
    if let Some(items) = items {
        for it in items {
            let f = it.get("fields").unwrap_or(it);
            out.push(json!({
                "blob_id": hexify(f.get("blob_id")),
                "sha256": hexify(f.get("sha256")),
                "attested_by": f.get("attested_by").cloned().unwrap_or(Value::Null),
            }));
        }
    }
    out
}

/// Normalize a byte-vector-or-string field to a hex string (`§10.2`): pass strings through,
/// hex-encode `vector<u8>` byte arrays, everything else → `null`.
fn hexify(v: Option<&Value>) -> Value {
    match v {
        Some(Value::String(s)) => Value::String(s.clone()),
        Some(Value::Array(a)) => {
            let bytes: Vec<u8> = a.iter().filter_map(|x| x.as_u64().map(|n| n as u8)).collect();
            Value::String(crate::ingestion::event_types::hex_encode(&bytes))
        }
        _ => Value::Null,
    }
}
