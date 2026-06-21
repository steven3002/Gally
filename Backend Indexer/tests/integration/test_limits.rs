//! Abuse-resistance integration tests (`api::limit`): the public, key-less API must
//! throttle a single spamming IP with `429` while staying open under normal load.

use gally_indexer::api::{self, limit::Limits};
use sqlx::PgPool;
use std::collections::HashSet;

async fn status(base: &str, path: &str) -> u16 {
    reqwest::Client::new()
        .get(format!("{base}{path}"))
        .send()
        .await
        .unwrap()
        .status()
        .as_u16()
}

/// A burst of 3 with effectively no refill: the first 3 rapid requests from one IP pass,
/// every request after the burst is rejected with `429 Too Many Requests`.
#[sqlx::test(migrations = "src/db/migrations")]
async fn rate_limit_throttles_a_spamming_ip(pool: PgPool) {
    // Empty trusted set so the loopback test client is itself rate-limited.
    let limits = Limits::new(/* rate */ 0.0001, /* burst */ 3.0, 512, 30, 64 * 1024, HashSet::new());
    let app = api::router_with_limits(crate::app_state(pool, crate::default_objects()), limits);
    let base = crate::spawn_router(app).await;

    let mut codes = Vec::new();
    for _ in 0..5 {
        codes.push(status(&base, "/assets").await);
    }

    assert_eq!(&codes[..3], &[200, 200, 200], "burst allowance passes: {codes:?}");
    assert!(
        codes[3..].iter().all(|&c| c == 429),
        "post-burst requests throttled: {codes:?}"
    );
}

/// With generous limits, a normal sequence of requests is never throttled (guards against
/// a default that would break legitimate clients).
#[sqlx::test(migrations = "src/db/migrations")]
async fn generous_limits_do_not_throttle(pool: PgPool) {
    let limits = Limits::new(50.0, 100.0, 512, 30, 64 * 1024, HashSet::new());
    let app = api::router_with_limits(crate::app_state(pool, crate::default_objects()), limits);
    let base = crate::spawn_router(app).await;

    for _ in 0..20 {
        assert_eq!(status(&base, "/assets").await, 200, "normal load stays open");
    }
}
