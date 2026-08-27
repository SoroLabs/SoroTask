-- Down migration: 002_timescaledb_raw_events_retention
-- Reverses hypertable and raw_events alterations.

DROP VIEW IF EXISTS events;
DROP INDEX IF EXISTS idx_raw_events_ledger_timestamp;

DO $$
BEGIN
    IF to_regclass('public.raw_events') IS NOT NULL
       AND to_regclass('public.events') IS NULL THEN
        ALTER TABLE raw_events RENAME TO events;
    END IF;
END $$;
