'use strict';

/**
 * Regression guard for the schema migration engine (issue #799).
 *
 * The migration runner refuses to apply any migration that lacks a matching
 * `.down.sql` (irreversible changes are the root cause of manual-restore
 * incidents). This test runs `discoverMigrations` against the *real* migrations
 * directory and asserts every up script is reversible, so nobody can add a
 * forward-only migration again (which previously broke boot with 002).
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { discoverMigrations, MIGRATIONS_DIR } = require('../src/migrations/runner');

test('all real migrations are irreversible-safe: every up has a matching down', () => {
  const migrations = discoverMigrations(MIGRATIONS_DIR);
  assert.ok(migrations.length >= 4, 'expected at least the four schema migrations');

  for (const migration of migrations) {
    assert.match(migration.id, /^\d{3}_/);
    assert.ok(migration.down.trim().length > 0, `${migration.id} must have a down script`);
  }
});