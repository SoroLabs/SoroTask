-- Migration: 001_initial_schema
-- Creates the initial PostgreSQL schema for the SoroTask indexer.

CREATE TABLE IF NOT EXISTS users (
    id          BIGSERIAL PRIMARY KEY,
    address     TEXT        NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_address ON users (address);

CREATE TABLE IF NOT EXISTS tasks (
    task_id             BIGINT      PRIMARY KEY,
    creator_address     TEXT        NOT NULL REFERENCES users (address) ON UPDATE CASCADE,
    target              TEXT        NOT NULL,
    function_name       TEXT        NOT NULL,
    args_json           JSONB,
    resolver            TEXT,
    interval_seconds    BIGINT      NOT NULL,
    last_run_ledger     BIGINT      NOT NULL DEFAULT 0,
    gas_balance         NUMERIC(38) NOT NULL DEFAULT 0,
    whitelist_json      JSONB,
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    blocked_by_json     JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_reconciled_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks (creator_address);
CREATE INDEX IF NOT EXISTS idx_tasks_is_active ON tasks (is_active);

CREATE TABLE IF NOT EXISTS executions (
    id              BIGSERIAL   PRIMARY KEY,
    task_id         BIGINT      NOT NULL REFERENCES tasks (task_id) ON DELETE CASCADE,
    keeper_address  TEXT        NOT NULL,
    tx_hash         TEXT,
    status          TEXT        NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'TIMEOUT', 'SKIPPED')),
    fee_paid        NUMERIC(38) NOT NULL DEFAULT 0,
    ledger_sequence BIGINT,
    error_message   TEXT,
    executed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_executions_task_id ON executions (task_id);
CREATE INDEX IF NOT EXISTS idx_executions_keeper ON executions (keeper_address);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions (status);
CREATE INDEX IF NOT EXISTS idx_executions_executed_at ON executions (executed_at DESC);

CREATE TABLE IF NOT EXISTS events (
    id              BIGSERIAL   PRIMARY KEY,
    ledger_sequence BIGINT      NOT NULL,
    contract_id     TEXT        NOT NULL,
    event_name      TEXT        NOT NULL,
    task_id         BIGINT,
    data_json       JSONB       NOT NULL,
    processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (ledger_sequence, contract_id, event_name, task_id)
);

CREATE INDEX IF NOT EXISTS idx_events_task_id ON events (task_id);
CREATE INDEX IF NOT EXISTS idx_events_event_name ON events (event_name);
CREATE INDEX IF NOT EXISTS idx_events_ledger ON events (ledger_sequence);

CREATE TABLE IF NOT EXISTS reconciliation_logs (
    id          BIGSERIAL   PRIMARY KEY,
    task_id     BIGINT,
    status      TEXT        NOT NULL,
    details     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_task_id ON reconciliation_logs (task_id);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT        PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
    ON CONFLICT (version) DO NOTHING;
