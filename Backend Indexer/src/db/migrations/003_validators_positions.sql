-- BI-M3: validator registry + position-ledger feed tables (logic_flow.md §2.6–2.10).
-- Migrations are append-only.

-- §2.7 validator_pools — one row per pool (from ValidatorRegisteredEvent). The initial stake is
-- recorded here; subsequent deltas live in validator_stake_events (no denormalized current-stake
-- column — the pool object is the source of truth, §2.8 note).
CREATE TABLE validator_pools (
    pool_id             TEXT    PRIMARY KEY,
    validator           TEXT    NOT NULL,
    initial_stake       BIGINT  NOT NULL,
    current_status      SMALLINT NOT NULL DEFAULT 0,   -- 0 ACTIVE | 1 FROZEN | 2 SLASHED
    registered_at_ms    BIGINT  NOT NULL,
    registered_tx       TEXT    NOT NULL
);
CREATE INDEX vp_validator ON validator_pools (validator);

-- §2.8 validator_stake_events — stake time-series (StakeAddedEvent / StakeWithdrawnEvent).
CREATE TABLE validator_stake_events (
    id              BIGSERIAL PRIMARY KEY,
    tx_digest       TEXT    NOT NULL,
    event_seq       INT     NOT NULL,
    checkpoint_seq  BIGINT  NOT NULL,
    timestamp_ms    BIGINT  NOT NULL,
    pool_id         TEXT    NOT NULL REFERENCES validator_pools (pool_id),
    event_type      TEXT    NOT NULL,   -- 'added' | 'withdrawn'
    depositor       TEXT,               -- StakeAdded: depositor (may differ from validator); StakeWithdrawn: validator
    amount          BIGINT  NOT NULL,
    stake_after     BIGINT  NOT NULL,
    UNIQUE (tx_digest, event_seq)
);
CREATE INDEX vse_pool ON validator_stake_events (pool_id, timestamp_ms);

-- §2.9 validator_status_changes (ValidatorStatusChangedEvent).
CREATE TABLE validator_status_changes (
    id              BIGSERIAL PRIMARY KEY,
    tx_digest       TEXT    NOT NULL,
    event_seq       INT     NOT NULL,
    checkpoint_seq  BIGINT  NOT NULL,
    timestamp_ms    BIGINT  NOT NULL,
    pool_id         TEXT    NOT NULL REFERENCES validator_pools (pool_id),
    old_status      SMALLINT NOT NULL,
    new_status      SMALLINT NOT NULL,
    dispute_id      TEXT,               -- nullable; set for FROZEN/SLASHED transitions
    UNIQUE (tx_digest, event_seq)
);
CREATE INDEX vsc_pool ON validator_status_changes (pool_id, timestamp_ms);

-- §2.6 raise_progress — funding raise time-series (CapitalContributedEvent).
CREATE TABLE raise_progress (
    id              BIGSERIAL PRIMARY KEY,
    tx_digest       TEXT    NOT NULL,
    event_seq       INT     NOT NULL,
    checkpoint_seq  BIGINT  NOT NULL,
    timestamp_ms    BIGINT  NOT NULL,
    asset_id        TEXT    NOT NULL REFERENCES assets (asset_id),
    contributor     TEXT    NOT NULL,
    amount          BIGINT  NOT NULL,
    raised_after    BIGINT  NOT NULL,
    UNIQUE (tx_digest, event_seq)
);
CREATE INDEX rp_asset ON raise_progress (asset_id, timestamp_ms);
CREATE INDEX rp_contributor ON raise_progress (contributor);

-- §2.10 position_events — per-user cross-asset activity ledger. One row per event. `actor` is
-- always the economically relevant address (holder / contributor, spec P4). `amount` is a USDC
-- amount or a share count depending on event_type. `index_at_claim` is a u128 (NUMERIC(39,0)).
CREATE TABLE position_events (
    id                  BIGSERIAL PRIMARY KEY,
    tx_digest           TEXT    NOT NULL,
    event_seq           INT     NOT NULL,
    checkpoint_seq      BIGINT  NOT NULL,
    timestamp_ms        BIGINT  NOT NULL,
    event_type          TEXT    NOT NULL,
    asset_id            TEXT    NOT NULL REFERENCES assets (asset_id),
    actor               TEXT    NOT NULL,   -- holder / contributor (per P4)
    amount              BIGINT,             -- USDC or share count depending on event_type
    share_object_id     TEXT,               -- set for SharesClaimed, SharesUnwrapped
    total_wrapped_after BIGINT,             -- set for SharesWrapped, SharesUnwrapped
    index_at_claim      NUMERIC(39,0),      -- set for YieldClaimed (u128, ×1e9 scaled)
    UNIQUE (tx_digest, event_seq)
);
CREATE INDEX pe_actor       ON position_events (actor, timestamp_ms);
CREATE INDEX pe_asset       ON position_events (asset_id, timestamp_ms);
CREATE INDEX pe_actor_asset ON position_events (actor, asset_id);
