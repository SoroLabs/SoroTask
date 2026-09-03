-- Down migration: 005_timescaledb_execution_continuous_aggregates
--
-- Removes the continuous aggregates and their refresh policies, then drops the
-- hypertable-specific index. The `executions` table itself is retained (its
-- creation belongs to 001_initial_schema), but reverting 005 makes it a plain
-- table again.

SELECT remove_continuous_aggregate_policy('execution_hourly', if_exists => TRUE);
SELECT remove_continuous_aggregate_policy('execution_daily',  if_exists => TRUE);

DROP MATERIALIZED VIEW IF EXISTS execution_hourly;
DROP MATERIALIZED VIEW IF EXISTS execution_daily;

DROP INDEX IF EXISTS idx_executions_executed_at_ts;