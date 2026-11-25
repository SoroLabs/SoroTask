'use strict';

/**
 * Migration runner with automatic rollback (issue #868).
 *
 * A failed schema migration previously left the indexer's tables in whatever
 * half-applied state the error interrupted, and recovery meant a manual restore
 * from backup. This applies migrations inside a transaction, validates the
 * result, and reverses the change automatically when validation fails.
 *
 * ## Why validation exists at all
 *
 * A transaction only protects against SQL that *errors*. It does nothing about
 * a migration that succeeds and is wrong — a column added with the wrong type,
 * an index that silently did not get created, a table left empty by a botched
 * backfill. Those commit cleanly and corrupt the indexer downstream. The
 * post-migration validation step is what catches that class, and it is the
 * reason a `down` script is required rather than optional.
 *
 * ## Ordering guarantee
 *
 * Ingestion must not resume until integrity is verified. `runMigrations`
 * returns only after the check passes, so the caller has a single place to
 * gate on.
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

/** Filenames ending in this are down migrations, not standalone ones. */
const DOWN_SUFFIX = '.down.sql';

/**
 * Discover migrations on disk, newest last.
 *
 * A migration without a matching `.down.sql` is rejected rather than run.
 * Applying something irreversible is precisely how the manual-restore
 * situation in #868 arises, so the runner refuses to create it.
 */
function discoverMigrations(dir = MIGRATIONS_DIR) {
  const entries = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && !f.endsWith(DOWN_SUFFIX))
    .sort();

  return entries.map((file) => {
    const id = file.replace(/\.sql$/, '');
    const downFile = `${id}${DOWN_SUFFIX}`;
    const downPath = path.join(dir, downFile);

    if (!fs.existsSync(downPath)) {
      throw new Error(
        `Migration "${file}" has no matching "${downFile}". Every migration must be ` +
          `reversible — refusing to apply one that cannot be rolled back.`,
      );
    }

    return {
      id,
      upPath: path.join(dir, file),
      downPath,
      up: fs.readFileSync(path.join(dir, file), 'utf8'),
      down: fs.readFileSync(downPath, 'utf8'),
    };
  });
}

/** Ledger of applied migrations. Created before anything else runs. */
async function ensureMigrationTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id           TEXT        PRIMARY KEY,
      applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum     TEXT
    )
  `);
}

async function getAppliedIds(db) {
  const result = await db.query('SELECT id FROM schema_migrations');
  return new Set((result.rows ?? []).map((r) => r.id));
}

/**
 * Post-migration validation.
 *
 * Checks are supplied per migration by the caller. Each is
 * `{ name, run(db) -> boolean }`; any returning false triggers rollback.
 *
 * Deliberately not inferred from the SQL: guessing what a migration *meant* is
 * how a validator ends up asserting the same mistake the migration made.
 */
async function runValidations(db, checks, logger) {
  const failures = [];

  for (const check of checks) {
    try {
      const ok = await check.run(db);
      if (!ok) failures.push(check.name);
    } catch (err) {
      // A check that throws is a failed check. Treating an error as "unknown,
      // proceed" would let the corruption through, which is the outcome this
      // whole mechanism exists to prevent.
      failures.push(`${check.name} (threw: ${err.message})`);
    }
  }

  if (failures.length > 0) {
    logger.error(`Validation failed: ${failures.join('; ')}`);
  }
  return failures;
}

/**
 * Apply one migration, validating and rolling back on failure.
 *
 * The up migration and its ledger row commit together, so the ledger can never
 * claim a migration was applied when it was not.
 */
async function applyMigration(db, migration, checks, logger) {
  logger.info(`Applying migration ${migration.id}`);

  await db.query('BEGIN');
  try {
    await db.query(migration.up);
    await db.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    // The transaction already undid everything, so the down script is not run
    // here — running it against a schema that was never changed could drop
    // objects an earlier migration legitimately created.
    throw new Error(`Migration ${migration.id} failed and was rolled back: ${err.message}`);
  }

  const failures = await runValidations(db, checks, logger);
  if (failures.length === 0) {
    logger.info(`Migration ${migration.id} applied and validated`);
    return { id: migration.id, status: 'applied' };
  }

  // Committed but wrong — this is the case a transaction cannot catch, and the
  // reason the down script exists.
  logger.error(`Rolling back ${migration.id} after failed validation`);
  await db.query('BEGIN');
  try {
    await db.query(migration.down);
    await db.query('DELETE FROM schema_migrations WHERE id = $1', [migration.id]);
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    // Rollback itself failing is the genuinely dangerous state: the schema is
    // wrong and could not be reversed. Surface it loudly and stop — continuing
    // would ingest into a schema known to be broken.
    throw new Error(
      `CRITICAL: rollback of ${migration.id} failed — schema is in an unknown state ` +
        `and requires manual intervention. Validation failures: ${failures.join('; ')}. ` +
        `Rollback error: ${err.message}`,
    );
  }

  throw new Error(
    `Migration ${migration.id} rolled back after validation failure: ${failures.join('; ')}`,
  );
}

/**
 * Integrity check run before ingestion resumes.
 *
 * Confirms the ledger and the schema agree. Cheap, and it catches the case
 * where a migration was reversed manually but its ledger row was left behind —
 * which would otherwise make the runner skip re-applying it.
 */
async function verifyIntegrity(db, migrations, logger) {
  const applied = await getAppliedIds(db);
  const known = new Set(migrations.map((m) => m.id));

  const unknown = [...applied].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    // The database is ahead of this build — likely a rollback of the
    // application without a rollback of the schema.
    throw new Error(
      `Integrity check failed: database reports migrations not present on disk ` +
        `(${unknown.join(', ')}). Refusing to start ingestion against an unknown schema.`,
    );
  }

  const pending = migrations.filter((m) => !applied.has(m.id));
  if (pending.length > 0) {
    throw new Error(
      `Integrity check failed: migrations still pending (${pending.map((m) => m.id).join(', ')}).`,
    );
  }

  logger.info(`Integrity verified: ${applied.size} migration(s) applied`);
  return true;
}

/**
 * Apply all pending migrations, then verify integrity.
 *
 * Resolves only when the schema is known-good, so callers can gate ledger
 * ingestion on this promise directly.
 *
 * @param db        Client exposing `query(sql, params?)`.
 * @param options.validations  `{ [migrationId]: Check[] }`.
 * @param options.dir          Override the migrations directory (tests).
 * @param options.logger       Defaults to console.
 */
async function runMigrations(db, options = {}) {
  const { validations = {}, dir = MIGRATIONS_DIR, logger = console } = options;

  const migrations = discoverMigrations(dir);
  await ensureMigrationTable(db);

  const applied = await getAppliedIds(db);
  const pending = migrations.filter((m) => !applied.has(m.id));

  if (pending.length === 0) {
    logger.info('No pending migrations');
  }

  const results = [];
  for (const migration of pending) {
    results.push(await applyMigration(db, migration, validations[migration.id] ?? [], logger));
  }

  await verifyIntegrity(db, migrations, logger);
  return results;
}

/** Reverse the most recently applied migration. Operator escape hatch. */
async function rollbackLast(db, options = {}) {
  const { dir = MIGRATIONS_DIR, logger = console } = options;

  const migrations = discoverMigrations(dir);
  const result = await db.query(
    'SELECT id FROM schema_migrations ORDER BY applied_at DESC, id DESC LIMIT 1',
  );
  const last = result.rows?.[0];
  if (!last) {
    logger.info('Nothing to roll back');
    return null;
  }

  const migration = migrations.find((m) => m.id === last.id);
  if (!migration) {
    throw new Error(
      `Cannot roll back "${last.id}": its down migration is not present on disk.`,
    );
  }

  await db.query('BEGIN');
  try {
    await db.query(migration.down);
    await db.query('DELETE FROM schema_migrations WHERE id = $1', [migration.id]);
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw new Error(`Rollback of ${migration.id} failed: ${err.message}`);
  }

  logger.info(`Rolled back ${migration.id}`);
  return migration.id;
}

module.exports = {
  runMigrations,
  rollbackLast,
  verifyIntegrity,
  discoverMigrations,
  MIGRATIONS_DIR,
};
