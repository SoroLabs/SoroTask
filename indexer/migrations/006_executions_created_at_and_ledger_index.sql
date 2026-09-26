-- Migration: 006_executions_created_at_and_ledger_index
--
-- Completes the TimescaleDB execution analytics surface (issue #1206):
-- adds the `created_at` timestamp column to the executions table, a
-- standalone ledger_sequence index for ledger-scoped queries, and a
-- 1-minute continuous aggregate alongside the hourly/daily ones from 005
-- so dashboard charts over 30-day windows never scan the raw hypertable.

-- [Easy] created_at timestamp column on executions.
ALTER TABLE executions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- [Medium] Standalone ledger_sequence index for ledger-scoped lookups.
CREATE INDEX IF NOT EXISTS idx_executions_ledger_sequence
    ON executions (ledger_sequence);

-- [Advanced] 1-minute continuous aggregate alongside the hourly/daily
-- aggregates from 005 (issue #1206).
CREATE MATERIALIZED VIEW IF NOT EXISTS execution_minute
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 minute', executed_at) AS bucket,
       task_id,
       status,
       COUNT(*)          AS executions,
       SUM(fee_paid)     AS fee_paid_total
FROM executions
GROUP BY bucket, task_id, status
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'execution_minute',
    start_offset       => INTERVAL '1 day',
    end_offset         => INTERVAL '1 minute',
    schedule_interval  => INTERVAL '1 minute',
    if_not_exists      => TRUE
);

INSERT INTO schema_migrations (version)
VALUES ('006_executions_created_at_and_ledger_index')
ON CONFLICT (version) DO NOTHING;
