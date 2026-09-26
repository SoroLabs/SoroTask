-- Migration: 007_keeper_dead_letter_postgres
--
-- Persistent PostgreSQL store for the keeper's dead-letter quarantine state
-- (issue #1204). The keeper's DeadLetterQueue previously mirrored its
-- quarantine records only to a local JSON file; this table lets the
-- PostgresDeadLetterStore adapter (keeper/src/deadLetter.js) make quarantine
-- state durable in the shared database so any keeper instance can hydrate it
-- after a restart.

CREATE TABLE IF NOT EXISTS keeper_dead_letter_records (
    task_id         BIGINT PRIMARY KEY,
    quarantined     BOOLEAN NOT NULL DEFAULT FALSE,
    record          JSONB NOT NULL,
    failure_history JSONB NOT NULL DEFAULT '[]',
    backoff         JSONB,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_keeper_dead_letter_quarantined
    ON keeper_dead_letter_records (quarantined, updated_at DESC);

INSERT INTO schema_migrations (version)
VALUES ('007_keeper_dead_letter_postgres')
ON CONFLICT (version) DO NOTHING;
