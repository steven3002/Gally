-- BI-M4: yield-index / tranche / dispute feed tables (logic_flow.md §2.11–2.16).
-- Migrations are append-only.

-- §2.11 yield_index_series — APY / index curve (RevenueDepositedEvent [asset module],
-- RolloverSweptEvent, CompensationSweptEvent [accumulator module]). The revenue-only split
-- columns (gross/fee/investor_portion/entity_portion) are NULL for rollover/compensation rows;
-- routed_to_rollover is set only by CompensationSweptEvent. index_after is the running cumulative
-- index (u128, ×1e9 scaled) AFTER this event — there is no denormalized index column on `assets`
-- (the curve IS the time-series; the live value lives on the on-chain accumulator object).
-- NOTE: RolloverSwept/CompensationSwept carry an `amount` that the §2.11 schema deliberately does
-- not materialize here (it is retained in raw_events); only index_after/unwrapped_supply are kept.
CREATE TABLE yield_index_series (
    id                  BIGSERIAL PRIMARY KEY,
    tx_digest           TEXT    NOT NULL,
    event_seq           INT     NOT NULL,
    checkpoint_seq      BIGINT  NOT NULL,
    timestamp_ms        BIGINT  NOT NULL,
    event_type          TEXT    NOT NULL,   -- 'revenue' | 'rollover' | 'compensation'
    asset_id            TEXT    NOT NULL REFERENCES assets (asset_id),
    -- revenue event fields (RevenueDepositedEvent only)
    gross               BIGINT,
    fee                 BIGINT,
    investor_portion    BIGINT,
    entity_portion      BIGINT,
    -- compensation event only (CompensationSweptEvent.routed_to_rollover)
    routed_to_rollover  BOOLEAN,
    -- common to all three
    index_after         NUMERIC(39,0) NOT NULL,
    unwrapped_supply    BIGINT  NOT NULL,
    UNIQUE (tx_digest, event_seq)
);
CREATE INDEX yis_asset ON yield_index_series (asset_id, timestamp_ms);

-- §2.12 tranche_events — milestone / tranche timeline (MilestoneProofSubmittedEvent,
-- MilestoneApprovedEvent, TrancheReleasedEvent). blob_id/sha256 are the two vector<u8> hashes
-- hex-encoded (proof_submitted); validator/pool_id are set on approval; amount/escrow_after on
-- release. tranche_index is the (u64) tranche number cast to INT.
CREATE TABLE tranche_events (
    id              BIGSERIAL PRIMARY KEY,
    tx_digest       TEXT    NOT NULL,
    event_seq       INT     NOT NULL,
    checkpoint_seq  BIGINT  NOT NULL,
    timestamp_ms    BIGINT  NOT NULL,
    event_type      TEXT    NOT NULL,   -- 'proof_submitted' | 'approved' | 'released'
    asset_id        TEXT    NOT NULL REFERENCES assets (asset_id),
    tranche_index   INT     NOT NULL,
    -- proof_submitted
    blob_id         TEXT,
    sha256          TEXT,
    -- approved
    validator       TEXT,
    pool_id         TEXT,
    -- released
    amount          BIGINT,
    escrow_after    BIGINT,
    UNIQUE (tx_digest, event_seq)
);
CREATE INDEX te_asset ON tranche_events (asset_id, tranche_index);

-- §2.13 disputes — dispute lifecycle. One row per dispute, keyed by dispute_id (DisputeOpenedEvent
-- inserts; DisputeResolvedEvent updates the resolution columns in place — the denormalized
-- dispute status). evidence_hash is DisputeOpenedEvent.evidence_sha256 (vector<u8> → hex).
CREATE TABLE disputes (
    dispute_id          TEXT    PRIMARY KEY,
    asset_id            TEXT    NOT NULL REFERENCES assets (asset_id),
    target_pool_id      TEXT    NOT NULL REFERENCES validator_pools (pool_id),
    challenger          TEXT    NOT NULL,
    bond                BIGINT  NOT NULL,
    evidence_hash       TEXT    NOT NULL,   -- from DisputeOpenedEvent.evidence_sha256 (vector<u8> → hex)
    opened_at_ms        BIGINT  NOT NULL,
    opened_tx           TEXT    NOT NULL,
    -- set on resolution
    resolved_at_ms      BIGINT,
    verdict             SMALLINT,           -- NULL while open; 1 UPHELD | 2 REJECTED | 3 EXPIRED
    slashed             BIGINT,
    bounty              BIGINT,
    resolved_tx         TEXT
);
CREATE INDEX disputes_asset  ON disputes (asset_id);
CREATE INDEX disputes_pool   ON disputes (target_pool_id);
CREATE INDEX disputes_status ON disputes (verdict);

-- §2.14 jury_votes — per-juror vote log (JurorVotedEvent). votes_*_after are the running tallies
-- after this vote (monotonic), so MAX() gives the final tally for the dispute item shape (§6.5).
CREATE TABLE jury_votes (
    id                      BIGSERIAL PRIMARY KEY,
    tx_digest               TEXT    NOT NULL,
    event_seq               INT     NOT NULL,
    checkpoint_seq          BIGINT  NOT NULL,
    timestamp_ms            BIGINT  NOT NULL,
    dispute_id              TEXT    NOT NULL REFERENCES disputes (dispute_id),
    juror_pool_id           TEXT    NOT NULL,
    guilty                  BOOLEAN NOT NULL,
    votes_guilty_after      INT     NOT NULL,
    votes_innocent_after    INT     NOT NULL,
    UNIQUE (tx_digest, event_seq)
);
CREATE INDEX jv_dispute ON jury_votes (dispute_id);

-- §2.15 juror_rewards — juror reward claims on REJECTED disputes (JurorRewardClaimedEvent,
-- dispute module). Code-only event, not in protocol_flow.md §18.3 (§10.1).
CREATE TABLE juror_rewards (
    id                      BIGSERIAL PRIMARY KEY,
    tx_digest               TEXT    NOT NULL,
    event_seq               INT     NOT NULL,
    checkpoint_seq          BIGINT  NOT NULL,
    timestamp_ms            BIGINT  NOT NULL,
    dispute_id              TEXT    NOT NULL REFERENCES disputes (dispute_id),
    juror_pool_id           TEXT    NOT NULL,
    amount                  BIGINT  NOT NULL,
    UNIQUE (tx_digest, event_seq)
);
CREATE INDEX jr_dispute ON juror_rewards (dispute_id);
CREATE INDEX jr_pool ON juror_rewards (juror_pool_id);

-- §2.16 dust_sweeps — terminal dust reclaim (DustSweptEvent, accumulator module). Code-only event,
-- not in protocol_flow.md §18.3 (§10.1).
CREATE TABLE dust_sweeps (
    id                      BIGSERIAL PRIMARY KEY,
    tx_digest               TEXT    NOT NULL,
    event_seq               INT     NOT NULL,
    checkpoint_seq          BIGINT  NOT NULL,
    timestamp_ms            BIGINT  NOT NULL,
    asset_id                TEXT    NOT NULL REFERENCES assets (asset_id),
    amount                  BIGINT  NOT NULL,
    UNIQUE (tx_digest, event_seq)
);
CREATE INDEX ds_asset ON dust_sweeps (asset_id);
