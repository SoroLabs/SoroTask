-- Migration: 009_execution_monthly_partitioning
--
-- The executions hypertable uses executed_at as its range partition key.
-- TimescaleDB creates each range chunk automatically as data arrives; this
-- controls future chunks to a monthly range without rewriting existing data.

SELECT set_chunk_time_interval('executions', INTERVAL '1 month');

INSERT INTO schema_migrations (version)
VALUES ('009_execution_monthly_partitioning')
ON CONFLICT (version) DO NOTHING;
