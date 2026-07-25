const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { DbRouter, parseReplicaUrls } = require('../dbRouter');

// Connect to the same DB file as the indexer
const DB_FILE = process.env.DB_FILE || path.resolve(__dirname, '../../indexer.db');

/**
 * Wrap a sqlite3.Database in the { queryAll, queryGet, queryRun } connection
 * interface the DbRouter expects.
 * @param {import('sqlite3').Database} database
 */
function wrapConnection(database) {
  return {
    _db: database,
    queryAll(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
      });
    },
    queryGet(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
      });
    },
    queryRun(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.run(sql, params, function (err) { return err ? reject(err) : resolve(this); });
      });
    },
  };
}

// Primary connection (writes + read fallback).
const primaryDb = new sqlite3.Database(DB_FILE);
const primary = wrapConnection(primaryDb);

// Issue #862: read replicas configured via DATABASE_READ_REPLICA_URLS
// (comma-separated). For SQLite these are additional file paths (typically
// read-only replicas synced out of band); the list is normally empty, in which
// case reads fall back to the primary and behaviour is unchanged. Replicas are
// opened read-only so a misrouted write fails loudly instead of diverging.
const replicaPaths = parseReplicaUrls(process.env.DATABASE_READ_REPLICA_URLS);
const replicas = replicaPaths.map((p) =>
  wrapConnection(new sqlite3.Database(p, sqlite3.OPEN_READONLY)),
);

const router = new DbRouter({ primary, replicas });

// Backwards-compatible exports: reads go through the router (replica or primary
// fallback); writes go to the primary. `db` remains the raw primary handle for
// any legacy callers that use it directly.
module.exports = {
  db: primaryDb,
  router,
  queryAll: (sql, params = []) => router.queryAll(sql, params),
  queryGet: (sql, params = []) => router.queryGet(sql, params),
  queryRun: (sql, params = []) => router.queryRun(sql, params),
};
