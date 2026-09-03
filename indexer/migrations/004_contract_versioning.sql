-- Migration: 004_contract_versioning
--
-- Version indexer schema definitions against the on-chain contract WASM
-- version hash (issue #799). A smart contract ABI upgrade is only safe once
-- the indexer can attribute each event to the exact WASM artifact that emitted
-- it — and can route that event to the matching schema version (V1 or V2).
--
-- Backward compatible by construction: the new columns are nullable with
-- defaults, so existing V1 event rows and current insert paths keep working
-- while the new fields are populated incrementally.

CREATE TABLE IF NOT EXISTS contract_versions (
    id                BIGSERIAL   PRIMARY KEY,
    contract_id       TEXT        NOT NULL,
    wasm_version_hash TEXT        NOT NULL,
    schema_version    TEXT        NOT NULL DEFAULT 'v1',
    start_ledger      BIGINT,
    end_ledger        BIGINT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (contract_id, wasm_version_hash)
);

-- Attribute each stored event (and each indexed task) to the emitting WASM
-- artifact. Existing rows default to 'v1' and a null hash until re-hydrated.
ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS wasm_version_hash TEXT;
ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS contract_version   TEXT DEFAULT 'v1';

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS wasm_version_hash TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS contract_version   TEXT DEFAULT 'v1';

CREATE INDEX IF NOT EXISTS idx_raw_events_wasm_version
    ON raw_events (wasm_version_hash, ledger_sequence DESC);

INSERT INTO schema_migrations (version)
VALUES ('004_contract_versioning')
ON CONFLICT (version) DO NOTHING;