-- Migration: 005_timescaledb_execution_continuous_aggregates
--
-- Builds the time-series analytics surface for execution metrics (issue #796).
-- `executions` becomes a TimescaleDB hypertable over executed_at, and hourly +
-- daily continuous aggregates pre-aggregate throughput and fee metrics so
-- dashboard queries never scan the raw table. Requires TimescaleDB.
--
-- Applied after 001 (executions) and 002 (TimescaleDB enabled + raw_events
-- hypertable), so only this migration guarantees the executions hypertable.

CREATE INDEX IF NOT EXISTS idx_executions_executed_at_ts
    ON executions (executed_at DESC);

SELECT create_hypertable(
    'executions',
    'executed_at',
    chunk_time_interval => INTERVAL '7 days',
    migrate_data => TRUE,
    if_not_exists => TRUE
);

-- Hourly throughput + fee analytics per task and per status.
CREATE MATERIALIZED VIEW IF NOT EXISTS execution_hourly
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', executed_at) AS bucket,
       task_id,
       status,
       COUNT(*)          AS executions,
       SUM(fee_paid)     AS fee_paid_total
FROM executions
GROUP BY bucket, task_id, status
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'execution_hourly',
    start_offset       => INTERVAL '3 days',
    end_offset         => INTERVAL '1 hour',
    schedule_interval  => INTERVAL '1 hour',
    if_not_exists      => TRUE
);

-- Daily throughput + average fee analytics per task.
CREATE MATERIALIZED VIEW IF NOT EXISTS execution_daily
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 day', executed_at) AS bucket,
       task_id,
       COUNT(*)       AS executions,
       SUM(fee_paid)  AS fee_paid_total,
       AVG(fee_paid)  AS avg_fee_paid
FROM executions
GROUP BY bucket, task_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'execution_daily',
    start_offset       => INTERVAL '30 days',
    end_offset         => INTERVAL '1 hour',
    schedule_interval  => INTERVAL '1 day',
    if_not_exists      => TRUE
);

INSERT INTO schema_migrations (version)
VALUES ('005_timescaledb_execution_continuous_aggregates')
ON CONFLICT (version) DO NOTHING;