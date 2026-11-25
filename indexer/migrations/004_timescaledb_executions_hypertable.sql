-- Migration: 004_timescaledb_executions_hypertable
-- Creates TimescaleDB hypertable for execution logs (executions table)
-- with compression and retention policies for high-throughput execution tracking.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- TimescaleDB hypertables require primary key/unique constraints to include partitioning column
ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_pkey;
ALTER TABLE executions ADD CONSTRAINT executions_pkey PRIMARY KEY (id, executed_at);

SELECT create_hypertable(
    'executions',
    'executed_at',
    chunk_time_interval => INTERVAL '7 days',
    migrate_data => TRUE,
    if_not_exists => TRUE
);

ALTER TABLE executions SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'task_id, keeper_address, status',
    timescaledb.compress_orderby = 'executed_at DESC, id DESC'
);

SELECT add_compression_policy(
    'executions',
    INTERVAL '14 days',
    if_not_exists => TRUE
);

INSERT INTO schema_migrations (version)
VALUES ('004_timescaledb_executions_hypertable')
ON CONFLICT (version) DO NOTHING;
