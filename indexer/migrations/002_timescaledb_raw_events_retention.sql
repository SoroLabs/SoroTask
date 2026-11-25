-- Migration: 002_timescaledb_raw_events_retention
-- TimescaleDB hypertable partitioning and compression for raw contract events.
-- Apply after 001_initial_schema.sql on PostgreSQL with TimescaleDB enabled.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- The events table from 001 stores raw execution event payloads.
DO $$
BEGIN
    IF to_regclass('public.events') IS NOT NULL
       AND to_regclass('public.raw_events') IS NULL THEN
        ALTER TABLE events RENAME TO raw_events;
    END IF;
END $$;

ALTER TABLE raw_events
    ADD COLUMN IF NOT EXISTS ledger_timestamp TIMESTAMPTZ;

UPDATE raw_events
SET ledger_timestamp = processed_at
WHERE ledger_timestamp IS NULL;

ALTER TABLE raw_events
    ALTER COLUMN ledger_timestamp SET DEFAULT NOW(),
    ALTER COLUMN ledger_timestamp SET NOT NULL;

-- TimescaleDB requires unique constraints to include the partitioning column.
ALTER TABLE raw_events DROP CONSTRAINT IF EXISTS events_pkey;
ALTER TABLE raw_events DROP CONSTRAINT IF EXISTS raw_events_pkey;
ALTER TABLE raw_events DROP CONSTRAINT IF EXISTS events_ledger_sequence_contract_id_event_name_task_id_key;
ALTER TABLE raw_events DROP CONSTRAINT IF EXISTS raw_events_ledger_sequence_contract_id_event_name_task_id_key;
ALTER TABLE raw_events DROP CONSTRAINT IF EXISTS raw_events_dedup_key;

ALTER TABLE raw_events
    ADD CONSTRAINT raw_events_dedup_key
        UNIQUE (ledger_timestamp, ledger_sequence, contract_id, event_name, task_id);

SELECT create_hypertable(
    'raw_events',
    'ledger_timestamp',
    chunk_time_interval => INTERVAL '7 days',
    migrate_data => TRUE,
    if_not_exists => TRUE
);

ALTER TABLE raw_events SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'contract_id, event_name',
    timescaledb.compress_orderby = 'ledger_timestamp DESC, ledger_sequence DESC'
);

SELECT add_compression_policy(
    'raw_events',
    INTERVAL '14 days',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_raw_events_ledger_timestamp
    ON raw_events (ledger_timestamp DESC);

-- Backwards-compatible read surface for clients still querying `events`.
CREATE OR REPLACE VIEW events AS
SELECT
    id,
    ledger_sequence,
    contract_id,
    event_name,
    task_id,
    data_json,
    processed_at,
    ledger_timestamp
FROM raw_events;

INSERT INTO schema_migrations (version)
VALUES ('002_timescaledb_raw_events_retention')
ON CONFLICT (version) DO NOTHING;
