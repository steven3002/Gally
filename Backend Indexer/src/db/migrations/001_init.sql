-- BI-M1: ingestion cursor + raw-event archive (logic_flow.md §2.1, §2.2).
-- Migrations are append-only; later milestones add the typed feed tables.

-- §2.1 indexer_cursor — checkpoint progress (singleton row).
-- checkpoint_seq        : live/gRPC resume point (last fully-committed checkpoint).
-- backfill_tx_digest /  : JSON-RPC backfill resume point — the Sui EventID of the last
-- backfill_event_seq      event consumed from suix_queryEvents, so a crash mid-page resumes
--                         from the NEXT event instead of restarting the query. NULL once
--                         catchup reaches the live checkpoint stream.
CREATE TABLE indexer_cursor (
    id                  BOOLEAN PRIMARY KEY DEFAULT TRUE,
    checkpoint_seq      BIGINT  NOT NULL DEFAULT 0,
    backfill_tx_digest  TEXT,
    backfill_event_seq  INT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- §2.2 raw_events — catch-all archive (every event, before type-specific processing).
-- Idempotency key is (tx_digest, event_seq) — Sui's globally unique event identity.
CREATE TABLE raw_events (
    id              BIGSERIAL PRIMARY KEY,
    tx_digest       TEXT    NOT NULL,
    event_seq       INT     NOT NULL,
    checkpoint_seq  BIGINT  NOT NULL,
    timestamp_ms    BIGINT  NOT NULL,
    event_type      TEXT    NOT NULL,
    payload         JSONB   NOT NULL,
    UNIQUE (tx_digest, event_seq)
);
CREATE INDEX raw_events_type ON raw_events (event_type);
CREATE INDEX raw_events_checkpoint ON raw_events (checkpoint_seq);
