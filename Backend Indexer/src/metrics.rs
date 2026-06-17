//! Prometheus metrics (BI-M7; the `/metrics` exposition table in `m7.md`). A single [`Metrics`]
//! is built at startup and shared (`Arc`) between the ingestion loop (events/db-write), the API
//! (cursor/lag gauges, ws connections), and the object proxy (cache-hit counter). The text
//! exposition is rendered by the `prometheus` crate's [`TextEncoder`], which is valid by
//! construction (Pass Criteria 5).

use prometheus::{
    Encoder, Histogram, HistogramOpts, IntCounter, IntCounterVec, IntGauge, Opts, Registry,
    TextEncoder,
};

/// All process metrics + the registry they live in. Cheap to `Arc`-share; every handle is itself a
/// reference-counted Prometheus collector, so cloning a field is also cheap.
pub struct Metrics {
    pub registry: Registry,
    /// Current indexed checkpoint (set by `/health` + `/metrics` from the DB cursor).
    pub cursor: IntGauge,
    /// How far behind the chain tip the indexer is (Invariant 5 — lag alerting).
    pub lag: IntGauge,
    /// Total events ingested, labelled by `event_type` (short struct name).
    pub events_processed: IntCounterVec,
    /// Events with an unrecognized type (archived in `raw_events` only, guard rail R7).
    pub events_unknown: IntCounter,
    /// Per-event DB write latency.
    pub db_write_duration: Histogram,
    /// Open WebSocket connections (inc on connect, dec on disconnect).
    pub ws_connections: IntGauge,
    /// Object-proxy calls labelled `cache_hit = "true" | "false"`.
    pub proxy_requests: IntCounterVec,
}

impl Metrics {
    /// Build and register every collector against a fresh registry. The metric names are static
    /// and unique, so registration cannot fail in practice (asserted with `expect`).
    pub fn new() -> Self {
        let registry = Registry::new();
        let cursor =
            IntGauge::new("gally_indexer_cursor", "Current indexed checkpoint").unwrap();
        let lag = IntGauge::new(
            "gally_indexer_lag_checkpoints",
            "How far behind the chain tip the indexer is",
        )
        .unwrap();
        let events_processed = IntCounterVec::new(
            Opts::new(
                "gally_indexer_events_processed_total",
                "Total events ingested",
            ),
            &["event_type"],
        )
        .unwrap();
        let events_unknown = IntCounter::new(
            "gally_indexer_events_unknown_total",
            "Events with an unrecognized type",
        )
        .unwrap();
        let db_write_duration = Histogram::with_opts(HistogramOpts::new(
            "gally_indexer_db_write_duration_seconds",
            "Per-event DB write latency",
        ))
        .unwrap();
        let ws_connections = IntGauge::new(
            "gally_indexer_ws_connections_active",
            "Open WebSocket connections",
        )
        .unwrap();
        let proxy_requests = IntCounterVec::new(
            Opts::new(
                "gally_indexer_object_proxy_requests_total",
                "Object proxy calls",
            ),
            &["cache_hit"],
        )
        .unwrap();

        registry.register(Box::new(cursor.clone())).unwrap();
        registry.register(Box::new(lag.clone())).unwrap();
        registry
            .register(Box::new(events_processed.clone()))
            .unwrap();
        registry.register(Box::new(events_unknown.clone())).unwrap();
        registry
            .register(Box::new(db_write_duration.clone()))
            .unwrap();
        registry.register(Box::new(ws_connections.clone())).unwrap();
        registry.register(Box::new(proxy_requests.clone())).unwrap();

        Self {
            registry,
            cursor,
            lag,
            events_processed,
            events_unknown,
            db_write_duration,
            ws_connections,
            proxy_requests,
        }
    }

    /// One ingested event of `event_type` (short struct name) was routed to a typed handler.
    pub fn record_event(&self, event_type: &str) {
        self.events_processed.with_label_values(&[event_type]).inc();
    }

    /// One ingested event had no typed handler (R7).
    pub fn record_unknown(&self) {
        self.events_unknown.inc();
    }

    /// One object-proxy call; `hit` is whether it was served from cache (`backend.md §4.2`).
    pub fn record_proxy(&self, hit: bool) {
        let label = if hit { "true" } else { "false" };
        self.proxy_requests.with_label_values(&[label]).inc();
    }

    /// Render the Prometheus text exposition (`text/plain; version=0.0.4`).
    pub fn render(&self) -> String {
        let mut buf = Vec::new();
        let encoder = TextEncoder::new();
        let _ = encoder.encode(&self.registry.gather(), &mut buf);
        String::from_utf8(buf).unwrap_or_default()
    }
}

impl Default for Metrics {
    fn default() -> Self {
        Self::new()
    }
}
