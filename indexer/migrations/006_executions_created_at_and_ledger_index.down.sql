-- Rollback: 006_executions_created_at_and_ledger_index (issue #1206)

SELECT remove_continuous_aggregate_policy('execution_minute', if_not_exists => TRUE);
DROP MATERIALIZED VIEW IF EXISTS execution_minute;

DROP INDEX IF EXISTS idx_executions_ledger_sequence;

ALTER TABLE executions DROP COLUMN IF EXISTS created_at;

DELETE FROM schema_migrations WHERE version = '006_executions_created_at_and_ledger_index';
