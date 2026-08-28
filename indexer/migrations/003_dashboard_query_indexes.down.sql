-- Down migration: 003_dashboard_query_indexes

DROP INDEX IF EXISTS idx_tasks_creator_active_created_at;
DROP INDEX IF EXISTS idx_executions_task_ledger;
DROP INDEX IF EXISTS idx_raw_events_contract_name_ledger;
DROP INDEX IF EXISTS idx_tasks_args_json_gin;
DROP INDEX IF EXISTS idx_tasks_whitelist_json_gin;
DROP INDEX IF EXISTS idx_tasks_blocked_by_json_gin;
DROP INDEX IF EXISTS idx_raw_events_data_json_gin;