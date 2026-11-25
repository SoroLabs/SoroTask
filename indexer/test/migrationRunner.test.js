'use strict';

/**
 * Tests for the migration runner (issue #868).
 *
 * Uses an in-memory fake client rather than a live Postgres: the behaviour
 * under test is the runner's control flow — when it commits, when it reverses,
 * what it refuses to do — not whether Postgres executes DDL correctly.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runMigrations, rollbackLast, discoverMigrations } = require('../src/migrations/runner');

const silentLogger = { info() {}, error() {}, warn() {} };

/**
 * Minimal client recording every statement.
 *
 * `failOn` makes a statement matching a substring throw, so the failure paths
 * can be driven deterministically.
 */
function fakeDb({ failOn = null } = {}) {
  const applied = new Set();
  const statements = [];

  return {
    statements,
    applied,
    async query(sql, params) {
      statements.push(sql.trim().split('\n')[0]);

      if (failOn && sql.includes(failOn)) {
        throw new Error(`simulated failure executing: ${failOn}`);
      }
      if (sql.startsWith('INSERT INTO schema_migrations')) {
        applied.add(params[0]);
        return { rows: [] };
      }
      if (sql.startsWith('DELETE FROM schema_migrations')) {
        applied.delete(params[0]);
        return { rows: [] };
      }
      if (sql.includes('SELECT id FROM schema_migrations')) {
        return { rows: [...applied].map((id) => ({ id })) };
      }
      if (sql.includes('ORDER BY applied_at DESC')) {
        const last = [...applied].pop();
        return { rows: last ? [{ id: last }] : [] };
      }
      return { rows: [] };
    },
  };
}

/** Temporary migrations directory. */
function makeDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sorotask-migrations-'));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

test('applies a pending migration and records it', async () => {
  const dir = makeDir({
    '001_a.sql': 'CREATE TABLE a (id INT);',
    '001_a.down.sql': 'DROP TABLE IF EXISTS a;',
  });
  const db = fakeDb();

  const results = await runMigrations(db, { dir, logger: silentLogger });

  assert.deepStrictEqual(results, [{ id: '001_a', status: 'applied' }]);
  assert.ok(db.applied.has('001_a'));
});

test('does not re-apply an already applied migration', async () => {
  const dir = makeDir({
    '001_a.sql': 'CREATE TABLE a (id INT);',
    '001_a.down.sql': 'DROP TABLE IF EXISTS a;',
  });
  const db = fakeDb();

  await runMigrations(db, { dir, logger: silentLogger });
  const second = await runMigrations(db, { dir, logger: silentLogger });

  assert.deepStrictEqual(second, []);
});

test('refuses a migration with no down script', async () => {
  const dir = makeDir({ '001_a.sql': 'CREATE TABLE a (id INT);' });

  // Applying something irreversible is how the manual-restore situation in
  // #868 arises in the first place.
  await assert.rejects(
    () => runMigrations(fakeDb(), { dir, logger: silentLogger }),
    /has no matching .*down\.sql/,
  );
});

test('rolls back when post-migration validation fails', async () => {
  const dir = makeDir({
    '001_a.sql': 'CREATE TABLE a (id INT);',
    '001_a.down.sql': 'DROP TABLE IF EXISTS a;',
  });
  const db = fakeDb();

  await assert.rejects(
    () =>
      runMigrations(db, {
        dir,
        logger: silentLogger,
        validations: {
          '001_a': [{ name: 'column exists', run: async () => false }],
        },
      }),
    /rolled back after validation failure/,
  );

  // The critical assertion: a migration that committed but failed validation
  // must not remain recorded as applied.
  assert.ok(!db.applied.has('001_a'), 'ledger row must be removed on rollback');
  assert.ok(
    db.statements.some((s) => s.startsWith('DROP TABLE IF EXISTS a')),
    'down migration must actually run',
  );
});

test('a validation check that throws counts as a failure', async () => {
  const dir = makeDir({
    '001_a.sql': 'CREATE TABLE a (id INT);',
    '001_a.down.sql': 'DROP TABLE IF EXISTS a;',
  });
  const db = fakeDb();

  // Treating an errored check as "unknown, proceed" would let corruption
  // through, which is what this mechanism exists to prevent.
  await assert.rejects(
    () =>
      runMigrations(db, {
        dir,
        logger: silentLogger,
        validations: {
          '001_a': [
            {
              name: 'exploding check',
              run: async () => {
                throw new Error('boom');
              },
            },
          ],
        },
      }),
    /rolled back after validation failure/,
  );
  assert.ok(!db.applied.has('001_a'));
});

test('surfaces a failed rollback as CRITICAL rather than swallowing it', async () => {
  const dir = makeDir({
    '001_a.sql': 'CREATE TABLE a (id INT);',
    '001_a.down.sql': 'DROP TABLE IF EXISTS broken;',
  });
  // The down script itself fails — schema is wrong and cannot be reversed.
  const db = fakeDb({ failOn: 'DROP TABLE IF EXISTS broken' });

  await assert.rejects(
    () =>
      runMigrations(db, {
        dir,
        logger: silentLogger,
        validations: { '001_a': [{ name: 'check', run: async () => false }] },
      }),
    /CRITICAL: rollback of 001_a failed/,
  );
});

test('integrity check rejects a database ahead of the code', async () => {
  const dir = makeDir({
    '001_a.sql': 'CREATE TABLE a (id INT);',
    '001_a.down.sql': 'DROP TABLE IF EXISTS a;',
  });
  const db = fakeDb();
  // Simulates an app rollback without a schema rollback.
  db.applied.add('002_from_the_future');

  await assert.rejects(
    () => runMigrations(db, { dir, logger: silentLogger }),
    /migrations not present on disk/,
  );
});

test('rollbackLast reverses the most recent migration', async () => {
  const dir = makeDir({
    '001_a.sql': 'CREATE TABLE a (id INT);',
    '001_a.down.sql': 'DROP TABLE IF EXISTS a;',
  });
  const db = fakeDb();
  await runMigrations(db, { dir, logger: silentLogger });

  const rolled = await rollbackLast(db, { dir, logger: silentLogger });

  assert.strictEqual(rolled, '001_a');
  assert.ok(!db.applied.has('001_a'));
});

test('discoverMigrations pairs up and down scripts in order', () => {
  const dir = makeDir({
    '002_b.sql': 'SELECT 2;',
    '002_b.down.sql': 'SELECT -2;',
    '001_a.sql': 'SELECT 1;',
    '001_a.down.sql': 'SELECT -1;',
  });

  const found = discoverMigrations(dir);

  assert.deepStrictEqual(
    found.map((m) => m.id),
    ['001_a', '002_b'],
    'migrations must apply in lexical order',
  );
  assert.strictEqual(found[0].down.trim(), 'SELECT -1;');
});
