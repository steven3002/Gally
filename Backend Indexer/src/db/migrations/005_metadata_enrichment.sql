-- BI-M8: on-chain metadata + event enrichment (Live-Data Parity, data_parity_plan.md §6).
-- Re-derived from the SHIPPED gally_core M8 Move source (guard rail R0/R1 — the struct wins),
-- NOT from the plan's §5.3 draft (which mis-listed RevenueDeposited's `*_after` set; see logic_flow.md §10.1).
-- Migrations are append-only. All additive columns are NULLable so the BI-M7 fixtures (which omit
-- the M8 fields) and any pre-M8 rows remain valid.

-- §2.4 assets — inline immutable metadata set at AssetCreated (LI-D2/D3/D5/D12). Text fields are the
-- UTF-8 decode of the on-chain vector<u8> (R2a); category is the LI-D4 u8 enum (§11.6); blob/sha are
-- the hex-encoded WalrusRef bytes (the rich-content pointer, fetched off the indexer at FE-M8).
ALTER TABLE assets
    ADD COLUMN name                TEXT,
    ADD COLUMN ticker              TEXT,
    ADD COLUMN category            SMALLINT,        -- LI-D4: 0..5; out-of-range ⇒ "Other" (frontend)
    ADD COLUMN location            TEXT,
    ADD COLUMN entity_name         TEXT,
    ADD COLUMN metadata_blob_id    TEXT,            -- WalrusRef.blob_id (vector<u8> → hex)
    ADD COLUMN metadata_sha256     TEXT,            -- WalrusRef.sha256  (vector<u8> → hex)
    ADD COLUMN is_term_financing   BOOLEAN NOT NULL DEFAULT FALSE,   -- LI-D12
    ADD COLUMN return_target       BIGINT;          -- LI-D12 (μUSDC; NULL for open-ended raises)
CREATE INDEX assets_category ON assets (category);

-- §2.18 tranche_schedule — the FULL declared schedule emitted in AssetCreatedEvent's parallel
-- vectors (LI-D8/LI-Q1), one row per tranche index. This is what lets /assets/:id/tranches expose
-- UNRELEASED tranches; the proof/approve/release timeline still lives in tranche_events (§2.12).
-- amount/deadline_ms are u64 (BIGINT); description is the UTF-8 decode of vector<u8> (R2a). Keyed by
-- (asset_id, tranche_index) so the AssetCreated replay is idempotent without a (tx,seq) key.
CREATE TABLE tranche_schedule (
    asset_id        TEXT    NOT NULL REFERENCES assets (asset_id),
    tranche_index   INT     NOT NULL,
    amount          BIGINT  NOT NULL,
    deadline_ms     BIGINT  NOT NULL,
    description     TEXT,
    PRIMARY KEY (asset_id, tranche_index)
);

-- §2.7 validator_pools — self-asserted display name (LI-D6), UTF-8 decode of vector<u8>.
ALTER TABLE validator_pools
    ADD COLUMN name TEXT;

-- §2.13 disputes — challenger's short claim (LI-D7), UTF-8 decode of vector<u8>.
ALTER TABLE disputes
    ADD COLUMN reason TEXT;

-- §2.19 accumulator_balances — event-sourced pool-balance log folded from the `*_after` fields the
-- accumulator-mutating events now carry (LI-D9). One row per event; each row fills only the columns
-- its event emits (the rest stay NULL):
--   RevenueDeposited [asset]      → reward_pool_after, rollover_reserve_after
--   YieldClaimed     [accumulator]→ reward_pool_after
--   RolloverSwept    [accumulator]→ reward_pool_after, rollover_reserve_after
--   CompensationSwept[accumulator]→ reward_pool_after, rollover_reserve_after, compensation_pool_after, wrapping_frozen
--   DustSwept        [accumulator]→ reward_pool_after, rollover_reserve_after
--   EntityDefaulted  [asset]      → compensation_pool_after, compensation_unlock_ms, wrapping_frozen
--   DisputeResolved  [dispute]    → compensation_pool_after, compensation_unlock_ms, wrapping_frozen
-- The "current balances" view (queries::current_accumulator_balances) takes, per column, the value
-- from the chronologically latest row where that column IS NOT NULL — order-robust across modules
-- (uses timestamp_ms, not ingestion order). Idempotent on (tx_digest, event_seq) (R6).
CREATE TABLE accumulator_balances (
    id                      BIGSERIAL PRIMARY KEY,
    tx_digest               TEXT    NOT NULL,
    event_seq               INT     NOT NULL,
    checkpoint_seq          BIGINT  NOT NULL,
    timestamp_ms            BIGINT  NOT NULL,
    asset_id                TEXT    NOT NULL REFERENCES assets (asset_id),
    event_type              TEXT    NOT NULL,   -- the emitting event's short name
    reward_pool_after       BIGINT,
    rollover_reserve_after  BIGINT,
    compensation_pool_after BIGINT,
    compensation_unlock_ms  BIGINT,
    wrapping_frozen         BOOLEAN,
    UNIQUE (tx_digest, event_seq)
);
CREATE INDEX ab_asset ON accumulator_balances (asset_id, timestamp_ms);
