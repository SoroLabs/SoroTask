-- Down migration: 004_contract_versioning

DROP INDEX IF EXISTS idx_raw_events_wasm_version;

ALTER TABLE raw_events DROP COLUMN IF EXISTS contract_version;
ALTER TABLE raw_events DROP COLUMN IF EXISTS wasm_version_hash;

ALTER TABLE tasks DROP COLUMN IF EXISTS contract_version;
ALTER TABLE tasks DROP COLUMN IF EXISTS wasm_version_hash;

DROP TABLE IF EXISTS contract_versions;