-- Rollback: 007_keeper_dead_letter_postgres (issue #1204)

DROP INDEX IF EXISTS idx_keeper_dead_letter_quarantined;
DROP TABLE IF EXISTS keeper_dead_letter_records;

DELETE FROM schema_migrations WHERE version = '007_keeper_dead_letter_postgres';
