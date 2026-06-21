//! Abuse-resistance for the **public, key-less** API (operator ask: the endpoints
//! are intentionally open — no API key — so we defend the node from spam/DoS rather
//! than authenticate callers). Five independent, env-tunable controls:
//!
//!   1. **Per-IP rate limit** — a GCRA-style token bucket keyed by client IP. A
//!      sender over its sustained rate (after a burst allowance) gets `429` with a
//!      `Retry-After`. This is the primary anti-spam lever.
//!   2. **Global in-flight cap** — a process-wide [`Semaphore`]; requests beyond the
//!      cap are shed with `503` instead of queueing unboundedly (protects DB/RPC).
//!   3. **Request timeout** — a slow/stuck request can't pin a worker forever (`408`).
//!   4. **Body-size limit** — caps inbound bodies (these are read-only GETs, so this
//!      is pure defence-in-depth against oversized payloads).
//!   5. **WebSocket connection cap** — long-lived sockets are the cheapest way to
//!      exhaust a node, so concurrent `/ws/*` connections are capped (`503` when full;
//!      the permit is held for the socket's lifetime).
//!
//! Behind a reverse proxy / load balancer the real client IP arrives in
//! `X-Forwarded-For` / `X-Real-IP`; we honour those first, then fall back to the TCP
//! peer ([`ConnectInfo`], wired in `main.rs` + the test harness). Everything degrades
//! to "allow" if misconfigured (e.g. rate `0` disables the limiter) so a bad env var
//! can never wedge the API.

use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::extract::{ConnectInfo, Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

// --- defaults (shared by `Config` defaults and `Limits::from_env`) -----------------

/// Sustained per-IP request rate (requests/second) once the burst is spent.
pub const DEFAULT_RATE_PER_SEC: f64 = 25.0;
/// Per-IP burst allowance — how many requests a fresh IP may fire instantly.
pub const DEFAULT_BURST: f64 = 50.0;
/// Process-wide cap on concurrently-served requests before shedding `503`.
pub const DEFAULT_MAX_CONCURRENT: usize = 512;
/// Cap on concurrent WebSocket connections before refusing the upgrade with `503`.
pub const DEFAULT_MAX_WS: usize = 1024;
/// Per-request wall-clock budget before `408`.
pub const DEFAULT_TIMEOUT_SECS: u64 = 30;
/// Inbound request-body cap (bytes). All endpoints are GETs, so this is small.
pub const DEFAULT_MAX_BODY_BYTES: usize = 64 * 1024;
/// IPs exempt from the per-IP rate limit. Loopback by default: a co-located frontend
/// SSR / reverse proxy hits the indexer from one IP and would otherwise throttle the
/// whole site. Public clients arrive via `X-Forwarded-For` (their real IP) and stay
/// limited. Override with `RATE_LIMIT_TRUSTED_IPS` (comma-separated) for a remote frontend.
pub const DEFAULT_TRUSTED_IPS: &str = "127.0.0.1,::1";

/// Parse a comma-separated IP allowlist (invalid entries dropped).
pub fn parse_trusted_ips(s: &str) -> HashSet<IpAddr> {
    s.split(',').filter_map(|p| p.trim().parse().ok()).collect()
}

/// Stop tracking IP buckets once the table exceeds this many entries (memory bound);
/// the next request opportunistically evicts idle (fully-refilled) buckets.
const MAX_TRACKED_IPS: usize = 100_000;

// --- per-IP token bucket ------------------------------------------------------------

#[derive(Clone, Copy)]
struct Bucket {
    tokens: f64,
    last: Instant,
}

/// A GCRA-style token-bucket rate limiter keyed by client IP. `rate <= 0` disables it
/// (every request allowed) so the limiter can be turned off via env without code paths.
pub struct RateLimiter {
    rate_per_sec: f64,
    burst: f64,
    buckets: Mutex<HashMap<IpAddr, Bucket>>,
}

impl RateLimiter {
    pub fn new(rate_per_sec: f64, burst: f64) -> Self {
        Self {
            rate_per_sec,
            burst: burst.max(1.0),
            buckets: Mutex::new(HashMap::new()),
        }
    }

    /// Returns `true` if a request from `ip` is allowed (and consumes one token).
    /// Pure-ish: only mutates the IP's bucket + does a bounded eviction sweep.
    pub fn check(&self, ip: IpAddr) -> bool {
        if self.rate_per_sec <= 0.0 {
            return true; // disabled
        }
        let now = Instant::now();
        let mut map = self.buckets.lock().expect("rate-limiter mutex poisoned");

        // Memory bound: if the table is huge, drop idle buckets (refilled to full =
        // the IP has been quiet long enough that forgetting it changes nothing).
        if map.len() > MAX_TRACKED_IPS {
            let (rate, burst) = (self.rate_per_sec, self.burst);
            map.retain(|_, b| {
                let elapsed = now.saturating_duration_since(b.last).as_secs_f64();
                (b.tokens + elapsed * rate) < burst
            });
        }

        let b = map.entry(ip).or_insert(Bucket {
            tokens: self.burst,
            last: now,
        });
        let elapsed = now.saturating_duration_since(b.last).as_secs_f64();
        b.tokens = (b.tokens + elapsed * self.rate_per_sec).min(self.burst);
        b.last = now;
        if b.tokens >= 1.0 {
            b.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

// --- the bundle of request-scoped limits (middleware state) ------------------------

/// Request-scoped limit knobs, shared (cheap `Arc` clones) as middleware state.
#[derive(Clone)]
pub struct Limits {
    pub rate_limiter: Arc<RateLimiter>,
    pub concurrency: Arc<Semaphore>,
    pub timeout: Duration,
    pub max_body_bytes: usize,
    /// IPs exempt from the per-IP rate limit (still subject to the global concurrency cap).
    pub trusted: Arc<HashSet<IpAddr>>,
}

impl Limits {
    pub fn new(
        rate_per_sec: f64,
        burst: f64,
        max_concurrent: usize,
        timeout_secs: u64,
        max_body_bytes: usize,
        trusted: HashSet<IpAddr>,
    ) -> Self {
        Self {
            rate_limiter: Arc::new(RateLimiter::new(rate_per_sec, burst)),
            concurrency: Arc::new(Semaphore::new(max_concurrent.max(1))),
            timeout: Duration::from_secs(timeout_secs.max(1)),
            max_body_bytes,
            trusted: Arc::new(trusted),
        }
    }

    /// Generous production defaults, overridable via env (`RATE_LIMIT_PER_SEC`,
    /// `RATE_LIMIT_BURST`, `MAX_CONCURRENT_REQUESTS`, `REQUEST_TIMEOUT_SECS`,
    /// `MAX_BODY_BYTES`, `RATE_LIMIT_TRUSTED_IPS`). Used by `router(state)` so existing
    /// tests get the defaults.
    pub fn from_env() -> Self {
        Self::new(
            env_parse("RATE_LIMIT_PER_SEC", DEFAULT_RATE_PER_SEC),
            env_parse("RATE_LIMIT_BURST", DEFAULT_BURST),
            env_parse("MAX_CONCURRENT_REQUESTS", DEFAULT_MAX_CONCURRENT),
            env_parse("REQUEST_TIMEOUT_SECS", DEFAULT_TIMEOUT_SECS),
            env_parse("MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES),
            parse_trusted_ips(
                &std::env::var("RATE_LIMIT_TRUSTED_IPS")
                    .unwrap_or_else(|_| DEFAULT_TRUSTED_IPS.to_string()),
            ),
        )
    }
}

fn env_parse<T: std::str::FromStr>(key: &str, default: T) -> T {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(default)
}

// --- the request gate (rate limit + concurrency) -----------------------------------

/// Axum middleware: enforce the per-IP rate limit, then acquire a global in-flight
/// permit, before the request reaches a route. `429` for rate, `503` for overload.
pub async fn gate(State(limits): State<Limits>, req: Request, next: Next) -> Response {
    let ip = client_ip(&req);
    // Trusted IPs (a co-located frontend SSR / reverse proxy) bypass the per-IP rate
    // limit so the legitimate frontend is never throttled — but they remain subject to
    // the global concurrency cap + timeout below.
    if !limits.trusted.contains(&ip) && !limits.rate_limiter.check(ip) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [("Retry-After", "1")],
            "rate limit exceeded\n",
        )
            .into_response();
    }
    // Held for the request; for a WS upgrade `next.run` returns as soon as the upgrade
    // response is produced (the socket runs in a detached task), so the permit frees
    // immediately — the long-lived part is bounded by the separate WS cap below.
    let _permit = match limits.concurrency.clone().try_acquire_owned() {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                [("Retry-After", "1")],
                "server at capacity\n",
            )
                .into_response();
        }
    };
    next.run(req).await
}

/// Best-effort client IP: trust `X-Forwarded-For` (first hop) / `X-Real-IP` when set
/// (deployed behind a proxy), else the TCP peer from [`ConnectInfo`]. Falls back to
/// `0.0.0.0` (one shared bucket) only if nothing is available — never errors.
fn client_ip(req: &Request) -> IpAddr {
    let headers = req.headers();
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(ip) = xff.split(',').next().and_then(|s| s.trim().parse().ok()) {
            return ip;
        }
    }
    if let Some(ip) = headers
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse().ok())
    {
        return ip;
    }
    if let Some(ConnectInfo(addr)) = req.extensions().get::<ConnectInfo<SocketAddr>>() {
        return addr.ip();
    }
    IpAddr::V4(Ipv4Addr::UNSPECIFIED)
}

// --- WebSocket connection cap (process-wide) ---------------------------------------

static WS_CAP: OnceLock<Arc<Semaphore>> = OnceLock::new();

/// Set the process-wide WebSocket connection cap (called once at startup). Idempotent:
/// the first value wins. If never called (e.g. in unit tests) WS connections are
/// unlimited — [`ws_acquire`] then returns [`WsPermit::Unlimited`].
pub fn configure_ws_cap(max: usize) {
    let _ = WS_CAP.set(Arc::new(Semaphore::new(max.max(1))));
}

/// A permit that must be held for the lifetime of a WebSocket connection. Dropping it
/// (when the socket task ends) returns capacity to the pool.
pub enum WsPermit {
    /// No cap configured — the connection is unbounded.
    Unlimited,
    /// A real slot held against the configured cap.
    Held(#[allow(dead_code)] OwnedSemaphorePermit),
}

/// Try to reserve a WebSocket slot. `None` means the cap is full (reject the upgrade
/// with `503`); `Some(_)` is the permit to hold for the connection's lifetime.
pub fn ws_acquire() -> Option<WsPermit> {
    match WS_CAP.get() {
        None => Some(WsPermit::Unlimited),
        Some(sem) => sem.clone().try_acquire_owned().ok().map(WsPermit::Held),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(n: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(10, 0, 0, n))
    }

    #[test]
    fn burst_then_throttle_then_refill() {
        // 10/sec sustained, burst of 3: first 3 instant requests pass, the 4th is denied.
        let rl = RateLimiter::new(10.0, 3.0);
        let who = ip(1);
        assert!(rl.check(who));
        assert!(rl.check(who));
        assert!(rl.check(who));
        assert!(!rl.check(who), "burst should be spent");

        // After ~0.2s, 10/sec replenishes ~2 tokens → at least one more passes.
        std::thread::sleep(Duration::from_millis(220));
        assert!(rl.check(who), "tokens should refill over time");
    }

    #[test]
    fn buckets_are_per_ip() {
        let rl = RateLimiter::new(1.0, 1.0);
        assert!(rl.check(ip(1)));
        assert!(!rl.check(ip(1)), "same IP is throttled");
        assert!(rl.check(ip(2)), "a different IP has its own bucket");
    }

    #[test]
    fn zero_rate_disables_the_limiter() {
        let rl = RateLimiter::new(0.0, 1.0);
        for _ in 0..1000 {
            assert!(rl.check(ip(7)), "rate 0 must allow everything");
        }
    }

    #[test]
    fn trusted_ips_parse_and_default_loopback() {
        let loopback = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));
        assert!(parse_trusted_ips(DEFAULT_TRUSTED_IPS).contains(&loopback));
        // garbage entries are dropped, valid ones kept
        let set = parse_trusted_ips("10.0.0.5, not-an-ip ,127.0.0.1");
        assert_eq!(set.len(), 2);
        assert!(set.contains(&ip(5))); // 10.0.0.5
        assert!(set.contains(&loopback));
    }

    #[test]
    fn ws_unlimited_when_unconfigured() {
        // WS_CAP is a process global; in the unit-test binary it is never configured,
        // so acquisition always yields the Unlimited sentinel.
        assert!(matches!(ws_acquire(), Some(WsPermit::Unlimited)));
    }
}
