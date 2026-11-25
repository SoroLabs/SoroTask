-- Migration: 003_dashboard_query_indexes
-- Composite and JSONB indexes for the indexer's dashboard query patterns.

CREATE INDEX IF NOT EXISTS idx_tasks_creator_active_created_at
    ON tasks (creator_address, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_executions_task_ledger
    ON executions (task_id, ledger_sequence DESC);

-- Migration 002 exposes events as a view over raw_events, so the index belongs
-- on the underlying hypertable rather than on the compatibility view.
CREATE INDEX IF NOT EXISTS idx_raw_events_contract_name_ledger
    ON raw_events (contract_id, event_name, ledger_sequence DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_args_json_gin
    ON tasks USING GIN (args_json);

CREATE INDEX IF NOT EXISTS idx_tasks_whitelist_json_gin
    ON tasks USING GIN (whitelist_json);

CREATE INDEX IF NOT EXISTS idx_tasks_blocked_by_json_gin
    ON tasks USING GIN (blocked_by_json);

CREATE INDEX IF NOT EXISTS idx_raw_events_data_json_gin
    ON raw_events USING GIN (data_json);

INSERT INTO schema_migrations (version)
VALUES ('003_dashboard_query_indexes')
ON CONFLICT (version) DO NOTHING;