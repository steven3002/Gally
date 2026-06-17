//! BI-M2 API integration tests: `/assets`, `/assets/:id/history`, `/governance`. Each spins up
//! the real Axum app over an ephemeral port, seeds rows through [`route_event`], and asserts the
//! §6 response shapes inside the universal `{ data, nextCursor, hasNextPage }` envelope
//! (`backend.md §5.1.1`).

use gally_indexer::ingestion::route_event;
use gally_indexer::sui_client::{EventId, SuiEvent};
use gally_indexer::{api, db};
use serde_json::{json, Value};
use sqlx::PgPool;

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

/// Serve the app on an ephemeral port and return its base URL.
async fn serve(pool: PgPool) -> String {
    let app = api::router(api::AppState { pool });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
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

    // /portfolio/:addr/assets returns the distinct set.
    let (_, distinct) = get_json(&base, "/portfolio/0xH/assets").await;
    let d: Vec<&str> = distinct["data"].as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect();
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
