'use strict';

/**
 * Tests ensuring TimescaleDB migration scripts contain required features.
 * These unit tests validate that the migration files include:
 *   • Hypertable creation with compression enabled (migration 004).
 *   • Continuous aggregate materialized views for hourly and daily metrics (migration 005).
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const migrationsDir = path.resolve(__dirname, '..', '..', 'migrations');

function loadMigration(name) {
  const filePath = path.join(migrationsDir, name);
  return fs.readFileSync(filePath, 'utf8');
}

test('004 migration enables compression on executions hypertable', () => {
  const sql = loadMigration('004_timescaledb_executions_hypertable.sql');
  // Verify the ALTER TABLE statement enabling compression exists.
  assert.match(sql, /ALTER TABLE executions SET \(\s*timescaledb\.compress,\s*timescaledb\.compress_segmentby = 'task_id, keeper_address, status',\s*timescaledb\.compress_orderby = 'executed_at DESC, id DESC'\s*\)/i,
    'Compression settings should be defined in migration 004');
  // Verify a compression policy is added.
  assert.match(sql, /SELECT add_compression_policy\('executions', INTERVAL '14 days'/i,
    'Compression policy should be added in migration 004');
});

test('005 migration creates hourly and daily continuous aggregates', () => {
  const sql = loadMigration('005_timescaledb_execution_continuous_aggregates.sql');
  // Hourly materialized view.
  assert.match(sql, /CREATE MATERIALIZED VIEW IF NOT EXISTS execution_hourly\s+WITH \(timescaledb\.continuous\) AS/i,
    'Hourly continuous aggregate view should be created');
  // Daily materialized view.
  assert.match(sql, /CREATE MATERIALIZED VIEW IF NOT EXISTS execution_daily\s+WITH \(timescaledb\.continuous\) AS/i,
    'Daily continuous aggregate view should be created');
  // Policies for each view.
  assert.match(sql, /add_continuous_aggregate_policy\('execution_hourly'/i,
    'Hourly aggregate policy should be defined');
  assert.match(sql, /add_continuous_aggregate_policy\('execution_daily'/i,
    'Daily aggregate policy should be defined');
});
