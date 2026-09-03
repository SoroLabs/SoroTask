-- Down migration: 002_timescaledb_raw_events_retention
--
-- Reverses 002_timescaledb_raw_events_retention.sql back to the plain `events`
-- table that 001_initial_schema created. Because the up migration renamed the
-- table and exposed it through a compatibility view, the down path reverses
-- those in dependency order: drop the view, detach from TimescaleDB by removing
-- the hypertable's ancillary objects, then rename raw_events back to events.
--
-- Guarded with IF EXISTS / defensive checks so a partial earlier state can
-- still be rolled back.

SELECT remove_compression_policy('raw_events', if_exists => TRUE);

DROP VIEW IF EXISTS events;

DROP INDEX IF EXISTS idx_raw_events_ledger_timestamp;

ALTER TABLE raw_events SET (timescaledb.compress = 'false');

ALTER TABLE raw_events DROP CONSTRAINT IF EXISTS raw_events_dedup_key;
ALTER TABLE raw_events DROP COLUMN IF EXISTS ledger_timestamp;

-- Restore the original table name used by 001_initial_schema.
ALTER TABLE IF EXISTS raw_events RENAME TO events;