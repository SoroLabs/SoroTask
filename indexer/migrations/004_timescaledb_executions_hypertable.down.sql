-- Down migration: 004_timescaledb_executions_hypertable
-- Reverses TimescaleDB hypertable compression on executions.

SELECT remove_compression_policy('executions', if_exists => TRUE);
