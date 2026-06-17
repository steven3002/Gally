//! SQLx queries. BI-M1: cursor read/write and idempotent raw-event upsert.
//! BI-M2 adds the governance + asset-lifecycle write paths and the `/assets`/`/governance`
//! read paths (with keyset pagination, `backend.md §5.1.1`).

use anyhow::Result;
use serde_json::Value;
use sqlx::{PgPool, QueryBuilder};

use crate::db::models::{
    AssetRow, AssetStateChangeRow, DisputeRow, GovernanceRow, HolderFoldRow, HoldingRow,
    JuryVoteRow, PortfolioAssetSummary, PositionEventRow, RaiseProgressRow, RawEventRow,
    StakeEventRow, StatusChangeRow, TrancheRow, ValidatorPoolRow, ValidatorTrackRecord,
    WrapRatioRow, YieldIndexRow,
};
use crate::ingestion::event_types::{
    AssetCreatedEvent, AssetStateChangedEvent, AssetVouchedEvent, CapitalContributedEvent,
    DisputeOpenedEvent, DisputeResolvedEvent, JurorRewardClaimedEvent, JurorVotedEvent,
    RaiseFinalizedEvent, ValidatorRegisteredEvent,
};
use crate::ingestion::handlers::EventMeta;

/// Columns selected for every `AssetRow` read (order matches the struct).
const ASSET_COLS: &str = "asset_id, entity, goal, funding_deadline_ms, tranche_count, \
    revenue_split_bps, collateral, validator_pool_id, coverage, accumulator_id, \
    current_state, close_reason, created_at_ms, created_tx";

/// Read the singleton checkpoint cursor. Returns 0 on a fresh database (logic_flow.md §2.1).
pub async fn read_cursor(pool: &PgPool) -> Result<i64> {
    let row: Option<(i64,)> =
        sqlx::query_as("SELECT checkpoint_seq FROM indexer_cursor WHERE id = TRUE")
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|r| r.0).unwrap_or(0))
}

/// Read the persisted JSON-RPC backfill cursor (Sui EventID `{tx_digest, event_seq}`), if set.
pub async fn read_backfill_cursor(pool: &PgPool) -> Result<Option<(String, i32)>> {
    let row: Option<(Option<String>, Option<i32>)> = sqlx::query_as(
        "SELECT backfill_tx_digest, backfill_event_seq FROM indexer_cursor WHERE id = TRUE",
    )
    .fetch_optional(pool)
    .await?;
    Ok(match row {
        Some((Some(tx), Some(seq))) => Some((tx, seq)),
        _ => None,
    })
}

/// Persist the checkpoint cursor (singleton upsert). Leaves the backfill cursor untouched.
pub async fn write_cursor(pool: &PgPool, checkpoint_seq: i64) -> Result<()> {
    sqlx::query(
        "INSERT INTO indexer_cursor (id, checkpoint_seq, updated_at) VALUES (TRUE, $1, now()) \
         ON CONFLICT (id) DO UPDATE SET checkpoint_seq = EXCLUDED.checkpoint_seq, updated_at = now()",
    )
    .bind(checkpoint_seq)
    .execute(pool)
    .await?;
    Ok(())
}

/// Persist the JSON-RPC backfill cursor (Sui EventID) and the checkpoint high-watermark together.
pub async fn write_backfill_cursor(
    pool: &PgPool,
    checkpoint_seq: i64,
    tx_digest: &str,
    event_seq: i32,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO indexer_cursor \
            (id, checkpoint_seq, backfill_tx_digest, backfill_event_seq, updated_at) \
         VALUES (TRUE, $1, $2, $3, now()) \
         ON CONFLICT (id) DO UPDATE SET \
            checkpoint_seq = EXCLUDED.checkpoint_seq, \
            backfill_tx_digest = EXCLUDED.backfill_tx_digest, \
            backfill_event_seq = EXCLUDED.backfill_event_seq, \
            updated_at = now()",
    )
    .bind(checkpoint_seq)
    .bind(tx_digest)
    .bind(event_seq)
    .execute(pool)
    .await?;
    Ok(())
}

/// One event to archive in `raw_events`, keyed idempotently on `(tx_digest, event_seq)`.
pub struct RawEventInsert<'a> {
    pub tx_digest: &'a str,
    pub event_seq: i32,
    pub checkpoint_seq: i64,
    pub timestamp_ms: i64,
    pub event_type: &'a str,
    pub payload: &'a Value,
}

/// Idempotent insert. Returns `true` if a new row was inserted, `false` if it already existed.
pub async fn upsert_raw_event(pool: &PgPool, e: &RawEventInsert<'_>) -> Result<bool> {
    let payload_text = serde_json::to_string(e.payload)?;
    let res = sqlx::query(
        "INSERT INTO raw_events \
            (tx_digest, event_seq, checkpoint_seq, timestamp_ms, event_type, payload) \
         VALUES ($1, $2, $3, $4, $5, $6::jsonb) \
         ON CONFLICT (tx_digest, event_seq) DO NOTHING",
    )
    .bind(e.tx_digest)
    .bind(e.event_seq)
    .bind(e.checkpoint_seq)
    .bind(e.timestamp_ms)
    .bind(e.event_type)
    .bind(payload_text)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() == 1)
}

// ===========================================================================
// BI-M2 write paths — governance_events / assets / asset_state_changes
// ===========================================================================

/// All nullable columns of a `governance_events` row; the handler fills only the subset its
/// event subtype carries (`logic_flow.md §2.3`).
#[derive(Default)]
pub struct GovernanceInsert<'a> {
    pub event_type: &'a str,
    pub config_id: Option<&'a str>,
    pub admin: Option<&'a str>,
    pub param_name: Option<&'a str>,
    pub old_value: Option<i64>,
    pub new_value: Option<i64>,
    pub old_treasury: Option<&'a str>,
    pub new_treasury: Option<&'a str>,
}

/// Idempotent insert of one governance event (upsert on `(tx_digest, event_seq)`, R6).
pub async fn insert_governance_event(
    pool: &PgPool,
    meta: &EventMeta,
    g: &GovernanceInsert<'_>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO governance_events \
            (tx_digest, event_seq, checkpoint_seq, timestamp_ms, event_type, \
             config_id, admin, param_name, old_value, new_value, old_treasury, new_treasury) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) \
         ON CONFLICT (tx_digest, event_seq) DO NOTHING",
    )
    .bind(&meta.tx_digest)
    .bind(meta.event_seq)
    .bind(meta.checkpoint_seq)
    .bind(meta.timestamp_ms)
    .bind(g.event_type)
    .bind(g.config_id)
    .bind(g.admin)
    .bind(g.param_name)
    .bind(g.old_value)
    .bind(g.new_value)
    .bind(g.old_treasury)
    .bind(g.new_treasury)
    .execute(pool)
    .await?;
    Ok(())
}

/// Insert one `assets` row from `AssetCreatedEvent` (idempotent on `asset_id`). `current_state`
/// seeds to `0 PENDING_VOUCH`; the paired seed row in `asset_state_changes` is written by the
/// handler (`logic_flow.md §4`).
pub async fn insert_asset(pool: &PgPool, meta: &EventMeta, e: &AssetCreatedEvent) -> Result<()> {
    sqlx::query(
        "INSERT INTO assets \
            (asset_id, entity, goal, funding_deadline_ms, tranche_count, revenue_split_bps, \
             collateral, current_state, created_at_ms, created_tx) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9) \
         ON CONFLICT (asset_id) DO NOTHING",
    )
    .bind(&e.asset_id)
    .bind(&e.entity)
    .bind(e.funding_goal as i64)
    .bind(e.funding_deadline_ms as i64)
    .bind(e.tranche_count as i32)
    .bind(e.revenue_split_bps as i32)
    .bind(e.collateral as i64)
    .bind(meta.timestamp_ms)
    .bind(&meta.tx_digest)
    .execute(pool)
    .await?;
    Ok(())
}

/// Insert one `asset_state_changes` row (idempotent on `(tx_digest, event_seq)`). Used both for
/// the seed PENDING_VOUCH row at creation and for every later `AssetStateChangedEvent`.
pub async fn insert_state_change(
    pool: &PgPool,
    meta: &EventMeta,
    asset_id: &str,
    old_state: i16,
    new_state: i16,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO asset_state_changes \
            (tx_digest, event_seq, checkpoint_seq, timestamp_ms, asset_id, old_state, new_state) \
         VALUES ($1,$2,$3,$4,$5,$6,$7) \
         ON CONFLICT (tx_digest, event_seq) DO NOTHING",
    )
    .bind(&meta.tx_digest)
    .bind(meta.event_seq)
    .bind(meta.checkpoint_seq)
    .bind(meta.timestamp_ms)
    .bind(asset_id)
    .bind(old_state)
    .bind(new_state)
    .execute(pool)
    .await?;
    Ok(())
}

/// `AssetVouchedEvent`: set the asset's validator pool + coverage.
pub async fn update_asset_vouched(pool: &PgPool, e: &AssetVouchedEvent) -> Result<()> {
    sqlx::query("UPDATE assets SET validator_pool_id = $1, coverage = $2 WHERE asset_id = $3")
        .bind(&e.pool_id)
        .bind(e.coverage as i64)
        .bind(&e.asset_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// `AssetStateChangedEvent`: advance the asset's latest state.
pub async fn update_asset_state(pool: &PgPool, asset_id: &str, new_state: i16) -> Result<()> {
    sqlx::query("UPDATE assets SET current_state = $1 WHERE asset_id = $2")
        .bind(new_state)
        .bind(asset_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// `AssetClosedEvent`: record the close reason. Does **not** touch `current_state` — the move to
/// CLOSED arrives separately via `AssetStateChangedEvent` (`logic_flow.md §4`).
pub async fn update_asset_close_reason(pool: &PgPool, asset_id: &str, reason: i16) -> Result<()> {
    sqlx::query("UPDATE assets SET close_reason = $1 WHERE asset_id = $2")
        .bind(reason)
        .bind(asset_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// `RaiseFinalizedEvent` / `AssetOperationalEvent`: record the accumulator id (same column).
pub async fn update_asset_accumulator(
    pool: &PgPool,
    asset_id: &str,
    accumulator_id: &str,
) -> Result<()> {
    sqlx::query("UPDATE assets SET accumulator_id = $1 WHERE asset_id = $2")
        .bind(accumulator_id)
        .bind(asset_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Typed accessor for `RaiseFinalizedEvent` (keeps the handler one line).
pub async fn apply_raise_finalized(pool: &PgPool, e: &RaiseFinalizedEvent) -> Result<()> {
    update_asset_accumulator(pool, &e.asset_id, &e.accumulator_id).await
}

/// Typed accessor for `AssetStateChangedEvent`: write the timeline row and advance the latest
/// state in one place.
pub async fn apply_state_change(
    pool: &PgPool,
    meta: &EventMeta,
    e: &AssetStateChangedEvent,
) -> Result<()> {
    insert_state_change(pool, meta, &e.asset_id, e.old_state as i16, e.new_state as i16).await?;
    update_asset_state(pool, &e.asset_id, e.new_state as i16).await
}

// ===========================================================================
// BI-M2 read paths — keyset-paginated lists + single-asset lookup
// ===========================================================================

/// `GET /assets` — keyset-paginated list with optional `?state=` / `?entity=` filters. Fetches
/// `limit + 1` rows so the caller can compute `hasNextPage` (`backend.md §5.1.1`). Ordered by
/// `(created_at_ms, asset_id)`, which is also the keyset cursor.
pub async fn list_assets(
    pool: &PgPool,
    state: Option<i16>,
    entity: Option<&str>,
    cursor: Option<(i64, String)>,
    limit: i64,
) -> Result<Vec<AssetRow>> {
    let mut qb = QueryBuilder::new("SELECT ");
    qb.push(ASSET_COLS).push(" FROM assets WHERE TRUE");
    if let Some(s) = state {
        qb.push(" AND current_state = ").push_bind(s);
    }
    if let Some(e) = entity {
        qb.push(" AND entity = ").push_bind(e.to_string());
    }
    if let Some((ts, id)) = cursor {
        qb.push(" AND (created_at_ms, asset_id) > (")
            .push_bind(ts)
            .push(", ")
            .push_bind(id)
            .push(")");
    }
    qb.push(" ORDER BY created_at_ms ASC, asset_id ASC LIMIT ")
        .push_bind(limit + 1);
    Ok(qb.build_query_as::<AssetRow>().fetch_all(pool).await?)
}

/// `GET /assets/:asset_id` — single asset record (None if unknown).
pub async fn get_asset(pool: &PgPool, asset_id: &str) -> Result<Option<AssetRow>> {
    let sql = format!("SELECT {ASSET_COLS} FROM assets WHERE asset_id = $1");
    Ok(sqlx::query_as::<_, AssetRow>(&sql)
        .bind(asset_id)
        .fetch_optional(pool)
        .await?)
}

/// `GET /assets/:asset_id/history` — state transitions in ascending `(timestamp_ms, id)` order
/// (which is also the keyset cursor). Fetches `limit + 1` for `hasNextPage`.
pub async fn list_asset_history(
    pool: &PgPool,
    asset_id: &str,
    cursor: Option<(i64, i64)>,
    limit: i64,
) -> Result<Vec<AssetStateChangeRow>> {
    let mut qb = QueryBuilder::new(
        "SELECT id, timestamp_ms, old_state, new_state, tx_digest \
         FROM asset_state_changes WHERE asset_id = ",
    );
    qb.push_bind(asset_id.to_string());
    if let Some((ts, id)) = cursor {
        qb.push(" AND (timestamp_ms, id) > (")
            .push_bind(ts)
            .push(", ")
            .push_bind(id)
            .push(")");
    }
    qb.push(" ORDER BY timestamp_ms ASC, id ASC LIMIT ")
        .push_bind(limit + 1);
    Ok(qb
        .build_query_as::<AssetStateChangeRow>()
        .fetch_all(pool)
        .await?)
}

/// `GET /governance` — governance events in ascending `(timestamp_ms, id)` order with an
/// optional `?type=` filter. Fetches `limit + 1` for `hasNextPage`.
pub async fn list_governance(
    pool: &PgPool,
    type_filter: Option<&str>,
    cursor: Option<(i64, i64)>,
    limit: i64,
) -> Result<Vec<GovernanceRow>> {
    let mut qb = QueryBuilder::new(
        "SELECT id, timestamp_ms, event_type, tx_digest, config_id, admin, param_name, \
         old_value, new_value, old_treasury, new_treasury FROM governance_events WHERE TRUE",
    );
    if let Some(t) = type_filter {
        qb.push(" AND event_type = ").push_bind(t.to_string());
    }
    if let Some((ts, id)) = cursor {
        qb.push(" AND (timestamp_ms, id) > (")
            .push_bind(ts)
            .push(", ")
            .push_bind(id)
            .push(")");
    }
    qb.push(" ORDER BY timestamp_ms ASC, id ASC LIMIT ")
        .push_bind(limit + 1);
    Ok(qb.build_query_as::<GovernanceRow>().fetch_all(pool).await?)
}

// ===========================================================================
// BI-M3 write paths — validator registry + position ledger
// ===========================================================================

/// `ValidatorRegisteredEvent` → insert the pool row (idempotent on `pool_id`). The initial stake
/// is recorded as `initial_stake`; later deltas go to `validator_stake_events`.
pub async fn insert_validator_pool(
    pool: &PgPool,
    meta: &EventMeta,
    e: &ValidatorRegisteredEvent,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO validator_pools \
            (pool_id, validator, initial_stake, current_status, registered_at_ms, registered_tx) \
         VALUES ($1, $2, $3, 0, $4, $5) \
         ON CONFLICT (pool_id) DO NOTHING",
    )
    .bind(&e.pool_id)
    .bind(&e.validator)
    .bind(e.stake as i64)
    .bind(meta.timestamp_ms)
    .bind(&meta.tx_digest)
    .execute(pool)
    .await?;
    Ok(())
}

/// `StakeAddedEvent` / `StakeWithdrawnEvent` → one `validator_stake_events` row (idempotent on
/// `(tx_digest, event_seq)`). `event_type` is `'added'` or `'withdrawn'`.
pub async fn insert_stake_event(
    pool: &PgPool,
    meta: &EventMeta,
    pool_id: &str,
    event_type: &str,
    depositor: Option<&str>,
    amount: i64,
    stake_after: i64,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO validator_stake_events \
            (tx_digest, event_seq, checkpoint_seq, timestamp_ms, pool_id, event_type, \
             depositor, amount, stake_after) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) \
         ON CONFLICT (tx_digest, event_seq) DO NOTHING",
    )
    .bind(&meta.tx_digest)
    .bind(meta.event_seq)
    .bind(meta.checkpoint_seq)
    .bind(meta.timestamp_ms)
    .bind(pool_id)
    .bind(event_type)
    .bind(depositor)
    .bind(amount)
    .bind(stake_after)
    .execute(pool)
    .await?;
    Ok(())
}

/// `ValidatorStatusChangedEvent` → append the status-change row **and** advance
/// `validator_pools.current_status`.
pub async fn apply_status_change(
    pool: &PgPool,
    meta: &EventMeta,
    pool_id: &str,
    old_status: i16,
    new_status: i16,
    dispute_id: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO validator_status_changes \
            (tx_digest, event_seq, checkpoint_seq, timestamp_ms, pool_id, old_status, new_status, dispute_id) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) \
         ON CONFLICT (tx_digest, event_seq) DO NOTHING",
    )
    .bind(&meta.tx_digest)
    .bind(meta.event_seq)
    .bind(meta.checkpoint_seq)
    .bind(meta.timestamp_ms)
    .bind(pool_id)
    .bind(old_status)
    .bind(new_status)
    .bind(dispute_id)
    .execute(pool)
    .await?;
    sqlx::query("UPDATE validator_pools SET current_status = $1 WHERE pool_id = $2")
        .bind(new_status)
        .bind(pool_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// `CapitalContributedEvent` → one `raise_progress` row (idempotent on `(tx_digest, event_seq)`).
pub async fn insert_raise_progress(
    pool: &PgPool,
    meta: &EventMeta,
    e: &CapitalContributedEvent,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO raise_progress \
            (tx_digest, event_seq, checkpoint_seq, timestamp_ms, asset_id, contributor, amount, raised_after) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) \
         ON CONFLICT (tx_digest, event_seq) DO NOTHING",
    )
    .bind(&meta.tx_digest)
    .bind(meta.event_seq)
    .bind(meta.checkpoint_seq)
    .bind(meta.timestamp_ms)
    .bind(&e.asset_id)
    .bind(&e.contributor)
    .bind(e.amount as i64)
    .bind(e.raised_after as i64)
    .execute(pool)
    .await?;
    Ok(())
}

/// One `position_events` row; the handler fills only the fields its event subtype carries
/// (`§2.10`). `index_at_claim` (u128) is bound as text and cast `::numeric`.
#[derive(Default)]
pub struct PositionInsert<'a> {
    pub event_type: &'a str,
    pub asset_id: &'a str,
    pub actor: &'a str,
    pub amount: Option<i64>,
    pub share_object_id: Option<&'a str>,
    pub total_wrapped_after: Option<i64>,
    pub index_at_claim: Option<u128>,
}

/// Idempotent insert of one position-ledger event (upsert on `(tx_digest, event_seq)`, R6).
pub async fn insert_position_event(
    pool: &PgPool,
    meta: &EventMeta,
    p: &PositionInsert<'_>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO position_events \
            (tx_digest, event_seq, checkpoint_seq, timestamp_ms, event_type, asset_id, actor, \
             amount, share_object_id, total_wrapped_after, index_at_claim) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::numeric) \
         ON CONFLICT (tx_digest, event_seq) DO NOTHING",
    )
    .bind(&meta.tx_digest)
    .bind(meta.event_seq)
    .bind(meta.checkpoint_seq)
    .bind(meta.timestamp_ms)
    .bind(p.event_type)
    .bind(p.asset_id)
    .bind(p.actor)
    .bind(p.amount)
    .bind(p.share_object_id)
    .bind(p.total_wrapped_after)
    .bind(p.index_at_claim.map(|v| v.to_string()))
    .execute(pool)
    .await?;
    Ok(())
}

// ===========================================================================
// BI-M3 read paths — validators, raise-progress, portfolio, holders
// ===========================================================================

/// `GET /validators` — keyset-paginated pool list (ordered by `(registered_at_ms, pool_id)`) with
/// optional `?status=` / `?validator=` filters.
pub async fn list_validators(
    pool: &PgPool,
    status: Option<i16>,
    validator: Option<&str>,
    cursor: Option<(i64, String)>,
    limit: i64,
) -> Result<Vec<ValidatorPoolRow>> {
    let mut qb = QueryBuilder::new(
        "SELECT pool_id, validator, initial_stake, current_status, registered_at_ms \
         FROM validator_pools WHERE TRUE",
    );
    if let Some(s) = status {
        qb.push(" AND current_status = ").push_bind(s);
    }
    if let Some(v) = validator {
        qb.push(" AND validator = ").push_bind(v.to_string());
    }
    if let Some((ts, id)) = cursor {
        qb.push(" AND (registered_at_ms, pool_id) > (")
            .push_bind(ts)
            .push(", ")
            .push_bind(id)
            .push(")");
    }
    qb.push(" ORDER BY registered_at_ms ASC, pool_id ASC LIMIT ")
        .push_bind(limit + 1);
    Ok(qb.build_query_as::<ValidatorPoolRow>().fetch_all(pool).await?)
}

/// `GET /validators/:pool_id` — the pool record (None if unknown).
pub async fn get_validator_pool(pool: &PgPool, pool_id: &str) -> Result<Option<ValidatorPoolRow>> {
    Ok(sqlx::query_as::<_, ValidatorPoolRow>(
        "SELECT pool_id, validator, initial_stake, current_status, registered_at_ms \
         FROM validator_pools WHERE pool_id = $1",
    )
    .bind(pool_id)
    .fetch_optional(pool)
    .await?)
}

/// Recent stake events for one pool (ascending), capped at `limit`.
pub async fn list_stake_events(
    pool: &PgPool,
    pool_id: &str,
    limit: i64,
) -> Result<Vec<StakeEventRow>> {
    Ok(sqlx::query_as::<_, StakeEventRow>(
        "SELECT id, timestamp_ms, event_type, depositor, amount, stake_after, tx_digest \
         FROM validator_stake_events WHERE pool_id = $1 \
         ORDER BY timestamp_ms ASC, id ASC LIMIT $2",
    )
    .bind(pool_id)
    .bind(limit)
    .fetch_all(pool)
    .await?)
}

/// Status-change history for one pool (ascending), capped at `limit`.
pub async fn list_status_changes(
    pool: &PgPool,
    pool_id: &str,
    limit: i64,
) -> Result<Vec<StatusChangeRow>> {
    Ok(sqlx::query_as::<_, StatusChangeRow>(
        "SELECT id, timestamp_ms, old_status, new_status, dispute_id, tx_digest \
         FROM validator_status_changes WHERE pool_id = $1 \
         ORDER BY timestamp_ms ASC, id ASC LIMIT $2",
    )
    .bind(pool_id)
    .bind(limit)
    .fetch_all(pool)
    .await?)
}

/// `GET /assets/:id/raise-progress` — contribution series ascending by `(timestamp_ms, id)`.
pub async fn list_raise_progress(
    pool: &PgPool,
    asset_id: &str,
    cursor: Option<(i64, i64)>,
    limit: i64,
) -> Result<Vec<RaiseProgressRow>> {
    let mut qb = QueryBuilder::new(
        "SELECT id, timestamp_ms, contributor, amount, raised_after, tx_digest \
         FROM raise_progress WHERE asset_id = ",
    );
    qb.push_bind(asset_id.to_string());
    if let Some((ts, id)) = cursor {
        qb.push(" AND (timestamp_ms, id) > (")
            .push_bind(ts)
            .push(", ")
            .push_bind(id)
            .push(")");
    }
    qb.push(" ORDER BY timestamp_ms ASC, id ASC LIMIT ")
        .push_bind(limit + 1);
    Ok(qb.build_query_as::<RaiseProgressRow>().fetch_all(pool).await?)
}

/// `GET /portfolio/:address` — the actor's economic activity ascending by `(timestamp_ms,
/// tx_digest, event_seq)`, UNION-ing `position_events` with `raise_progress` so a pure contributor
/// (only `CapitalContributedEvent`) appears too (`m6.md`). Contributions are projected into the
/// §6.4 shape as `event_type = 'CapitalContributed'`, `actor = contributor`, with the deed/wrap-only
/// columns null. Optional `?asset_id=` / `?event_type=` filters apply to the merged feed. The
/// per-table `id` is not globally unique across the union, so the keyset is the Sui-unique
/// `(timestamp_ms, tx_digest, event_seq)`.
pub async fn list_portfolio(
    pool: &PgPool,
    actor: &str,
    asset_id: Option<&str>,
    event_type: Option<&str>,
    cursor: Option<(i64, String, i64)>,
    limit: i64,
) -> Result<Vec<PositionEventRow>> {
    let mut qb = QueryBuilder::new(
        "SELECT id, timestamp_ms, event_type, asset_id, actor, amount, share_object_id, \
           total_wrapped_after, index_at_claim, tx_digest, event_seq FROM ( \
           SELECT id, timestamp_ms, event_type, asset_id, actor, amount, share_object_id, \
             total_wrapped_after, index_at_claim::text AS index_at_claim, tx_digest, event_seq \
             FROM position_events WHERE actor = ",
    );
    qb.push_bind(actor.to_string());
    qb.push(
        " UNION ALL \
           SELECT id, timestamp_ms, 'CapitalContributed' AS event_type, asset_id, \
             contributor AS actor, amount, NULL AS share_object_id, NULL::bigint AS total_wrapped_after, \
             NULL::text AS index_at_claim, tx_digest, event_seq \
             FROM raise_progress WHERE contributor = ",
    );
    qb.push_bind(actor.to_string());
    qb.push(") u WHERE TRUE");
    if let Some(a) = asset_id {
        qb.push(" AND asset_id = ").push_bind(a.to_string());
    }
    if let Some(t) = event_type {
        qb.push(" AND event_type = ").push_bind(t.to_string());
    }
    if let Some((ts, tx, seq)) = cursor {
        qb.push(" AND (timestamp_ms, tx_digest, event_seq) > (")
            .push_bind(ts)
            .push(", ")
            .push_bind(tx)
            .push(", ")
            .push_bind(seq)
            .push(")");
    }
    qb.push(" ORDER BY timestamp_ms ASC, tx_digest ASC, event_seq ASC LIMIT ")
        .push_bind(limit + 1);
    Ok(qb.build_query_as::<PositionEventRow>().fetch_all(pool).await?)
}

/// `GET /portfolio/:address/assets` — per-asset activity summary (first/last seen + event count)
/// across `position_events` ∪ `raise_progress`, so a pure contributor is included (`m6.md`).
pub async fn list_portfolio_assets(
    pool: &PgPool,
    actor: &str,
) -> Result<Vec<PortfolioAssetSummary>> {
    Ok(sqlx::query_as::<_, PortfolioAssetSummary>(
        "SELECT asset_id, MIN(ts) AS first_seen_ms, MAX(ts) AS last_seen_ms, \
           COUNT(*)::bigint AS event_count FROM ( \
             SELECT asset_id, timestamp_ms AS ts FROM position_events WHERE actor = $1 \
             UNION ALL \
             SELECT asset_id, timestamp_ms AS ts FROM raise_progress WHERE contributor = $1 \
           ) u GROUP BY asset_id ORDER BY asset_id ASC",
    )
    .bind(actor)
    .fetch_all(pool)
    .await?)
}

/// `GET /address/:address` `holdings` — the §2.17 signed fold grouped by `asset_id` for one actor,
/// keyset-paginated by `asset_id` (the §6.7 holdings collection is paginated when large). Filtered
/// to live positions (`share_count + wrapped > 0`).
pub async fn list_address_holdings(
    pool: &PgPool,
    actor: &str,
    cursor: Option<String>,
    limit: i64,
) -> Result<Vec<HoldingRow>> {
    let mut qb = QueryBuilder::new(
        "SELECT asset_id, share_count, wrapped, yield_claimed_index FROM ( \
           SELECT asset_id, \
             COALESCE(SUM(CASE event_type WHEN 'SharesClaimed' THEN amount \
                                          WHEN 'SharesUnwrapped' THEN amount \
                                          WHEN 'SharesWrapped' THEN -amount \
                                          WHEN 'ShareRedeemed' THEN -amount ELSE 0 END), 0)::bigint AS share_count, \
             COALESCE(SUM(CASE event_type WHEN 'SharesWrapped' THEN amount \
                                          WHEN 'SharesUnwrapped' THEN -amount ELSE 0 END), 0)::bigint AS wrapped, \
             (array_agg(index_at_claim::text ORDER BY timestamp_ms DESC, id DESC) \
                FILTER (WHERE event_type = 'YieldClaimed'))[1] AS yield_claimed_index \
           FROM position_events WHERE actor = ",
    );
    qb.push_bind(actor.to_string());
    qb.push(" GROUP BY asset_id) h WHERE (h.share_count + h.wrapped) > 0");
    if let Some(asset_id) = cursor {
        qb.push(" AND h.asset_id > ").push_bind(asset_id);
    }
    qb.push(" ORDER BY h.asset_id ASC LIMIT ").push_bind(limit + 1);
    Ok(qb.build_query_as::<HoldingRow>().fetch_all(pool).await?)
}

/// `GET /address/:address` `roles` — the derived role set (`§6.7`; no role table). Each role is one
/// EXISTS/lookup; emitted in the §6.7 order: investor, entity, validator, challenger, admin,
/// treasury. `admin` = `ProtocolInitialized.admin`; `treasury` = latest
/// `ProtocolTreasuryChanged.new_treasury`.
pub async fn address_roles(pool: &PgPool, addr: &str) -> Result<Vec<String>> {
    let row: (bool, bool, bool, bool, bool, bool) = sqlx::query_as(
        "SELECT \
           (EXISTS(SELECT 1 FROM position_events WHERE actor = $1) \
             OR EXISTS(SELECT 1 FROM raise_progress WHERE contributor = $1)) AS investor, \
           EXISTS(SELECT 1 FROM assets WHERE entity = $1) AS entity, \
           EXISTS(SELECT 1 FROM validator_pools WHERE validator = $1) AS validator, \
           EXISTS(SELECT 1 FROM disputes WHERE challenger = $1) AS challenger, \
           EXISTS(SELECT 1 FROM governance_events \
                  WHERE event_type = 'ProtocolInitialized' AND admin = $1) AS admin, \
           COALESCE($1 = (SELECT new_treasury FROM governance_events \
                  WHERE event_type = 'ProtocolTreasuryChanged' \
                  ORDER BY timestamp_ms DESC, id DESC LIMIT 1), FALSE) AS treasury",
    )
    .bind(addr)
    .fetch_one(pool)
    .await?;
    let mut roles = Vec::new();
    let (investor, entity, validator, challenger, admin, treasury) = row;
    if investor {
        roles.push("investor".to_string());
    }
    if entity {
        roles.push("entity".to_string());
    }
    if validator {
        roles.push("validator".to_string());
    }
    if challenger {
        roles.push("challenger".to_string());
    }
    if admin {
        roles.push("admin".to_string());
    }
    if treasury {
        roles.push("treasury".to_string());
    }
    Ok(roles)
}

/// `GET /tx/:digest` — every archived event sharing `tx_digest`, ascending by `event_seq` (`§6.8`).
/// Reads `raw_events`; `payload` comes back as text and is re-parsed in the route.
pub async fn list_raw_events_by_tx(pool: &PgPool, tx_digest: &str) -> Result<Vec<RawEventRow>> {
    Ok(sqlx::query_as::<_, RawEventRow>(
        "SELECT event_seq, event_type, timestamp_ms, checkpoint_seq, payload::text AS payload \
         FROM raw_events WHERE tx_digest = $1 ORDER BY event_seq ASC",
    )
    .bind(tx_digest)
    .fetch_all(pool)
    .await?)
}

/// `GET /assets/:id/holders` — the per-actor signed fold over `position_events` (`§2.17`), ranked
/// by `holding` (= `share_count + wrapped`) DESC then `address` ASC, filtered to current holders
/// (`holding > 0`). Keyset cursor is `(holding, address)` in that DESC/ASC order. No table.
pub async fn list_holders(
    pool: &PgPool,
    asset_id: &str,
    cursor: Option<(i64, String)>,
    limit: i64,
) -> Result<Vec<HolderFoldRow>> {
    let mut qb = QueryBuilder::new(
        "SELECT address, share_count, wrapped, holding, acquired_at_ms, yield_claimed_index FROM ( \
           SELECT actor AS address, \
             COALESCE(SUM(CASE event_type WHEN 'SharesClaimed' THEN amount \
                                          WHEN 'SharesUnwrapped' THEN amount \
                                          WHEN 'SharesWrapped' THEN -amount \
                                          WHEN 'ShareRedeemed' THEN -amount ELSE 0 END), 0)::bigint AS share_count, \
             COALESCE(SUM(CASE event_type WHEN 'SharesWrapped' THEN amount \
                                          WHEN 'SharesUnwrapped' THEN -amount ELSE 0 END), 0)::bigint AS wrapped, \
             COALESCE(SUM(CASE event_type WHEN 'SharesClaimed' THEN amount \
                                          WHEN 'ShareRedeemed' THEN -amount ELSE 0 END), 0)::bigint AS holding, \
             MIN(CASE WHEN event_type IN ('SharesClaimed','SharesUnwrapped') THEN timestamp_ms END) AS acquired_at_ms, \
             (array_agg(index_at_claim::text ORDER BY timestamp_ms DESC, id DESC) \
                FILTER (WHERE event_type = 'YieldClaimed'))[1] AS yield_claimed_index \
           FROM position_events WHERE asset_id = ",
    );
    qb.push_bind(asset_id.to_string());
    qb.push(" GROUP BY actor) h WHERE h.holding > 0");
    if let Some((holding, address)) = cursor {
        // DESC(holding), ASC(address) keyset: strictly "after" the cursor row.
        qb.push(" AND (h.holding < ")
            .push_bind(holding)
            .push(" OR (h.holding = ")
            .push_bind(holding)
            .push(" AND h.address > ")
            .push_bind(address)
            .push("))");
    }
    qb.push(" ORDER BY h.holding DESC, h.address ASC LIMIT ")
        .push_bind(limit + 1);
    Ok(qb.build_query_as::<HolderFoldRow>().fetch_all(pool).await?)
}

/// `assets.goal` (== `total_minted_shares`, the holder `pct_of_supply` denominator, `§6.6`).
pub async fn asset_goal(pool: &PgPool, asset_id: &str) -> Result<Option<i64>> {
    let row: Option<(i64,)> = sqlx::query_as("SELECT goal FROM assets WHERE asset_id = $1")
        .bind(asset_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.0))
}

// ===========================================================================
// BI-M4 write paths — yield index / tranche / dispute feeds
// ===========================================================================

/// One `yield_index_series` row; the handler fills only the columns its subtype carries (`§2.11`).
/// `index_after` (u128) is bound as text and cast `::numeric`.
#[derive(Default)]
pub struct YieldIndexInsert<'a> {
    pub event_type: &'a str, // 'revenue' | 'rollover' | 'compensation'
    pub asset_id: &'a str,
    pub gross: Option<i64>,
    pub fee: Option<i64>,
    pub investor_portion: Option<i64>,
    pub entity_portion: Option<i64>,
    pub routed_to_rollover: Option<bool>,
    pub index_after: u128,
    pub unwrapped_supply: i64,
}

/// Idempotent insert of one yield-index event (upsert on `(tx_digest, event_seq)`, R6).
pub async fn insert_yield_index(
    pool: &PgPool,
    meta: &EventMeta,
    y: &YieldIndexInsert<'_>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO yield_index_series \
            (tx_digest, event_seq, checkpoint_seq, timestamp_ms, event_type, asset_id, \
             gross, fee, investor_portion, entity_portion, routed_to_rollover, \
             index_after, unwrapped_supply) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::numeric,$13) \
         ON CONFLICT (tx_digest, event_seq) DO NOTHING",
    )
    .bind(&meta.tx_digest)
    .bind(meta.event_seq)
    .bind(meta.checkpoint_seq)
    .bind(meta.timestamp_ms)
    .bind(y.event_type)
    .bind(y.asset_id)
    .bind(y.gross)
    .bind(y.fee)
    .bind(y.investor_portion)
    .bind(y.entity_portion)
    .bind(y.routed_to_rollover)
    .bind(y.index_after.to_string())
    .bind(y.unwrapped_supply)
    .execute(pool)
    .await?;
    Ok(())
}

/// `DustSweptEvent` → one `dust_sweeps` row (`§2.16`, idempotent on `(tx_digest, event_seq)`).
pub async fn insert_dust_sweep(
    pool: &PgPool,
    meta: &EventMeta,
    asset_id: &str,
    amount: i64,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO dust_sweeps \
            (tx_digest, event_seq, checkpoint_seq, timestamp_ms, asset_id, amount) \
         VALUES ($1,$2,$3,$4,$5,$6) \
         ON CONFLICT (tx_digest, event_seq) DO NOTHING",
    )
    .bind(&meta.tx_digest)
    .bind(meta.event_seq)
    .bind(meta.checkpoint_seq)
    .bind(meta.timestamp_ms)
    .bind(asset_id)
    .bind(amount)
    .execute(pool)
    .await?;
    Ok(())
}

/// One `tranche_events` row; the handler fills only the columns its subtype carries (`§2.12`).
#[derive(Default)]
pub struct TrancheInsert<'a> {
    pub event_type: &'a str, // 'proof_submitted' | 'approved' | 'released'
    pub asset_id: &'a str,
    pub tranche_index: i32,
    pub blob_id: Option<String>,
    pub sha256: Option<String>,
    pub validator: Option<&'a str>,
    pub pool_id: Option<&'a str>,
    pub amount: Option<i64>,
    pub escrow_after: Option<i64>,
}

/// Idempotent insert of one tranche event (upsert on `(tx_digest, event_seq)`, R6).
pub async fn insert_tranche_event(
    pool: &PgPool,
    meta: &EventMeta,
    t: &TrancheInsert<'_>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO tranche_events \
            (tx_digest, event_seq, checkpoint_seq, timestamp_ms, event_type, asset_id, \
             tranche_index, blob_id, sha256, validator, pool_id, amount, escrow_after) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) \
         ON CONFLICT (tx_digest, event_seq) DO NOTHING",
    )
    .bind(&meta.tx_digest)
    .bind(meta.event_seq)
    .bind(meta.checkpoint_seq)
    .bind(meta.timestamp_ms)
    .bind(t.event_type)
    .bind(t.asset_id)
    .bind(t.tranche_index)
    .bind(&t.blob_id)
    .bind(&t.sha256)
    .bind(t.validator)
    .bind(t.pool_id)
    .bind(t.amount)
    .bind(t.escrow_after)
    .execute(pool)
    .await?;
    Ok(())
}

/// `DisputeOpenedEvent` → insert the `disputes` row (idempotent on `dispute_id`). `evidence_sha256`
/// (`vector<u8>`) is hex-encoded into `evidence_hash`. Resolution columns stay NULL until resolved.
pub async fn insert_dispute_opened(
    pool: &PgPool,
    meta: &EventMeta,
    e: &DisputeOpenedEvent,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO disputes \
            (dispute_id, asset_id, target_pool_id, challenger, bond, evidence_hash, \
             opened_at_ms, opened_tx) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) \
         ON CONFLICT (dispute_id) DO NOTHING",
    )
    .bind(&e.dispute_id)
    .bind(&e.asset_id)
    .bind(&e.target_pool_id)
    .bind(&e.challenger)
    .bind(e.bond as i64)
    .bind(e.evidence_hex())
    .bind(meta.timestamp_ms)
    .bind(&meta.tx_digest)
    .execute(pool)
    .await?;
    Ok(())
}

/// `JurorVotedEvent` → one `jury_votes` row (`§2.14`, idempotent on `(tx_digest, event_seq)`).
pub async fn insert_jury_vote(pool: &PgPool, meta: &EventMeta, e: &JurorVotedEvent) -> Result<()> {
    sqlx::query(
        "INSERT INTO jury_votes \
            (tx_digest, event_seq, checkpoint_seq, timestamp_ms, dispute_id, juror_pool_id, \
             guilty, votes_guilty_after, votes_innocent_after) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) \
         ON CONFLICT (tx_digest, event_seq) DO NOTHING",
    )
    .bind(&meta.tx_digest)
    .bind(meta.event_seq)
    .bind(meta.checkpoint_seq)
    .bind(meta.timestamp_ms)
    .bind(&e.dispute_id)
    .bind(&e.juror_pool_id)
    .bind(e.guilty)
    .bind(e.votes_guilty_after as i32)
    .bind(e.votes_innocent_after as i32)
    .execute(pool)
    .await?;
    Ok(())
}

/// `DisputeResolvedEvent` → UPDATE the `disputes` row's resolution columns in place (the
/// denormalized dispute status: `verdict` / `slashed` / `bounty` / `resolved_at_ms` /
/// `resolved_tx`). Idempotent — keyed on `dispute_id`, last write wins.
pub async fn apply_dispute_resolved(
    pool: &PgPool,
    meta: &EventMeta,
    e: &DisputeResolvedEvent,
) -> Result<()> {
    sqlx::query(
        "UPDATE disputes SET verdict = $1, slashed = $2, bounty = $3, \
             resolved_at_ms = $4, resolved_tx = $5 WHERE dispute_id = $6",
    )
    .bind(e.verdict as i16)
    .bind(e.slashed as i64)
    .bind(e.bounty as i64)
    .bind(meta.timestamp_ms)
    .bind(&meta.tx_digest)
    .bind(&e.dispute_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// `JurorRewardClaimedEvent` → one `juror_rewards` row (`§2.15`, idempotent on `(tx_digest,
/// event_seq)`).
pub async fn insert_juror_reward(
    pool: &PgPool,
    meta: &EventMeta,
    e: &JurorRewardClaimedEvent,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO juror_rewards \
            (tx_digest, event_seq, checkpoint_seq, timestamp_ms, dispute_id, juror_pool_id, amount) \
         VALUES ($1,$2,$3,$4,$5,$6,$7) \
         ON CONFLICT (tx_digest, event_seq) DO NOTHING",
    )
    .bind(&meta.tx_digest)
    .bind(meta.event_seq)
    .bind(meta.checkpoint_seq)
    .bind(meta.timestamp_ms)
    .bind(&e.dispute_id)
    .bind(&e.juror_pool_id)
    .bind(e.amount as i64)
    .execute(pool)
    .await?;
    Ok(())
}

// ===========================================================================
// BI-M4 read paths — yield curve / wrap-ratio / tranches / disputes
// ===========================================================================

/// `GET /assets/:id/yield` — the index curve ascending by `(timestamp_ms, id)`. `index_after` is
/// read via `::text` (NUMERIC → string, full u128 precision).
pub async fn list_yield_index(
    pool: &PgPool,
    asset_id: &str,
    cursor: Option<(i64, i64)>,
    limit: i64,
) -> Result<Vec<YieldIndexRow>> {
    let mut qb = QueryBuilder::new(
        "SELECT id, timestamp_ms, event_type, gross, fee, investor_portion, entity_portion, \
         routed_to_rollover, index_after::text AS index_after, unwrapped_supply, tx_digest \
         FROM yield_index_series WHERE asset_id = ",
    );
    qb.push_bind(asset_id.to_string());
    if let Some((ts, id)) = cursor {
        qb.push(" AND (timestamp_ms, id) > (")
            .push_bind(ts)
            .push(", ")
            .push_bind(id)
            .push(")");
    }
    qb.push(" ORDER BY timestamp_ms ASC, id ASC LIMIT ")
        .push_bind(limit + 1);
    Ok(qb.build_query_as::<YieldIndexRow>().fetch_all(pool).await?)
}

/// `GET /assets/:id/wrap-ratio` — the `total_wrapped_after` series drawn from the wrap/unwrap
/// `position_events` rows (the only place that figure lives, `§2.10`), ascending by
/// `(timestamp_ms, id)`.
pub async fn list_wrap_ratio(
    pool: &PgPool,
    asset_id: &str,
    cursor: Option<(i64, i64)>,
    limit: i64,
) -> Result<Vec<WrapRatioRow>> {
    let mut qb = QueryBuilder::new(
        "SELECT id, timestamp_ms, event_type, total_wrapped_after, tx_digest \
         FROM position_events \
         WHERE event_type IN ('SharesWrapped','SharesUnwrapped') AND asset_id = ",
    );
    qb.push_bind(asset_id.to_string());
    if let Some((ts, id)) = cursor {
        qb.push(" AND (timestamp_ms, id) > (")
            .push_bind(ts)
            .push(", ")
            .push_bind(id)
            .push(")");
    }
    qb.push(" ORDER BY timestamp_ms ASC, id ASC LIMIT ")
        .push_bind(limit + 1);
    Ok(qb.build_query_as::<WrapRatioRow>().fetch_all(pool).await?)
}

/// `GET /assets/:id/tranches` — the milestone timeline ordered by `(tranche_index, id)`. `id`
/// (BIGSERIAL) increments in ingestion order, which is chronological (the sweep is ascending), so
/// `(tranche_index, id)` is equivalent to the spec's `(tranche_index, timestamp_ms)` ordering and
/// gives a stable, unique 2-component keyset. Cursor magnitude is `(tranche_index, id)`.
pub async fn list_tranches(
    pool: &PgPool,
    asset_id: &str,
    cursor: Option<(i64, i64)>,
    limit: i64,
) -> Result<Vec<TrancheRow>> {
    let mut qb = QueryBuilder::new(
        "SELECT id, timestamp_ms, event_type, tranche_index, blob_id, sha256, validator, \
         pool_id, amount, escrow_after, tx_digest FROM tranche_events WHERE asset_id = ",
    );
    qb.push_bind(asset_id.to_string());
    if let Some((tranche, id)) = cursor {
        qb.push(" AND (tranche_index > ")
            .push_bind(tranche as i32)
            .push(" OR (tranche_index = ")
            .push_bind(tranche as i32)
            .push(" AND id > ")
            .push_bind(id)
            .push("))");
    }
    qb.push(" ORDER BY tranche_index ASC, id ASC LIMIT ")
        .push_bind(limit + 1);
    Ok(qb.build_query_as::<TrancheRow>().fetch_all(pool).await?)
}

/// Shared SELECT for `disputes` rows + the running vote tallies (`MAX(votes_*_after)`, monotonic,
/// `§2.14`). `dispute_id` is the PK, so `GROUP BY` it lets every `d.*` column ride along.
const DISPUTE_SELECT: &str = "SELECT d.dispute_id, d.asset_id, d.target_pool_id, d.challenger, \
    d.bond, d.evidence_hash, d.opened_at_ms, d.resolved_at_ms, d.verdict, d.slashed, d.bounty, \
    COALESCE(MAX(jv.votes_guilty_after), 0)::int AS votes_guilty, \
    COALESCE(MAX(jv.votes_innocent_after), 0)::int AS votes_innocent, \
    COALESCE(MAX(jv.votes_guilty_after), 0)::int AS votes_guilty_after, \
    COALESCE(MAX(jv.votes_innocent_after), 0)::int AS votes_innocent_after \
    FROM disputes d LEFT JOIN jury_votes jv ON jv.dispute_id = d.dispute_id";

/// `GET /disputes` (and, with `asset_id` set, `GET /assets/:id/disputes`) — keyset-paginated
/// dispute list ordered by `(opened_at_ms, dispute_id)` with optional `?asset_id=` / `?verdict=` /
/// `?pool_id=` / `?challenger=` filters. Fetches `limit + 1` for `hasNextPage`.
pub async fn list_disputes(
    pool: &PgPool,
    asset_id: Option<&str>,
    verdict: Option<i16>,
    pool_id: Option<&str>,
    challenger: Option<&str>,
    cursor: Option<(i64, String)>,
    limit: i64,
) -> Result<Vec<DisputeRow>> {
    let mut qb = QueryBuilder::new(DISPUTE_SELECT);
    qb.push(" WHERE TRUE");
    if let Some(a) = asset_id {
        qb.push(" AND d.asset_id = ").push_bind(a.to_string());
    }
    if let Some(v) = verdict {
        qb.push(" AND d.verdict = ").push_bind(v);
    }
    if let Some(p) = pool_id {
        qb.push(" AND d.target_pool_id = ").push_bind(p.to_string());
    }
    if let Some(c) = challenger {
        qb.push(" AND d.challenger = ").push_bind(c.to_string());
    }
    if let Some((ts, id)) = cursor {
        qb.push(" AND (d.opened_at_ms, d.dispute_id) > (")
            .push_bind(ts)
            .push(", ")
            .push_bind(id)
            .push(")");
    }
    qb.push(" GROUP BY d.dispute_id ORDER BY d.opened_at_ms ASC, d.dispute_id ASC LIMIT ")
        .push_bind(limit + 1);
    Ok(qb.build_query_as::<DisputeRow>().fetch_all(pool).await?)
}

/// `GET /disputes/:dispute_id` — the dispute row + vote tallies (None if unknown).
pub async fn get_dispute(pool: &PgPool, dispute_id: &str) -> Result<Option<DisputeRow>> {
    let sql = format!("{DISPUTE_SELECT} WHERE d.dispute_id = $1 GROUP BY d.dispute_id");
    Ok(sqlx::query_as::<_, DisputeRow>(&sql)
        .bind(dispute_id)
        .fetch_optional(pool)
        .await?)
}

/// `GET /validators/:pool_id` track record (`m5.md`) — five DB-derived counts in one round-trip
/// (`$1` = pool_id, reused). All `count(*)` columns come back as `BIGINT` (i64). No object reads.
pub async fn validator_track_record(pool: &PgPool, pool_id: &str) -> Result<ValidatorTrackRecord> {
    Ok(sqlx::query_as::<_, ValidatorTrackRecord>(
        "SELECT \
           (SELECT count(*) FROM assets WHERE validator_pool_id = $1) AS assets_vouched, \
           (SELECT count(*) FROM tranche_events WHERE event_type = 'approved' AND pool_id = $1) \
             AS milestones_approved, \
           (SELECT count(*) FROM assets WHERE validator_pool_id = $1 AND current_state = 6) \
             AS assets_defaulted, \
           (SELECT count(*) FROM disputes WHERE target_pool_id = $1) AS disputes_filed_against, \
           (SELECT count(*) FROM disputes WHERE target_pool_id = $1 AND verdict = 1) \
             AS disputes_upheld",
    )
    .bind(pool_id)
    .fetch_one(pool)
    .await?)
}

/// All `jury_votes` for one dispute, ascending by `(timestamp_ms, id)`, capped at `limit`.
pub async fn list_jury_votes(
    pool: &PgPool,
    dispute_id: &str,
    limit: i64,
) -> Result<Vec<JuryVoteRow>> {
    Ok(sqlx::query_as::<_, JuryVoteRow>(
        "SELECT id, timestamp_ms, juror_pool_id, guilty, votes_guilty_after, \
         votes_innocent_after, tx_digest FROM jury_votes WHERE dispute_id = $1 \
         ORDER BY timestamp_ms ASC, id ASC LIMIT $2",
    )
    .bind(dispute_id)
    .bind(limit)
    .fetch_all(pool)
    .await?)
}
