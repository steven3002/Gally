-- BI-M2: governance + asset-lifecycle feed tables (logic_flow.md §2.3, §2.4, §2.5).
-- Migrations are append-only; later milestones add the remaining typed feed tables.

-- §2.3 governance_events — protocol parameter / pause log.
-- Feeds: ProtocolInitialized, ProtocolParamChanged, ProtocolTreasuryChanged,
--        EmergencyStopTriggered, ProtocolResumed. Columns are nullable per subtype.
CREATE TABLE governance_events (
    id              BIGSERIAL PRIMARY KEY,
    tx_digest       TEXT    NOT NULL,
    event_seq       INT     NOT NULL,
    checkpoint_seq  BIGINT  NOT NULL,
    timestamp_ms    BIGINT  NOT NULL,
    event_type      TEXT    NOT NULL,
    -- ProtocolInitialized
    config_id       TEXT,
    admin           TEXT,
    -- ProtocolParamChanged
    param_name      TEXT,
    old_value       BIGINT,
    new_value       BIGINT,
    -- ProtocolTreasuryChanged
    old_treasury    TEXT,
    new_treasury    TEXT,
    UNIQUE (tx_digest, event_seq)
);
CREATE INDEX governance_events_type ON governance_events (event_type);
CREATE INDEX governance_events_ts   ON governance_events (timestamp_ms);

-- §2.4 assets — one row per project (from AssetCreatedEvent). Not a replicated object:
-- stores the static config emitted at creation plus the latest known state. The `goal`
-- column is populated from AssetCreatedEvent.funding_goal; `close_reason` from
-- AssetClosedEvent.reason (u8: 1 return-target | 2 compensation | 3 wind-down).
CREATE TABLE assets (
    asset_id                TEXT    PRIMARY KEY,
    entity                  TEXT    NOT NULL,
    goal                    BIGINT  NOT NULL,   -- from AssetCreatedEvent.funding_goal
    funding_deadline_ms     BIGINT  NOT NULL,
    tranche_count           INT     NOT NULL,
    revenue_split_bps       INT     NOT NULL,
    collateral              BIGINT  NOT NULL,
    -- set at AssetVouched
    validator_pool_id       TEXT,
    coverage                BIGINT,
    -- set at RaiseFinalized / AssetOperational
    accumulator_id          TEXT,
    -- latest state (updated by asset_state_changes); see §11 for state values
    current_state           SMALLINT NOT NULL DEFAULT 0,
    -- set at AssetClosed
    close_reason            SMALLINT,           -- u8: 1 return-target | 2 compensation | 3 wind-down
    -- set at AssetCreated
    created_at_ms           BIGINT  NOT NULL,
    created_tx              TEXT    NOT NULL
);
CREATE INDEX assets_entity ON assets (entity);
CREATE INDEX assets_state  ON assets (current_state);
CREATE INDEX assets_created ON assets (created_at_ms, asset_id);

-- §2.5 asset_state_changes — full lifecycle timeline (feeds AssetStateChangedEvent).
-- The initial PENDING_VOUCH=0 row is seeded by handle_asset_created (create_asset emits
-- no paired state-change event); every later transition is one row here.
CREATE TABLE asset_state_changes (
    id              BIGSERIAL PRIMARY KEY,
    tx_digest       TEXT    NOT NULL,
    event_seq       INT     NOT NULL,
    checkpoint_seq  BIGINT  NOT NULL,
    timestamp_ms    BIGINT  NOT NULL,
    asset_id        TEXT    NOT NULL REFERENCES assets (asset_id),
    old_state       SMALLINT NOT NULL,
    new_state       SMALLINT NOT NULL,
    UNIQUE (tx_digest, event_seq)
);
CREATE INDEX asc_asset ON asset_state_changes (asset_id, timestamp_ms);
