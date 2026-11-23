-- Rollback: 009_execution_monthly_partitioning
-- Existing chunks are retained; future chunks return to the prior weekly range.

SELECT set_chunk_time_interval('executions', INTERVAL '7 days');

DELETE FROM schema_migrations
WHERE version = '009_execution_monthly_partitioning';
