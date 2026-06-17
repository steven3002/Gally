//! BI-M7 end-to-end lifecycle replay (`m7.md` Tasks → "Integration test suite"). Replays a
//! complete protocol lifecycle fixture through the production ingestion path and asserts both the
//! DB state and the REST API response at each stage, then proves the whole replay is idempotent.

use gally_indexer::ingestion::route_event;
use gally_indexer::sui_client::{EventId, SuiEvent};
use serde_json::{json, Value};
use sqlx::PgPool;

const PKG: &str = "0x309d0b80";

fn ev(module: &str, struct_name: &str, tx: &str, ts: i64, parsed: Value) -> SuiEvent {
    SuiEvent {
        id: EventId {
            tx_digest: tx.to_string(),
            event_seq: "0".to_string(),
        },
        event_type: format!("{PKG}::{module}::{struct_name}"),
        parsed_json: parsed,
        timestamp_ms: Some(ts.to_string()),
    }
}

async fn route(pool: &PgPool, e: &SuiEvent) {
    route_event(pool, e).await.expect("handler must succeed");
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

/// The full ordered lifecycle fixture (the 14 stages of `m7.md`). One `(tx_digest, event_seq)` per
/// event, timestamps strictly increasing so every feed sorts deterministically.
fn script() -> Vec<SuiEvent> {
    vec![
        // 1. Protocol init.
        ev("protocol", "ProtocolInitializedEvent", "0x01", 1, json!({"config_id":"0xCFG","admin":"0xADM"})),
        // 2. Validator registered.
        ev("validator", "ValidatorRegisteredEvent", "0x02", 2, json!({"pool_id":"0xPOOL","validator":"0xVAL","stake":"5000000000"})),
        // 3. Asset created (PENDING_VOUCH=0).
        ev("asset", "AssetCreatedEvent", "0x03", 3, json!({
            "asset_id":"0xA","entity":"0xENT","funding_goal":"300","funding_deadline_ms":"1750000000000",
            "tranche_count":"1","revenue_split_bps":"7000","collateral":"100000000"
        })),
        // 4. Asset vouched → validator_pool_id set.
        ev("asset", "AssetVouchedEvent", "0x04", 4, json!({
            "asset_id":"0xA","pool_id":"0xPOOL","validator":"0xVAL","coverage":"600","doc_hashes":[[1,2,3]]
        })),
        // 5a. Funding opens (0→1) then 5b. three contributions.
        ev("asset", "AssetStateChangedEvent", "0x05", 5, json!({"asset_id":"0xA","old_state":0,"new_state":1})),
        ev("asset", "CapitalContributedEvent", "0x06", 6, json!({"asset_id":"0xA","contributor":"0xC1","amount":"100","raised_after":"100"})),
        ev("asset", "CapitalContributedEvent", "0x07", 7, json!({"asset_id":"0xA","contributor":"0xC2","amount":"100","raised_after":"200"})),
        ev("asset", "CapitalContributedEvent", "0x08", 8, json!({"asset_id":"0xA","contributor":"0xC3","amount":"100","raised_after":"300"})),
        // 6. Raise finalized → accumulator set + EXECUTING(4).
        ev("asset", "RaiseFinalizedEvent", "0x09", 9, json!({"asset_id":"0xA","accumulator_id":"0xACC","total_shares":"300"})),
        ev("asset", "AssetStateChangedEvent", "0x0a", 10, json!({"asset_id":"0xA","old_state":1,"new_state":4})),
        // 7. Two contributors claim shares.
        ev("asset", "SharesClaimedEvent", "0x0b", 11, json!({"asset_id":"0xA","holder":"0xC1","count":"100","share_object_id":"0xS1"})),
        ev("asset", "SharesClaimedEvent", "0x0c", 12, json!({"asset_id":"0xA","holder":"0xC2","count":"200","share_object_id":"0xS2"})),
        // 8. Tranche proof → approval → release (tranche 0).
        ev("asset", "MilestoneProofSubmittedEvent", "0x0d", 13, json!({"asset_id":"0xA","tranche":"0","blob_id":[222,173],"sha256":[190,239]})),
        ev("asset", "MilestoneApprovedEvent", "0x0e", 14, json!({"asset_id":"0xA","tranche":"0","validator":"0xVAL","pool_id":"0xPOOL"})),
        ev("asset", "TrancheReleasedEvent", "0x0f", 15, json!({"asset_id":"0xA","tranche":"0","amount":"100","escrow_after":"200"})),
        // 9. Revenue deposited → yield index moves.
        ev("asset", "RevenueDepositedEvent", "0x10", 16, json!({
            "asset_id":"0xA","gross":"100","fee":"10","investor_portion":"70","entity_portion":"20",
            "index_after":"1000000000","unwrapped_supply":"300"
        })),
        // 10. Yield claimed by a holder.
        ev("accumulator", "YieldClaimedEvent", "0x11", 17, json!({"asset_id":"0xA","holder":"0xC1","amount":"23","index_at_claim":"1000000000"})),
        // 11. Shares wrapped.
        ev("accumulator", "SharesWrappedEvent", "0x12", 18, json!({"asset_id":"0xA","holder":"0xC1","count":"50","total_wrapped_after":"50"})),
        // 12. Dispute opened → 2 votes → resolved UPHELD; validator SLASHED.
        ev("dispute", "DisputeOpenedEvent", "0x13", 19, json!({"dispute_id":"0xD","asset_id":"0xA","target_pool_id":"0xPOOL","challenger":"0xCH","bond":"1000000","evidence_sha256":[9,9]})),
        ev("dispute", "JurorVotedEvent", "0x14", 20, json!({"dispute_id":"0xD","juror_pool_id":"0xJ1","guilty":true,"votes_guilty_after":"1","votes_innocent_after":"0"})),
        ev("dispute", "JurorVotedEvent", "0x15", 21, json!({"dispute_id":"0xD","juror_pool_id":"0xJ2","guilty":true,"votes_guilty_after":"2","votes_innocent_after":"0"})),
        ev("dispute", "DisputeResolvedEvent", "0x16", 22, json!({"dispute_id":"0xD","asset_id":"0xA","target_pool_id":"0xPOOL","verdict":1,"slashed":"2000000000","bounty":"1000000000","challenger":"0xCH"})),
        ev("validator", "ValidatorStatusChangedEvent", "0x17", 23, json!({"pool_id":"0xPOOL","old_status":0,"new_status":2,"dispute_id":"0xD"})),
        // 13. Asset defaults → COMPENSATING(6).
        ev("asset", "AssetStateChangedEvent", "0x18", 24, json!({"asset_id":"0xA","old_state":4,"new_state":6})),
        // 14. Asset closed → CLOSED(7).
        ev("asset", "AssetClosedEvent", "0x19", 25, json!({"asset_id":"0xA","reason":1})),
        ev("asset", "AssetStateChangedEvent", "0x1a", 26, json!({"asset_id":"0xA","old_state":6,"new_state":7})),
    ]
}

/// Replay the whole fixture, then assert every stage's effect across the DB and the REST surface.
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_full_lifecycle(pool: PgPool) {
    for e in script() {
        route(&pool, &e).await;
    }
    let base = crate::spawn(crate::app_state(pool.clone(), crate::default_objects())).await;

    // 1. Governance event stored.
    let (_, gov) = get_json(&base, "/governance").await;
    let types: Vec<&str> = gov["data"].as_array().unwrap().iter().map(|g| g["event_type"].as_str().unwrap()).collect();
    assert!(types.contains(&"ProtocolInitialized"), "protocol init in governance feed");

    // 2. Validator pool appears.
    let (_, vals) = get_json(&base, "/validators").await;
    assert_eq!(vals["data"][0]["pool_id"], "0xPOOL");

    // 3/4/6/14. Asset record: vouched pool, finalized accumulator, final CLOSED state.
    let (status, asset) = get_json(&base, "/assets/0xA").await;
    assert_eq!(status, 200);
    assert_eq!(asset["validator_pool_id"], "0xPOOL", "vouch set the pool");
    assert_eq!(asset["accumulator_id"], "0xACC", "finalize set the accumulator");
    assert_eq!(asset["current_state"], 7, "asset ends CLOSED");
    // DB cross-check on the denormalized current_state.
    let db_state: (i16,) = sqlx::query_as("SELECT current_state FROM assets WHERE asset_id = $1")
        .bind("0xA").fetch_one(&pool).await.unwrap();
    assert_eq!(db_state.0, 7);

    // 5. Three raise-progress points.
    let (_, raise) = get_json(&base, "/assets/0xA/raise-progress").await;
    let raised: Vec<&str> = raise["data"].as_array().unwrap().iter().map(|r| r["raised_after"].as_str().unwrap()).collect();
    assert_eq!(raised, vec!["100", "200", "300"], "three contributions in order");

    // 7. Both claimants appear in their portfolios.
    for holder in ["0xC1", "0xC2"] {
        let (_, pf) = get_json(&base, &format!("/portfolio/{holder}")).await;
        let has_claim = pf["data"].as_array().unwrap().iter().any(|r| r["event_type"] == "SharesClaimed");
        assert!(has_claim, "{holder} has a SharesClaimed in portfolio");
    }

    // 8. Tranche feed has the three milestone entries.
    let (_, tr) = get_json(&base, "/assets/0xA/tranches").await;
    let tr_types: Vec<&str> = tr["data"].as_array().unwrap().iter().map(|t| t["event_type"].as_str().unwrap()).collect();
    assert_eq!(tr_types, vec!["proof_submitted", "approved", "released"], "three tranche entries");

    // 9. One yield point with the exact u128 index string.
    let (_, yld) = get_json(&base, "/assets/0xA/yield").await;
    assert_eq!(yld["data"].as_array().unwrap().len(), 1);
    assert_eq!(yld["data"][0]["index_after"], "1000000000");

    // 10. Yield claim is in the holder's portfolio with the right index.
    let (_, pf1) = get_json(&base, "/portfolio/0xC1").await;
    let yc = pf1["data"].as_array().unwrap().iter().find(|r| r["event_type"] == "YieldClaimed").expect("YieldClaimed present");
    assert_eq!(yc["index_at_claim"], "1000000000");

    // 11. Wrap-ratio series updated.
    let (_, wr) = get_json(&base, "/assets/0xA/wrap-ratio").await;
    assert_eq!(wr["data"].as_array().unwrap().len(), 1);
    assert_eq!(wr["data"][0]["total_wrapped_after"], "50");

    // 12. Dispute UPHELD with 2 votes; validator SLASHED.
    let (_, disp) = get_json(&base, "/disputes/0xD").await;
    assert_eq!(disp["verdict"], 1, "UPHELD");
    assert_eq!(disp["jury_votes"].as_array().unwrap().len(), 2);
    let (_, pool_rec) = get_json(&base, "/validators/0xPOOL").await;
    assert_eq!(pool_rec["current_status"], 2, "validator SLASHED");

    // 13. State history shows EXECUTING(4) → COMPENSATING(6) before CLOSED(7).
    let (_, hist) = get_json(&base, "/assets/0xA/history").await;
    let states: Vec<i64> = hist["data"].as_array().unwrap().iter().map(|h| h["new_state"].as_i64().unwrap()).collect();
    assert_eq!(states, vec![0, 1, 4, 6, 7], "full ordered state history");
}

/// The row-count probe tables, in a fixed order, for the idempotency comparison.
const COUNTED_TABLES: [&str; 8] = [
    "assets",
    "raise_progress",
    "position_events",
    "tranche_events",
    "disputes",
    "jury_votes",
    "asset_state_changes",
    "governance_events",
];

/// `count(*)` for each [`COUNTED_TABLES`] entry, in order. Table names are crate constants (no
/// injection risk).
async fn table_counts(pool: &PgPool) -> Vec<i64> {
    let mut counts = Vec::with_capacity(COUNTED_TABLES.len());
    for table in COUNTED_TABLES {
        let c: (i64,) = sqlx::query_as(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(pool)
            .await
            .unwrap();
        counts.push(c.0);
    }
    counts
}

/// Running the whole fixture replay twice produces identical final DB state (idempotency, R6/R3).
#[sqlx::test(migrations = "src/db/migrations")]
async fn test_idempotent_full_replay(pool: PgPool) {
    // First pass.
    for e in script() {
        route(&pool, &e).await;
    }
    let after_first = table_counts(&pool).await;

    // Second pass — must not duplicate any row.
    for e in script() {
        route(&pool, &e).await;
    }
    let after_second = table_counts(&pool).await;

    assert_eq!(after_first, after_second, "replay is idempotent (no duplicate rows)");
    // Sanity on the expected magnitudes (order = COUNTED_TABLES): 1 asset, 3 contributions,
    // 4 position events (2 claims + 1 yield + 1 wrap), 3 tranche rows, 1 dispute, 2 votes,
    // 5 state changes (seed + 0→1 + 1→4 + 4→6 + 6→7), 1 governance event.
    assert_eq!(after_second, vec![1, 3, 4, 3, 1, 2, 5, 1], "final per-table counts");

    let final_state: (i16,) = sqlx::query_as("SELECT current_state FROM assets WHERE asset_id = $1")
        .bind("0xA")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(final_state.0, 7, "final state CLOSED after replay");
}
