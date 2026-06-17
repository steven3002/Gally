//! BI-M2 API integration tests: `/assets`, `/assets/:id/history`, `/governance`. Each spins up
//! the real Axum app over an ephemeral port, seeds rows through [`route_event`], and asserts the
//! §6 response shapes inside the universal `{ data, nextCursor, hasNextPage }` envelope
//! (`backend.md §5.1.1`).

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use async_trait::async_trait;
use futures_util::StreamExt;
use gally_indexer::ingestion::route_event;
use gally_indexer::sui_client::{EventId, ObjectProxy, ObjectSource, SuiEvent};
use gally_indexer::{api, db};
use serde_json::{json, Value};
use sqlx::PgPool;
use tokio_tungstenite::connect_async;

const PKG: &str = "0x309d0b80";

fn ev(module: &str, struct_name: &str, tx: &str, seq: &str, ts: i64, parsed: Value) -> SuiEvent {
    SuiEvent {
        id: EventId {
            tx_digest: tx.to_string(),
            event_seq: seq.to_string(),
        },
        event_type: format!("{PKG}::{module}::{struct_name}"),
        parsed_json: parsed,
        timestamp_ms: Some(ts.to_string()),
    }
}

fn asset_created(asset_id: &str, entity: &str, goal: &str) -> Value {
    json!({
        "asset_id": asset_id, "entity": entity,
        "funding_goal": goal, "funding_deadline_ms": "1750000000000",
        "tranche_count": "2", "revenue_split_bps": "6000", "collateral": "100000000"
    })
}

/// Serve the app on an ephemeral port and return its base URL. Uses a throwaway object proxy (the
/// DB-only endpoints never call it); proxy tests use [`serve_with_objects`].
async fn serve(pool: PgPool) -> String {
    serve_with_objects(pool, crate::default_objects()).await
}

/// Serve the app with a caller-supplied object proxy (BI-M6 proxy tests). The BI-M7 state fields
/// (hub/metrics/tip) default via [`crate::app_state`].
async fn serve_with_objects(pool: PgPool, objects: Arc<ObjectProxy>) -> String {
    crate::spawn(crate::app_state(pool, objects)).await
}

async fn get_json(base: &str, path: &str) -> (reqwest::StatusCode, Value) {
    let resp = reqwest::Client::new()
        .get(format!("{base}{path}"))
        .send()
        .await
        .unwrap();
    let status = resp.status();
    (status, resp.json().await.unwrap())
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_api_assets_list(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xa1", "0", 100, asset_created("0xASSET1", "0xENT", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xa2", "0", 200, asset_created("0xASSET2", "0xENT", "2000000000"))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/assets").await;
    assert_eq!(status, 200);

    let data = body["data"].as_array().expect("data is an array");
    assert_eq!(data.len(), 2, "both assets listed");
    assert_eq!(body["hasNextPage"], false);
    assert!(body["nextCursor"].is_null());

    let ids: Vec<&str> = data.iter().map(|a| a["asset_id"].as_str().unwrap()).collect();
    assert!(ids.contains(&"0xASSET1") && ids.contains(&"0xASSET2"));
    // §9.1: u64 amounts serialized as strings.
    let a1 = data.iter().find(|a| a["asset_id"] == "0xASSET1").unwrap();
    assert_eq!(a1["goal"], "1000000000");
    assert_eq!(a1["entity"], "0xENT");
    assert_eq!(a1["current_state"], 0);
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_api_assets_list_filter_and_paginate(pool: PgPool) {
    // Two entities; ?entity= filters, ?limit= paginates with a working cursor.
    for i in 0..3i64 {
        route_event(&pool, &ev("asset", "AssetCreatedEvent", &format!("0xe{i}"), "0", 10 + i,
            asset_created(&format!("0xE_{i}"), "0xALICE", "1000000000"))).await.unwrap();
    }
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xb0", "0", 40,
        asset_created("0xB_0", "0xBOB", "1000000000"))).await.unwrap();

    let base = serve(pool).await;

    let (_, only_alice) = get_json(&base, "/assets?entity=0xALICE").await;
    assert_eq!(only_alice["data"].as_array().unwrap().len(), 3, "?entity= filter");

    let (_, page1) = get_json(&base, "/assets?entity=0xALICE&limit=2").await;
    assert_eq!(page1["data"].as_array().unwrap().len(), 2);
    assert_eq!(page1["hasNextPage"], true);
    let cursor = page1["nextCursor"].as_str().unwrap();

    let (_, page2) = get_json(&base, &format!("/assets?entity=0xALICE&limit=2&cursor={cursor}")).await;
    assert_eq!(page2["data"].as_array().unwrap().len(), 1, "remaining row");
    assert_eq!(page2["hasNextPage"], false);
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_api_asset_history(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await.unwrap();
    // Insert out of timestamp order to prove the API sorts ascending.
    route_event(&pool, &ev("asset", "AssetStateChangedEvent", "0xs2", "0", 30, json!({"asset_id":"0xA","old_state":1,"new_state":4}))).await.unwrap();
    route_event(&pool, &ev("asset", "AssetStateChangedEvent", "0xs1", "0", 20, json!({"asset_id":"0xA","old_state":0,"new_state":1}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/assets/0xA/history").await;
    assert_eq!(status, 200);

    let ts: Vec<i64> = body["data"].as_array().unwrap().iter().map(|r| r["timestamp_ms"].as_i64().unwrap()).collect();
    assert_eq!(ts, vec![1, 20, 30], "history ascending by timestamp");
    let new_states: Vec<i64> = body["data"].as_array().unwrap().iter().map(|r| r["new_state"].as_i64().unwrap()).collect();
    assert_eq!(new_states, vec![0, 1, 4]);
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_api_governance(pool: PgPool) {
    // Insert out of order; expect ascending-timestamp output.
    route_event(&pool, &ev("protocol", "ProtocolParamChangedEvent", "0xg2", "0", 200, json!({"name":"min_stake","old_value":"5","new_value":"6"}))).await.unwrap();
    route_event(&pool, &ev("protocol", "ProtocolInitializedEvent", "0xg1", "0", 100, json!({"config_id":"0xCFG","admin":"0xADM"}))).await.unwrap();
    route_event(&pool, &ev("protocol", "EmergencyStopTriggeredEvent", "0xg3", "0", 300, json!({"config_id":"0xCFG"}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/governance").await;
    assert_eq!(status, 200);

    let types: Vec<&str> = body["data"].as_array().unwrap().iter().map(|r| r["event_type"].as_str().unwrap()).collect();
    assert_eq!(
        types,
        vec!["ProtocolInitialized", "ProtocolParamChanged", "EmergencyStopTriggered"],
        "governance feed ordered by timestamp"
    );

    // ?type= filter narrows to one subtype.
    let (_, only_param) = get_json(&base, "/governance?type=ProtocolParamChanged").await;
    let d = only_param["data"].as_array().unwrap();
    assert_eq!(d.len(), 1);
    assert_eq!(d[0]["param_name"], "min_stake");
    assert_eq!(d[0]["new_value"], "6");
}

/// `GET /assets/:id` returns 404 for an unknown id (BI-M2 minimal error mapping).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_api_asset_detail_404(pool: PgPool) {
    db::run_migrations(&pool).await.ok();
    let base = serve(pool).await;
    let (status, _) = get_json(&base, "/assets/0xMISSING").await;
    assert_eq!(status, 404);
}

// ---------------------------------------------------------------------------
// BI-M3 — validators, raise-progress, portfolio, holders
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_portfolio_cross_asset(pool: PgPool) {
    // One address active on two different assets must appear in /portfolio.
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc1", "0", 1, asset_created("0xA1", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc2", "0", 2, asset_created("0xA2", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("asset", "SharesClaimedEvent", "0xp1", "0", 10, json!({"asset_id":"0xA1","holder":"0xH","count":"100","share_object_id":"0xS1"}))).await.unwrap();
    route_event(&pool, &ev("accumulator", "YieldClaimedEvent", "0xp2", "0", 20, json!({"asset_id":"0xA2","holder":"0xH","amount":"50","index_at_claim":"7000000000"}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/portfolio/0xH").await;
    assert_eq!(status, 200);
    let assets: Vec<&str> = body["data"].as_array().unwrap().iter().map(|r| r["asset_id"].as_str().unwrap()).collect();
    assert!(assets.contains(&"0xA1") && assets.contains(&"0xA2"), "both assets in portfolio");

    // /portfolio/:addr/assets returns the distinct set as summary objects (BI-M6 shape).
    let (_, distinct) = get_json(&base, "/portfolio/0xH/assets").await;
    let d: Vec<&str> = distinct["data"].as_array().unwrap().iter().map(|x| x["asset_id"].as_str().unwrap()).collect();
    assert_eq!(d, vec!["0xA1", "0xA2"]);
    assert_eq!(distinct["attribution"], "protocol");
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_portfolio_filter_by_asset(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc1", "0", 1, asset_created("0xA1", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc2", "0", 2, asset_created("0xA2", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("asset", "SharesClaimedEvent", "0xp1", "0", 10, json!({"asset_id":"0xA1","holder":"0xH","count":"100","share_object_id":"0xS1"}))).await.unwrap();
    route_event(&pool, &ev("asset", "SharesClaimedEvent", "0xp2", "0", 20, json!({"asset_id":"0xA2","holder":"0xH","count":"200","share_object_id":"0xS2"}))).await.unwrap();

    let base = serve(pool).await;
    let (_, body) = get_json(&base, "/portfolio/0xH?asset_id=0xA1").await;
    let rows = body["data"].as_array().unwrap();
    assert_eq!(rows.len(), 1, "only the 0xA1 event");
    assert_eq!(rows[0]["asset_id"], "0xA1");
    assert_eq!(rows[0]["event_type"], "SharesClaimed");
    assert_eq!(rows[0]["amount"], "100");
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_raise_progress_endpoint(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await.unwrap();
    // Insert out of order; expect ascending output.
    route_event(&pool, &ev("asset", "CapitalContributedEvent", "0xr2", "0", 30, json!({"asset_id":"0xA","contributor":"0xB","amount":"200","raised_after":"300"}))).await.unwrap();
    route_event(&pool, &ev("asset", "CapitalContributedEvent", "0xr1", "0", 20, json!({"asset_id":"0xA","contributor":"0xC","amount":"100","raised_after":"100"}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/assets/0xA/raise-progress").await;
    assert_eq!(status, 200);
    let raised: Vec<&str> = body["data"].as_array().unwrap().iter().map(|r| r["raised_after"].as_str().unwrap()).collect();
    assert_eq!(raised, vec!["100", "300"], "raise progress ascending by timestamp");
}

#[sqlx::test(migrations = "src/db/migrations")]
async fn test_validator_status_history(pool: PgPool) {
    route_event(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xvr", "0", 1, json!({"pool_id":"0xPOOL","validator":"0xVAL","stake":"5000000000"}))).await.unwrap();
    // Chronological order (as the ascending ingestion sweep delivers them, §9.7); the denormalized
    // current_status tracks the latest. Ascending-sort of feeds is proven by the history/raise tests.
    route_event(&pool, &ev("validator", "ValidatorStatusChangedEvent", "0xs1", "0", 10, json!({"pool_id":"0xPOOL","old_status":0,"new_status":1,"dispute_id":null}))).await.unwrap();
    route_event(&pool, &ev("validator", "ValidatorStatusChangedEvent", "0xs2", "0", 20, json!({"pool_id":"0xPOOL","old_status":1,"new_status":2,"dispute_id":"0xD"}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/validators/0xPOOL").await;
    assert_eq!(status, 200);
    assert_eq!(body["current_status"], 2);
    assert_eq!(body["initial_stake"], "5000000000");
    let changes = body["status_changes"].as_array().unwrap();
    let news: Vec<i64> = changes.iter().map(|c| c["new_status"].as_i64().unwrap()).collect();
    assert_eq!(news, vec![1, 2], "status changes ascending by timestamp");

    // /validators list includes the pool.
    let (_, list) = get_json(&base, "/validators").await;
    assert_eq!(list["data"].as_array().unwrap().len(), 1);
    assert_eq!(list["data"][0]["pool_id"], "0xPOOL");
}

/// The §2.17 signed fold: SharesClaimed×2 (two holders) + one SharesWrapped → per-holder
/// share_count/wrapped, Σ(share_count+wrapped) == total_minted_shares, attribution = protocol.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_holders_ledger_fold(pool: PgPool) {
    // goal == total_minted_shares == 1000.
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000"))).await.unwrap();
    route_event(&pool, &ev("asset", "SharesClaimedEvent", "0xc1", "0", 10, json!({"asset_id":"0xA","holder":"0xALICE","count":"300","share_object_id":"0xSA"}))).await.unwrap();
    route_event(&pool, &ev("asset", "SharesClaimedEvent", "0xc2", "0", 20, json!({"asset_id":"0xA","holder":"0xBOB","count":"700","share_object_id":"0xSB"}))).await.unwrap();
    // Alice wraps 100 of her 300: deeds 200, wrapped 100, holding 300.
    route_event(&pool, &ev("accumulator", "SharesWrappedEvent", "0xw", "0", 30, json!({"asset_id":"0xA","holder":"0xALICE","count":"100","total_wrapped_after":"100"}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/assets/0xA/holders").await;
    assert_eq!(status, 200);
    assert_eq!(body["attribution"], "protocol");
    assert_eq!(body["total_minted_shares"], "1000");

    let data = body["data"].as_array().unwrap();
    assert_eq!(data.len(), 2, "two holders");
    // Ranked by holding DESC → Bob (700) first, Alice (300) second.
    assert_eq!(data[0]["address"], "0xBOB");
    assert_eq!(data[0]["share_count"], "700");
    assert_eq!(data[0]["wrapped"], "0");
    assert_eq!(data[0]["pct_of_supply"], "70.00");
    assert_eq!(data[1]["address"], "0xALICE");
    assert_eq!(data[1]["share_count"], "200");
    assert_eq!(data[1]["wrapped"], "100");
    assert_eq!(data[1]["pct_of_supply"], "30.00");

    // Σ(share_count + wrapped) == total_minted_shares (1000).
    let total: i64 = data.iter().map(|h| {
        h["share_count"].as_str().unwrap().parse::<i64>().unwrap()
            + h["wrapped"].as_str().unwrap().parse::<i64>().unwrap()
    }).sum();
    assert_eq!(total, 1000, "fold sums to total minted shares");
    // Never-claimed-yield holders report index 0 (§2.17).
    assert_eq!(data[0]["yield_claimed_index"], "0");
}

// ---------------------------------------------------------------------------
// BI-M4 — yield curve, wrap-ratio, disputes
// ---------------------------------------------------------------------------

/// `GET /assets/:id/yield` returns the index curve ascending by timestamp.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_yield_series_order(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await.unwrap();
    // Insert out of order; expect ascending output.
    route_event(&pool, &ev("asset", "RevenueDepositedEvent", "0xr2", "0", 30, json!({
        "asset_id":"0xA","gross":"20","fee":"2","investor_portion":"14","entity_portion":"4","index_after":"3000000000","unwrapped_supply":"100"
    }))).await.unwrap();
    route_event(&pool, &ev("asset", "RevenueDepositedEvent", "0xr1", "0", 20, json!({
        "asset_id":"0xA","gross":"10","fee":"1","investor_portion":"7","entity_portion":"2","index_after":"1000000000","unwrapped_supply":"100"
    }))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/assets/0xA/yield").await;
    assert_eq!(status, 200);
    let idx: Vec<&str> = body["data"].as_array().unwrap().iter().map(|r| r["index_after"].as_str().unwrap()).collect();
    assert_eq!(idx, vec!["1000000000", "3000000000"], "yield curve ascending by timestamp");
    // §9.1: u64 amounts serialized as strings; event_type tagged 'revenue'.
    assert_eq!(body["data"][0]["event_type"], "revenue");
    assert_eq!(body["data"][0]["gross"], "10");
}

/// `GET /assets/:id/wrap-ratio` returns the `total_wrapped_after` series from wrap/unwrap events.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_wrap_ratio_series(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("accumulator", "SharesWrappedEvent", "0xw", "0", 10, json!({"asset_id":"0xA","holder":"0xH","count":"400","total_wrapped_after":"400"}))).await.unwrap();
    route_event(&pool, &ev("accumulator", "SharesUnwrappedEvent", "0xu", "0", 20, json!({"asset_id":"0xA","holder":"0xH","count":"150","share_object_id":"0xS","total_wrapped_after":"250"}))).await.unwrap();
    // A YieldClaimed for the same asset must NOT appear in the wrap-ratio series.
    route_event(&pool, &ev("accumulator", "YieldClaimedEvent", "0xy", "0", 30, json!({"asset_id":"0xA","holder":"0xH","amount":"5","index_at_claim":"7000000000"}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/assets/0xA/wrap-ratio").await;
    assert_eq!(status, 200);
    let series: Vec<&str> = body["data"].as_array().unwrap().iter().map(|r| r["total_wrapped_after"].as_str().unwrap()).collect();
    assert_eq!(series, vec!["400", "250"], "wrap-ratio series ascending, wrap+unwrap only");
    let types: Vec<&str> = body["data"].as_array().unwrap().iter().map(|r| r["event_type"].as_str().unwrap()).collect();
    assert_eq!(types, vec!["SharesWrapped", "SharesUnwrapped"]);
}

/// `GET /disputes/:id` returns the dispute + all 3 juror vote rows, and the rolled-up tallies.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_jury_votes_count(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xvr", "0", 2, json!({"pool_id":"0xPOOL","validator":"0xVAL","stake":"5000000000"}))).await.unwrap();
    route_event(&pool, &ev("dispute", "DisputeOpenedEvent", "0xd0", "0", 10, json!({"dispute_id":"0xD","asset_id":"0xA","target_pool_id":"0xPOOL","challenger":"0xCH","bond":"1000000","evidence_sha256":[1,2,3]}))).await.unwrap();
    for (i, (juror, guilty, g, n)) in [("0xJ1", true, "1", "0"), ("0xJ2", true, "2", "0"), ("0xJ3", false, "2", "1")].iter().enumerate() {
        route_event(&pool, &ev("dispute", "JurorVotedEvent", &format!("0xv{i}"), "0", 20 + i as i64, json!({
            "dispute_id":"0xD","juror_pool_id":juror,"guilty":guilty,"votes_guilty_after":g,"votes_innocent_after":n
        }))).await.unwrap();
    }

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/disputes/0xD").await;
    assert_eq!(status, 200);
    assert_eq!(body["dispute_id"], "0xD");
    assert!(body["verdict"].is_null(), "still open");
    assert_eq!(body["bond"], "1000000");
    assert_eq!(body["votes_guilty"], 2, "rolled-up guilty tally");
    assert_eq!(body["votes_innocent"], 1, "rolled-up innocent tally");
    let votes = body["jury_votes"].as_array().unwrap();
    assert_eq!(votes.len(), 3, "all three juror votes returned");
    let jurors: Vec<&str> = votes.iter().map(|v| v["juror_pool_id"].as_str().unwrap()).collect();
    assert_eq!(jurors, vec!["0xJ1", "0xJ2", "0xJ3"], "votes ascending by timestamp");

    // 404 for an unknown dispute id.
    let (missing, _) = get_json(&base, "/disputes/0xNOPE").await;
    assert_eq!(missing, 404);
}

/// `GET /disputes?pool_id=<id>` returns only disputes targeting that pool.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_dispute_filter_by_pool(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xv1", "0", 2, json!({"pool_id":"0xP1","validator":"0xVAL","stake":"5000000000"}))).await.unwrap();
    route_event(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xv2", "0", 3, json!({"pool_id":"0xP2","validator":"0xVAL2","stake":"5000000000"}))).await.unwrap();
    route_event(&pool, &ev("dispute", "DisputeOpenedEvent", "0xd1", "0", 10, json!({"dispute_id":"0xD1","asset_id":"0xA","target_pool_id":"0xP1","challenger":"0xCH","bond":"1","evidence_sha256":[1]}))).await.unwrap();
    route_event(&pool, &ev("dispute", "DisputeOpenedEvent", "0xd2", "0", 20, json!({"dispute_id":"0xD2","asset_id":"0xA","target_pool_id":"0xP2","challenger":"0xCH","bond":"1","evidence_sha256":[2]}))).await.unwrap();
    // Resolve 0xD2 REJECTED so we can also exercise ?verdict=.
    route_event(&pool, &ev("dispute", "DisputeResolvedEvent", "0xdr", "0", 30, json!({"dispute_id":"0xD2","asset_id":"0xA","target_pool_id":"0xP2","verdict":2,"slashed":"0","bounty":"0","challenger":"0xCH"}))).await.unwrap();

    let base = serve(pool).await;

    // Unfiltered: both disputes.
    let (_, all) = get_json(&base, "/disputes").await;
    assert_eq!(all["data"].as_array().unwrap().len(), 2);

    // ?pool_id= narrows to the targeted pool.
    let (status, body) = get_json(&base, "/disputes?pool_id=0xP1").await;
    assert_eq!(status, 200);
    let d = body["data"].as_array().unwrap();
    assert_eq!(d.len(), 1, "only the dispute targeting 0xP1");
    assert_eq!(d[0]["dispute_id"], "0xD1");
    assert_eq!(d[0]["target_pool_id"], "0xP1");
    assert!(d[0]["verdict"].is_null());

    // ?verdict= narrows to resolved verdict.
    let (_, rejected) = get_json(&base, "/disputes?verdict=2").await;
    let r = rejected["data"].as_array().unwrap();
    assert_eq!(r.len(), 1);
    assert_eq!(r[0]["dispute_id"], "0xD2");
    assert_eq!(r[0]["verdict"], 2);

    // Per-asset variant returns both (same asset).
    let (_, by_asset) = get_json(&base, "/assets/0xA/disputes").await;
    assert_eq!(by_asset["data"].as_array().unwrap().len(), 2);
}

// ---------------------------------------------------------------------------
// BI-M5 — REST hardening, filter validation, validator track record
// ---------------------------------------------------------------------------

/// `GET /assets`: every USDC field (`goal`, `collateral`, `coverage`) serialized as a JSON string
/// (`§9.1`).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_amounts_are_strings(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("asset", "AssetVouchedEvent", "0xv", "0", 2, json!({"asset_id":"0xA","pool_id":"0xP","validator":"0xVAL","coverage":"20000000000","doc_hashes":[]}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/assets").await;
    assert_eq!(status, 200);
    let a = &body["data"][0];
    assert!(a["goal"].is_string(), "goal is a string");
    assert!(a["collateral"].is_string(), "collateral is a string");
    assert!(a["coverage"].is_string(), "coverage is a string");
}

/// 60 assets + `?limit=50`: page 1 = 50 items, `hasNextPage=true`, non-null `nextCursor`; the cursor
/// fetches the remaining 10 with `hasNextPage=false` and `nextCursor=null`.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_pagination_cursor(pool: PgPool) {
    for i in 0..60i64 {
        route_event(&pool, &ev("asset", "AssetCreatedEvent", &format!("0xtx{i}"), "0", 1000 + i,
            asset_created(&format!("0xASSET{i:02}"), "0xE", "1000000000"))).await.unwrap();
    }

    let base = serve(pool).await;
    let (status, p1) = get_json(&base, "/assets?limit=50").await;
    assert_eq!(status, 200);
    assert_eq!(p1["data"].as_array().unwrap().len(), 50, "first page = 50");
    assert_eq!(p1["hasNextPage"], true);
    let cursor = p1["nextCursor"].as_str().expect("non-null cursor on a full page");

    let (_, p2) = get_json(&base, &format!("/assets?limit=50&cursor={cursor}")).await;
    assert_eq!(p2["data"].as_array().unwrap().len(), 10, "remaining 10");
    assert_eq!(p2["hasNextPage"], false);
    assert!(p2["nextCursor"].is_null());
}

/// `GET /assets?state=4` returns only EXECUTING assets (state 4; 3 = CANCELLED, `§11.1`).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_filter_by_state(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc1", "0", 1, asset_created("0xEXEC", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc2", "0", 2, asset_created("0xCANC", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("asset", "AssetStateChangedEvent", "0xs1", "0", 10, json!({"asset_id":"0xEXEC","old_state":0,"new_state":4}))).await.unwrap();
    route_event(&pool, &ev("asset", "AssetStateChangedEvent", "0xs2", "0", 11, json!({"asset_id":"0xCANC","old_state":0,"new_state":3}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/assets?state=4").await;
    assert_eq!(status, 200);
    let d = body["data"].as_array().unwrap();
    assert_eq!(d.len(), 1, "only the EXECUTING asset");
    assert_eq!(d[0]["asset_id"], "0xEXEC");
    assert_eq!(d[0]["current_state"], 4);
}

/// `GET /assets?entity=0x...` returns only that entity's assets.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_filter_by_entity(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xa1", "0", 1, asset_created("0xA1", "0xALICE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xa2", "0", 2, asset_created("0xA2", "0xALICE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xb1", "0", 3, asset_created("0xB1", "0xBOB", "1000000000"))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/assets?entity=0xALICE").await;
    assert_eq!(status, 200);
    let d = body["data"].as_array().unwrap();
    assert_eq!(d.len(), 2, "only Alice's assets");
    assert!(d.iter().all(|a| a["entity"] == "0xALICE"));
}

/// `GET /assets/0xdeadbeef` → HTTP 404 with `{ "error": "not_found" }`.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_unknown_asset_404(pool: PgPool) {
    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/assets/0xdeadbeef").await;
    assert_eq!(status, 404);
    assert_eq!(body["error"], "not_found");
    assert_eq!(body["id"], "0xdeadbeef");
}

/// `GET /assets?state=notanumber` → HTTP 400 with `{ "error": "invalid_param" }` (filter validation,
/// not axum's default deserialization error).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_invalid_state_param_400(pool: PgPool) {
    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/assets?state=notanumber").await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "invalid_param");
    assert_eq!(body["param"], "state");
}

/// `GET /validators/:id` includes a `track_record` with the five DB-derived counts (`m5.md`).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_validator_track_record(pool: PgPool) {
    route_event(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xvr", "0", 1, json!({"pool_id":"0xPOOL","validator":"0xVAL","stake":"5000000000"}))).await.unwrap();
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc1", "0", 2, asset_created("0xA1", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc2", "0", 3, asset_created("0xA2", "0xE", "1000000000"))).await.unwrap();
    // Both vouched by 0xPOOL (assets_vouched = 2).
    route_event(&pool, &ev("asset", "AssetVouchedEvent", "0xv1", "0", 4, json!({"asset_id":"0xA1","pool_id":"0xPOOL","validator":"0xVAL","coverage":"1","doc_hashes":[]}))).await.unwrap();
    route_event(&pool, &ev("asset", "AssetVouchedEvent", "0xv2", "0", 5, json!({"asset_id":"0xA2","pool_id":"0xPOOL","validator":"0xVAL","coverage":"1","doc_hashes":[]}))).await.unwrap();
    // 0xA2 defaults → COMPENSATING (6): assets_defaulted = 1.
    route_event(&pool, &ev("asset", "AssetStateChangedEvent", "0xsd", "0", 6, json!({"asset_id":"0xA2","old_state":4,"new_state":6}))).await.unwrap();
    // 3 milestone approvals carrying pool_id (milestones_approved = 3).
    for t in 0..3i64 {
        route_event(&pool, &ev("asset", "MilestoneApprovedEvent", &format!("0xm{t}"), "0", 10 + t,
            json!({"asset_id":"0xA1","tranche":t.to_string(),"validator":"0xVAL","pool_id":"0xPOOL"}))).await.unwrap();
    }
    // 2 disputes target the pool; one UPHELD (disputes_filed_against = 2, disputes_upheld = 1).
    route_event(&pool, &ev("dispute", "DisputeOpenedEvent", "0xd1", "0", 20, json!({"dispute_id":"0xD1","asset_id":"0xA1","target_pool_id":"0xPOOL","challenger":"0xCH","bond":"1","evidence_sha256":[1]}))).await.unwrap();
    route_event(&pool, &ev("dispute", "DisputeOpenedEvent", "0xd2", "0", 21, json!({"dispute_id":"0xD2","asset_id":"0xA1","target_pool_id":"0xPOOL","challenger":"0xCH","bond":"1","evidence_sha256":[2]}))).await.unwrap();
    route_event(&pool, &ev("dispute", "DisputeResolvedEvent", "0xdr", "0", 22, json!({"dispute_id":"0xD2","asset_id":"0xA1","target_pool_id":"0xPOOL","verdict":1,"slashed":"1","bounty":"1","challenger":"0xCH"}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/validators/0xPOOL").await;
    assert_eq!(status, 200);
    let tr = &body["track_record"];
    assert_eq!(tr["assets_vouched"], 2);
    assert_eq!(tr["milestones_approved"], 3);
    assert_eq!(tr["assets_defaulted"], 1);
    assert_eq!(tr["disputes_filed_against"], 2);
    assert_eq!(tr["disputes_upheld"], 1);
}

/// `GET /validators?status=1` returns only FROZEN pools.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_validator_filter_by_status(pool: PgPool) {
    route_event(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xr1", "0", 1, json!({"pool_id":"0xP1","validator":"0xV1","stake":"5000000000"}))).await.unwrap();
    route_event(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xr2", "0", 2, json!({"pool_id":"0xP2","validator":"0xV2","stake":"5000000000"}))).await.unwrap();
    route_event(&pool, &ev("validator", "ValidatorStatusChangedEvent", "0xsc", "0", 10, json!({"pool_id":"0xP1","old_status":0,"new_status":1,"dispute_id":null}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/validators?status=1").await;
    assert_eq!(status, 200);
    let d = body["data"].as_array().unwrap();
    assert_eq!(d.len(), 1, "only the FROZEN pool");
    assert_eq!(d[0]["pool_id"], "0xP1");
    assert_eq!(d[0]["current_status"], 1);
}

/// `GET /validators?validator=0x...` returns only pools with that operator address.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_validator_filter_by_address(pool: PgPool) {
    route_event(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xr1", "0", 1, json!({"pool_id":"0xP1","validator":"0xALICE","stake":"5000000000"}))).await.unwrap();
    route_event(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xr2", "0", 2, json!({"pool_id":"0xP2","validator":"0xALICE","stake":"5000000000"}))).await.unwrap();
    route_event(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xr3", "0", 3, json!({"pool_id":"0xP3","validator":"0xBOB","stake":"5000000000"}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/validators?validator=0xALICE").await;
    assert_eq!(status, 200);
    let d = body["data"].as_array().unwrap();
    assert_eq!(d.len(), 2, "only Alice's pools");
    assert!(d.iter().all(|p| p["validator"] == "0xALICE"));
}

/// `GET /disputes?challenger=0x...` returns only disputes filed by that address.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_dispute_filter_by_challenger(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xvr", "0", 2, json!({"pool_id":"0xPOOL","validator":"0xVAL","stake":"5000000000"}))).await.unwrap();
    route_event(&pool, &ev("dispute", "DisputeOpenedEvent", "0xd1", "0", 10, json!({"dispute_id":"0xD1","asset_id":"0xA","target_pool_id":"0xPOOL","challenger":"0xALICE","bond":"1","evidence_sha256":[1]}))).await.unwrap();
    route_event(&pool, &ev("dispute", "DisputeOpenedEvent", "0xd2", "0", 11, json!({"dispute_id":"0xD2","asset_id":"0xA","target_pool_id":"0xPOOL","challenger":"0xBOB","bond":"1","evidence_sha256":[2]}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/disputes?challenger=0xALICE").await;
    assert_eq!(status, 200);
    let d = body["data"].as_array().unwrap();
    assert_eq!(d.len(), 1, "only Alice's dispute");
    assert_eq!(d[0]["dispute_id"], "0xD1");
    assert_eq!(d[0]["challenger"], "0xALICE");
}

/// A pool with 5 `MilestoneApprovedEvent` rows reports `track_record.milestones_approved = 5`.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_track_record_milestones_approved(pool: PgPool) {
    route_event(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xvr", "0", 1, json!({"pool_id":"0xPOOL","validator":"0xVAL","stake":"5000000000"}))).await.unwrap();
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 2, asset_created("0xA", "0xE", "1000000000"))).await.unwrap();
    for t in 0..5i64 {
        route_event(&pool, &ev("asset", "MilestoneApprovedEvent", &format!("0xm{t}"), "0", 10 + t,
            json!({"asset_id":"0xA","tranche":t.to_string(),"validator":"0xVAL","pool_id":"0xPOOL"}))).await.unwrap();
    }

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/validators/0xPOOL").await;
    assert_eq!(status, 200);
    assert_eq!(body["track_record"]["milestones_approved"], 5);
}

/// `GET /governance?type=ProtocolParamChangedEvent` returns only that event type. The stored name is
/// normalized (`ProtocolParamChanged`); the filter accepts the suffixed form too.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_governance_filter_by_type(pool: PgPool) {
    route_event(&pool, &ev("protocol", "ProtocolInitializedEvent", "0xg1", "0", 1, json!({"config_id":"0xCFG","admin":"0xADM"}))).await.unwrap();
    route_event(&pool, &ev("protocol", "ProtocolParamChangedEvent", "0xg2", "0", 2, json!({"name":"min_stake","old_value":"5","new_value":"6"}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/governance?type=ProtocolParamChangedEvent").await;
    assert_eq!(status, 200);
    let d = body["data"].as_array().unwrap();
    assert_eq!(d.len(), 1, "only ProtocolParamChanged");
    assert_eq!(d[0]["event_type"], "ProtocolParamChanged");
    assert_eq!(d[0]["param_name"], "min_stake");
}

/// `GET /assets/:id/yield`: `index_after` (u128) serialized as a JSON string.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_index_after_is_string(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("asset", "RevenueDepositedEvent", "0xrev", "0", 10, json!({
        "asset_id":"0xA","gross":"10","fee":"1","investor_portion":"7","entity_portion":"2",
        "index_after":"7000000000000000","unwrapped_supply":"100"
    }))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/assets/0xA/yield").await;
    assert_eq!(status, 200);
    let row = &body["data"][0];
    assert!(row["index_after"].is_string(), "index_after is a JSON string");
    assert_eq!(row["index_after"], "7000000000000000");
}

// ---------------------------------------------------------------------------
// BI-M6 — address page, transaction lookup, portfolio completion, disputes, object proxy, CORS
// ---------------------------------------------------------------------------

/// A fixture [`ObjectSource`] for the object-proxy tests: returns canned RPC results and counts
/// `get_object` calls so the cache behaviour can be asserted without a live node. `object: None`
/// models a non-existent object (`{ data: null, .. }`).
#[derive(Default)]
struct MockSource {
    get_object_calls: AtomicUsize,
    object: Option<Value>,
    legal_docs: Option<Value>,
    coin_metadata: Option<Value>,
}

#[async_trait]
impl ObjectSource for MockSource {
    async fn get_object(&self, _id: &str) -> Result<Value> {
        self.get_object_calls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .object
            .clone()
            .unwrap_or_else(|| json!({ "data": null, "error": { "code": "notExists" } })))
    }
    async fn get_dynamic_field_object(&self, _p: &str, _t: &str, _v: Value) -> Result<Value> {
        Ok(self.legal_docs.clone().unwrap_or_else(|| json!({ "data": null })))
    }
    async fn get_coin_metadata(&self, _t: &str) -> Result<Value> {
        Ok(self.coin_metadata.clone().unwrap_or_else(|| json!({ "data": null })))
    }
}

/// A pure contributor (only `CapitalContributedEvent`, no share claim) still appears in
/// `GET /portfolio/:address` — the feed UNIONs `raise_progress` (`m6.md`).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_portfolio_includes_contributions(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("asset", "CapitalContributedEvent", "0xk", "0", 10, json!({"asset_id":"0xA","contributor":"0xC","amount":"500","raised_after":"500"}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/portfolio/0xC").await;
    assert_eq!(status, 200);
    let rows = body["data"].as_array().unwrap();
    assert_eq!(rows.len(), 1, "the contribution is in the portfolio feed");
    assert_eq!(rows[0]["event_type"], "CapitalContributed");
    assert_eq!(rows[0]["asset_id"], "0xA");
    assert_eq!(rows[0]["amount"], "500");
}

/// An address with contributions + yield claims + wraps returns all event types in one response.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_portfolio_cross_event_types(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("asset", "CapitalContributedEvent", "0xk", "0", 10, json!({"asset_id":"0xA","contributor":"0xH","amount":"100","raised_after":"100"}))).await.unwrap();
    route_event(&pool, &ev("asset", "SharesClaimedEvent", "0xcl", "0", 20, json!({"asset_id":"0xA","holder":"0xH","count":"100","share_object_id":"0xS"}))).await.unwrap();
    route_event(&pool, &ev("accumulator", "SharesWrappedEvent", "0xw", "0", 30, json!({"asset_id":"0xA","holder":"0xH","count":"50","total_wrapped_after":"50"}))).await.unwrap();
    route_event(&pool, &ev("accumulator", "YieldClaimedEvent", "0xy", "0", 40, json!({"asset_id":"0xA","holder":"0xH","amount":"5","index_at_claim":"7000000000"}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/portfolio/0xH").await;
    assert_eq!(status, 200);
    let types: std::collections::HashSet<&str> =
        body["data"].as_array().unwrap().iter().map(|r| r["event_type"].as_str().unwrap()).collect();
    for expected in ["CapitalContributed", "SharesClaimed", "SharesWrapped", "YieldClaimed"] {
        assert!(types.contains(expected), "{expected} present in portfolio feed");
    }
}

/// `GET /portfolio/:address/assets` returns the correct `event_count` per asset (across
/// `position_events` ∪ `raise_progress`).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_portfolio_assets_summary(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc1", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc2", "0", 2, asset_created("0xB", "0xE", "1000000000"))).await.unwrap();
    // 0xH: two events on 0xA (contribution + claim), one on 0xB.
    route_event(&pool, &ev("asset", "CapitalContributedEvent", "0xk", "0", 10, json!({"asset_id":"0xA","contributor":"0xH","amount":"100","raised_after":"100"}))).await.unwrap();
    route_event(&pool, &ev("asset", "SharesClaimedEvent", "0xcl", "0", 20, json!({"asset_id":"0xA","holder":"0xH","count":"100","share_object_id":"0xS1"}))).await.unwrap();
    route_event(&pool, &ev("asset", "SharesClaimedEvent", "0xcl2", "0", 30, json!({"asset_id":"0xB","holder":"0xH","count":"200","share_object_id":"0xS2"}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/portfolio/0xH/assets").await;
    assert_eq!(status, 200);
    let rows = body["data"].as_array().unwrap();
    let a = rows.iter().find(|r| r["asset_id"] == "0xA").unwrap();
    let b = rows.iter().find(|r| r["asset_id"] == "0xB").unwrap();
    assert_eq!(a["event_count"], 2, "two events on 0xA");
    assert_eq!(b["event_count"], 1, "one event on 0xB");
    assert_eq!(a["first_seen_ms"], 10);
    assert_eq!(a["last_seen_ms"], 20);
}

/// `GET /disputes?verdict=1` returns only UPHELD disputes.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_dispute_list_filter_verdict(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xvr", "0", 2, json!({"pool_id":"0xPOOL","validator":"0xVAL","stake":"5000000000"}))).await.unwrap();
    route_event(&pool, &ev("dispute", "DisputeOpenedEvent", "0xd1", "0", 10, json!({"dispute_id":"0xD1","asset_id":"0xA","target_pool_id":"0xPOOL","challenger":"0xCH","bond":"1","evidence_sha256":[1]}))).await.unwrap();
    route_event(&pool, &ev("dispute", "DisputeOpenedEvent", "0xd2", "0", 11, json!({"dispute_id":"0xD2","asset_id":"0xA","target_pool_id":"0xPOOL","challenger":"0xCH","bond":"1","evidence_sha256":[2]}))).await.unwrap();
    // 0xD1 UPHELD (verdict 1); 0xD2 stays open.
    route_event(&pool, &ev("dispute", "DisputeResolvedEvent", "0xdr", "0", 20, json!({"dispute_id":"0xD1","asset_id":"0xA","target_pool_id":"0xPOOL","verdict":1,"slashed":"1","bounty":"1","challenger":"0xCH"}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/disputes?verdict=1").await;
    assert_eq!(status, 200);
    let d = body["data"].as_array().unwrap();
    assert_eq!(d.len(), 1, "only the UPHELD dispute");
    assert_eq!(d[0]["dispute_id"], "0xD1");
    assert_eq!(d[0]["verdict"], 1);

    // ?asset_id= also narrows the feed (BI-M6 filter).
    let (_, by_asset) = get_json(&base, "/disputes?asset_id=0xA").await;
    assert_eq!(by_asset["data"].as_array().unwrap().len(), 2, "both disputes on 0xA");
}

/// `GET /disputes/:id` includes a `jury_votes` array with the correct entries.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_dispute_detail_with_votes(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xvr", "0", 2, json!({"pool_id":"0xPOOL","validator":"0xVAL","stake":"5000000000"}))).await.unwrap();
    route_event(&pool, &ev("dispute", "DisputeOpenedEvent", "0xd0", "0", 10, json!({"dispute_id":"0xD","asset_id":"0xA","target_pool_id":"0xPOOL","challenger":"0xCH","bond":"1000000","evidence_sha256":[9]}))).await.unwrap();
    route_event(&pool, &ev("dispute", "JurorVotedEvent", "0xv0", "0", 20, json!({"dispute_id":"0xD","juror_pool_id":"0xJ1","guilty":true,"votes_guilty_after":"1","votes_innocent_after":"0"}))).await.unwrap();
    route_event(&pool, &ev("dispute", "JurorVotedEvent", "0xv1", "0", 21, json!({"dispute_id":"0xD","juror_pool_id":"0xJ2","guilty":false,"votes_guilty_after":"1","votes_innocent_after":"1"}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/disputes/0xD").await;
    assert_eq!(status, 200);
    let votes = body["jury_votes"].as_array().unwrap();
    assert_eq!(votes.len(), 2, "both juror votes embedded");
    assert_eq!(votes[0]["juror_pool_id"], "0xJ1");
    assert_eq!(votes[1]["juror_pool_id"], "0xJ2");
}

/// `GET /disputes` list includes `votes_guilty_after` from the latest `JurorVotedEvent`.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_dispute_vote_tally_in_list(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xvr", "0", 2, json!({"pool_id":"0xPOOL","validator":"0xVAL","stake":"5000000000"}))).await.unwrap();
    route_event(&pool, &ev("dispute", "DisputeOpenedEvent", "0xd0", "0", 10, json!({"dispute_id":"0xD","asset_id":"0xA","target_pool_id":"0xPOOL","challenger":"0xCH","bond":"1","evidence_sha256":[1]}))).await.unwrap();
    route_event(&pool, &ev("dispute", "JurorVotedEvent", "0xv0", "0", 20, json!({"dispute_id":"0xD","juror_pool_id":"0xJ1","guilty":true,"votes_guilty_after":"1","votes_innocent_after":"0"}))).await.unwrap();
    route_event(&pool, &ev("dispute", "JurorVotedEvent", "0xv1", "0", 21, json!({"dispute_id":"0xD","juror_pool_id":"0xJ2","guilty":true,"votes_guilty_after":"2","votes_innocent_after":"0"}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/disputes").await;
    assert_eq!(status, 200);
    let d = &body["data"][0];
    assert_eq!(d["votes_guilty_after"], 2, "latest running guilty tally");
    assert_eq!(d["votes_innocent_after"], 0);
}

/// `GET /objects/:id` returns the proxied object JSON (fixture source).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_object_proxy_returns_json(pool: PgPool) {
    let mock = Arc::new(MockSource {
        object: Some(json!({ "data": { "objectId": "0xOBJ", "type": "0x2::coin::Coin" } })),
        ..Default::default()
    });
    let proxy = Arc::new(ObjectProxy::new(mock, "0xpkg", Duration::from_secs(5)));
    let base = serve_with_objects(pool, proxy).await;
    let (status, body) = get_json(&base, "/objects/0xOBJ").await;
    assert_eq!(status, 200);
    assert_eq!(body["data"]["objectId"], "0xOBJ");
}

/// Two `object` reads within the TTL hit the Sui RPC only once.
#[tokio::test]
async fn test_object_proxy_caches() {
    let mock = Arc::new(MockSource {
        object: Some(json!({ "data": { "objectId": "0xOBJ" } })),
        ..Default::default()
    });
    let proxy = ObjectProxy::new(mock.clone(), "0xpkg", Duration::from_secs(30));
    assert!(proxy.object("0xOBJ").await.unwrap().is_some());
    assert!(proxy.object("0xOBJ").await.unwrap().is_some());
    assert_eq!(
        mock.get_object_calls.load(Ordering::SeqCst),
        1,
        "second read served from cache"
    );
}

/// A read after the TTL has elapsed re-hits the Sui RPC.
#[tokio::test]
async fn test_object_proxy_cache_expires() {
    let mock = Arc::new(MockSource {
        object: Some(json!({ "data": { "objectId": "0xOBJ" } })),
        ..Default::default()
    });
    let proxy = ObjectProxy::new(mock.clone(), "0xpkg", Duration::from_millis(20));
    assert!(proxy.object("0xOBJ").await.unwrap().is_some());
    tokio::time::sleep(Duration::from_millis(40)).await;
    assert!(proxy.object("0xOBJ").await.unwrap().is_some());
    assert_eq!(
        mock.get_object_calls.load(Ordering::SeqCst),
        2,
        "stale entry re-fetched"
    );
}

/// `GET /objects/:id` for a non-existent object → 404.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_object_proxy_404_unknown(pool: PgPool) {
    let mock = Arc::new(MockSource::default()); // object = None → notExists
    let proxy = Arc::new(ObjectProxy::new(mock, "0xpkg", Duration::from_secs(5)));
    let base = serve_with_objects(pool, proxy).await;
    let (status, body) = get_json(&base, "/objects/0xnonexistent").await;
    assert_eq!(status, 404);
    assert_eq!(body["error"], "not_found");
}

/// A cross-origin request gets an `Access-Control-Allow-Origin` header (default permissive CORS).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_cors_header_present(pool: PgPool) {
    let base = serve(pool).await;
    let resp = reqwest::Client::new()
        .get(format!("{base}/health"))
        .header("Origin", "http://localhost:3000")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert!(
        resp.headers().get("access-control-allow-origin").is_some(),
        "CORS header present on a cross-origin response"
    );
}

/// An address that is the entity of one asset, contributor on it, and challenger of one dispute
/// returns `roles` containing `entity`, `challenger`, and `investor`; `attribution: protocol`.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_address_roles_derived(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xADDR", "1000000000"))).await.unwrap();
    route_event(&pool, &ev("validator", "ValidatorRegisteredEvent", "0xvr", "0", 2, json!({"pool_id":"0xPOOL","validator":"0xVAL","stake":"5000000000"}))).await.unwrap();
    route_event(&pool, &ev("asset", "CapitalContributedEvent", "0xk", "0", 10, json!({"asset_id":"0xA","contributor":"0xADDR","amount":"100","raised_after":"100"}))).await.unwrap();
    route_event(&pool, &ev("dispute", "DisputeOpenedEvent", "0xd0", "0", 20, json!({"dispute_id":"0xD","asset_id":"0xA","target_pool_id":"0xPOOL","challenger":"0xADDR","bond":"1","evidence_sha256":[1]}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/address/0xADDR").await;
    assert_eq!(status, 200);
    let roles: std::collections::HashSet<&str> =
        body["roles"].as_array().unwrap().iter().map(|r| r.as_str().unwrap()).collect();
    assert!(roles.contains("entity"), "entity role");
    assert!(roles.contains("challenger"), "challenger role");
    assert!(roles.contains("investor"), "investor role");
    assert!(!roles.contains("validator"), "not a validator operator");
    assert_eq!(body["attribution"], "protocol");
}

/// `GET /address/:addr` holdings reflect the §2.17 signed fold across claim/wrap/unwrap, with
/// `attribution: protocol`.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_address_holdings_fold(pool: PgPool) {
    route_event(&pool, &ev("asset", "AssetCreatedEvent", "0xc", "0", 1, asset_created("0xA", "0xE", "1000"))).await.unwrap();
    route_event(&pool, &ev("asset", "SharesClaimedEvent", "0xcl", "0", 10, json!({"asset_id":"0xA","holder":"0xH","count":"300","share_object_id":"0xS"}))).await.unwrap();
    route_event(&pool, &ev("accumulator", "SharesWrappedEvent", "0xw", "0", 20, json!({"asset_id":"0xA","holder":"0xH","count":"100","total_wrapped_after":"100"}))).await.unwrap();
    route_event(&pool, &ev("accumulator", "SharesUnwrappedEvent", "0xu", "0", 30, json!({"asset_id":"0xA","holder":"0xH","count":"50","share_object_id":"0xS2","total_wrapped_after":"50"}))).await.unwrap();
    route_event(&pool, &ev("accumulator", "YieldClaimedEvent", "0xy", "0", 40, json!({"asset_id":"0xA","holder":"0xH","amount":"7","index_at_claim":"7000000000"}))).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/address/0xH").await;
    assert_eq!(status, 200);
    assert_eq!(body["attribution"], "protocol");
    let h = &body["holdings"][0];
    assert_eq!(h["asset_id"], "0xA");
    // deeds = 300 - 100 + 50 = 250 ; wrapped = 100 - 50 = 50.
    assert_eq!(h["share_count"], "250");
    assert_eq!(h["wrapped"], "50");
    assert_eq!(h["yield_claimed_index"], "7000000000");
}

/// A finalize tx (`RaiseFinalizedEvent` + `AssetStateChangedEvent`) returns both events under
/// `GET /tx/:digest`, ordered by `event_seq`, plus the affected objects. Seeds `raw_events`
/// directly (the typed-handler `route_event` path doesn't archive — the ingestion loop does).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_tx_groups_events(pool: PgPool) {
    let p0 = json!({ "asset_id": "0xA", "accumulator_id": "0xACC", "total_shares": "1000" });
    let p1 = json!({ "asset_id": "0xA", "old_state": 1, "new_state": 4 });
    db::queries::upsert_raw_event(&pool, &db::queries::RawEventInsert {
        tx_digest: "0xFIN", event_seq: 0, checkpoint_seq: 7, timestamp_ms: 500,
        event_type: &format!("{PKG}::asset::RaiseFinalizedEvent"), payload: &p0,
    }).await.unwrap();
    db::queries::upsert_raw_event(&pool, &db::queries::RawEventInsert {
        tx_digest: "0xFIN", event_seq: 1, checkpoint_seq: 7, timestamp_ms: 500,
        event_type: &format!("{PKG}::asset::AssetStateChangedEvent"), payload: &p1,
    }).await.unwrap();

    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/tx/0xFIN").await;
    assert_eq!(status, 200);
    assert_eq!(body["tx_digest"], "0xFIN");
    assert_eq!(body["checkpoint_seq"], 7);
    let events = body["events"].as_array().unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["event_seq"], 0);
    assert_eq!(events[0]["event_type"], "RaiseFinalizedEvent");
    assert_eq!(events[1]["event_type"], "AssetStateChangedEvent");
    // affected = union of id/address fields across both payloads.
    let affected: Vec<&str> = body["affected"].as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect();
    assert!(affected.contains(&"0xA") && affected.contains(&"0xACC"));

    // Unknown digest → 404.
    let (missing, _) = get_json(&base, "/tx/0xNOPE").await;
    assert_eq!(missing, 404);
}

/// `GET /objects/:id/legal-docs` reshapes the `LegalDocsKey` dynamic-field read into WalrusRefs
/// with `blob_id` present (`sha256` byte-arrays hex-encoded).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_legal_docs_dynamic_field(pool: PgPool) {
    let legal = json!({ "data": { "content": { "fields": { "value": [
        { "fields": { "blob_id": "blobABC", "sha256": [171, 18], "attested_by": "0xVAL" } }
    ] } } } });
    let mock = Arc::new(MockSource { legal_docs: Some(legal), ..Default::default() });
    let proxy = Arc::new(ObjectProxy::new(mock, "0xpkg", Duration::from_secs(5)));
    let base = serve_with_objects(pool, proxy).await;
    let (status, body) = get_json(&base, "/objects/0xASSET/legal-docs").await;
    assert_eq!(status, 200);
    let docs = body.as_array().unwrap();
    assert_eq!(docs.len(), 1);
    assert_eq!(docs[0]["blob_id"], "blobABC", "blob_id recoverable only via the dynamic field");
    assert_eq!(docs[0]["sha256"], "ab12", "byte-array sha256 hex-encoded");
    assert_eq!(docs[0]["attested_by"], "0xVAL");
}

/// Resolving an accumulator's `CoinMetadata<T>` (fixture source) yields the token `symbol` — the
/// type `T` is recovered from the accumulator object's type string (`backend.md §4.4`).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_token_metadata_symbol(pool: PgPool) {
    let acc = json!({ "data": {
        "objectId": "0xACC",
        "type": "0xPKG::accumulator::GlobalYieldAccumulator<0xTOK::entity_token::ENTITY_TOKEN>"
    }});
    let meta = json!({ "decimals": 6, "name": "Gally Token", "symbol": "GALLY" });
    let mock = Arc::new(MockSource { object: Some(acc), coin_metadata: Some(meta), ..Default::default() });
    let proxy = Arc::new(ObjectProxy::new(mock, "0xpkg", Duration::from_secs(5)));
    let base = serve_with_objects(pool, proxy).await;
    let (status, body) = get_json(&base, "/objects/0xACC/token-metadata").await;
    assert_eq!(status, 200);
    assert_eq!(body["symbol"], "GALLY");
    assert_eq!(body["coin_type"], "0xTOK::entity_token::ENTITY_TOKEN");
    assert_eq!(body["decimals"], 6);
}

// ---------------------------------------------------------------------------
// BI-M7 — WebSocket live push, /health lag alerting, /metrics
// ---------------------------------------------------------------------------

/// The concrete WS client type `connect_async` yields over a plain TCP (ws://) connection.
type WsClient =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// Serve the app and hand back a clone of its WebSocket [`Hub`] so the test can publish events the
/// connected client should receive.
async fn serve_ws(pool: PgPool) -> (String, std::sync::Arc<gally_indexer::ws::Hub>) {
    let hub = crate::default_hub();
    let state = api::AppState {
        pool,
        objects: crate::default_objects(),
        hub: hub.clone(),
        metrics: crate::default_metrics(),
        tip: crate::tip_at(Some(0)),
        lag_alert_checkpoints: 100,
    };
    (crate::spawn(state).await, hub)
}

/// Serve the app with a specific chain-tip fixture (`/health` lag tests).
async fn serve_with_tip(pool: PgPool, tip: std::sync::Arc<gally_indexer::sui_client::ChainTip>) -> String {
    let state = api::AppState {
        pool,
        objects: crate::default_objects(),
        hub: crate::default_hub(),
        metrics: crate::default_metrics(),
        tip,
        lag_alert_checkpoints: 100,
    };
    crate::spawn(state).await
}

/// Open a WS connection to `path` (rewriting `http→ws`) and return the stream after the connection
/// is established.
async fn ws_open(base: &str, path: &str) -> WsClient {
    let url = format!("{}{}", base.replacen("http", "ws", 1), path);
    let (stream, _resp) = connect_async(url).await.expect("ws handshake");
    stream
}

/// Receive the next frame as JSON, failing if none arrives within 1s (Pass Criteria 3).
async fn recv_json(ws: &mut WsClient) -> Value {
    let msg = tokio::time::timeout(Duration::from_secs(1), ws.next())
        .await
        .expect("a frame within 1s")
        .expect("stream still open")
        .expect("a valid ws frame");
    serde_json::from_str(msg.to_text().unwrap()).unwrap()
}

/// A WS client subscribed to `assets/:id` receives the next ingested event for that asset.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_ws_asset_receives_event(pool: PgPool) {
    let (base, hub) = serve_ws(pool).await;
    let mut ws = ws_open(&base, "/ws/assets/0xA").await;

    let hello = recv_json(&mut ws).await;
    assert_eq!(hello["type"], "connected");
    assert_eq!(hello["channel"], "assets/0xA");

    hub.publish_event(&ev("asset", "SharesClaimedEvent", "0xtx", "0", 10,
        json!({"asset_id":"0xA","holder":"0xH","count":"5","share_object_id":"0xS"})));

    let frame = recv_json(&mut ws).await;
    assert_eq!(frame["type"], "event");
    assert_eq!(frame["event_type"], "SharesClaimedEvent");
    assert_eq!(frame["asset_id"], "0xA");
}

/// A WS client subscribed to `portfolio/:address` receives the next position event for that actor.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_ws_portfolio_receives_event(pool: PgPool) {
    let (base, hub) = serve_ws(pool).await;
    let mut ws = ws_open(&base, "/ws/portfolio/0xH").await;
    assert_eq!(recv_json(&mut ws).await["type"], "connected");

    hub.publish_event(&ev("asset", "SharesClaimedEvent", "0xtx", "0", 10,
        json!({"asset_id":"0xA","holder":"0xH","count":"5","share_object_id":"0xS"})));

    let frame = recv_json(&mut ws).await;
    assert_eq!(frame["type"], "event");
    assert_eq!(frame["holder"], "0xH");
}

/// A WS client subscribed to `disputes/:id` receives a `JurorVotedEvent` push.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_ws_dispute_receives_vote(pool: PgPool) {
    let (base, hub) = serve_ws(pool).await;
    let mut ws = ws_open(&base, "/ws/disputes/0xD").await;
    assert_eq!(recv_json(&mut ws).await["type"], "connected");

    hub.publish_event(&ev("dispute", "JurorVotedEvent", "0xv", "0", 20,
        json!({"dispute_id":"0xD","juror_pool_id":"0xJ1","guilty":true,"votes_guilty_after":"1","votes_innocent_after":"0"})));

    let frame = recv_json(&mut ws).await;
    assert_eq!(frame["type"], "event");
    assert_eq!(frame["event_type"], "JurorVotedEvent");
    assert_eq!(frame["dispute_id"], "0xD");
}

/// Events for asset A are NOT delivered to a subscriber on asset B (no cross-channel leak).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_ws_no_cross_channel_leak(pool: PgPool) {
    let (base, hub) = serve_ws(pool).await;
    let mut ws = ws_open(&base, "/ws/assets/0xA").await;
    assert_eq!(recv_json(&mut ws).await["type"], "connected");

    // A 0xB event has no subscriber on the 0xA channel → dropped. The next frame the 0xA client
    // sees must be the subsequent 0xA event, proving the 0xB one never leaked.
    hub.publish_event(&ev("asset", "SharesClaimedEvent", "0xtxB", "0", 10,
        json!({"asset_id":"0xB","holder":"0xH","count":"1","share_object_id":"0xSB"})));
    hub.publish_event(&ev("asset", "SharesClaimedEvent", "0xtxA", "0", 11,
        json!({"asset_id":"0xA","holder":"0xH","count":"2","share_object_id":"0xSA"})));

    let frame = recv_json(&mut ws).await;
    assert_eq!(frame["asset_id"], "0xA", "only the 0xA event reaches the 0xA subscriber");
}

/// With the indexer at the chain tip, `/health` returns 200 and `status: "ok"`.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_health_ok(pool: PgPool) {
    // Default serve uses tip = 0; a fresh DB cursor is also 0 → lag 0.
    let base = serve(pool).await;
    let (status, body) = get_json(&base, "/health").await;
    assert_eq!(status, 200);
    assert_eq!(body["status"], "ok");
    assert_eq!(body["lag_checkpoints"], 0);
    assert_eq!(body["cursor"], 0);
}

/// With the cursor 200 checkpoints behind the tip (threshold 100), `/health` returns 503 `lagging`.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_health_lagging_503(pool: PgPool) {
    // Cursor stays 0 (fresh DB); tip fixture is 200 → lag 200 > 100.
    let base = serve_with_tip(pool, crate::tip_at(Some(200))).await;
    let (status, body) = get_json(&base, "/health").await;
    assert_eq!(status, 503);
    assert_eq!(body["status"], "lagging");
    assert_eq!(body["lag_checkpoints"], 200);
    assert_eq!(body["latest_chain_checkpoint"], 200);
}

/// With the Sui node unreachable, `/health` returns 503 `error`.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_health_node_unreachable_503(pool: PgPool) {
    let base = serve_with_tip(pool, crate::tip_at(None)).await;
    let (status, body) = get_json(&base, "/health").await;
    assert_eq!(status, 503);
    assert_eq!(body["status"], "error");
    assert_eq!(body["reason"], "cannot reach node");
}

/// `GET /metrics` returns valid Prometheus text exposition (HELP/TYPE headers for each metric).
/// The labelled counter families (`events_processed`, `object_proxy_requests`) only emit a TYPE
/// header once they have at least one series, so the test primes them first — the realistic state
/// after any ingestion/proxy activity.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_metrics_valid_prometheus(pool: PgPool) {
    let metrics = crate::default_metrics();
    metrics.record_event("AssetCreatedEvent");
    metrics.record_unknown();
    metrics.record_proxy(true);
    let state = api::AppState {
        pool,
        objects: crate::default_objects(),
        hub: crate::default_hub(),
        metrics: metrics.clone(),
        tip: crate::tip_at(Some(0)),
        lag_alert_checkpoints: 100,
    };
    let base = crate::spawn(state).await;
    let resp = reqwest::Client::new()
        .get(format!("{base}/metrics"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let ct = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    assert!(ct.starts_with("text/plain"), "prometheus content-type, got {ct}");
    let body = resp.text().await.unwrap();
    // Every declared metric is present with a well-formed TYPE header (TextEncoder output is valid
    // Prometheus text by construction; this confirms the registry wired all collectors).
    for marker in [
        "# TYPE gally_indexer_cursor gauge",
        "# TYPE gally_indexer_lag_checkpoints gauge",
        "# TYPE gally_indexer_events_processed_total counter",
        "# TYPE gally_indexer_events_unknown_total counter",
        "# TYPE gally_indexer_db_write_duration_seconds histogram",
        "# TYPE gally_indexer_ws_connections_active gauge",
        "# TYPE gally_indexer_object_proxy_requests_total counter",
    ] {
        assert!(body.contains(marker), "metrics output missing `{marker}`");
    }
}

/// After ingesting 3 events, `gally_indexer_events_processed_total` reflects them.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_metrics_events_counter(pool: PgPool) {
    let metrics = crate::default_metrics();
    let hub = crate::default_hub();
    for i in 0..3i64 {
        gally_indexer::ingestion::process_event(
            &pool,
            &hub,
            &metrics,
            &ev("asset", "AssetCreatedEvent", &format!("0xt{i}"), "0", i,
                asset_created(&format!("0xA{i}"), "0xE", "1000000000")),
        )
        .await
        .unwrap();
    }
    let body = metrics.render();
    assert!(
        body.contains(r#"gally_indexer_events_processed_total{event_type="AssetCreatedEvent"} 3"#),
        "events_processed_total counter reflects 3 AssetCreatedEvent ingests; got:\n{body}"
    );
}
