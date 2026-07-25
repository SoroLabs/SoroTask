"use strict";

/**
 * Database read-replica load balancer / read-write splitter (issue #862).
 *
 * IMPORTANT DB-ENGINE REALITY: the indexer currently uses sqlite3 -- an
 * embedded, single-file database (see indexer/src/index.js and
 * indexer/src/graphql/db.js). SQLite has no concept of network read replicas
 * the way PostgreSQL does, so building "replica routing" against SQLite alone
 * would be fake for the actual engine. What is genuinely useful and real,
 * regardless of engine, is a read/write-splitting *router*:
 *
 *   - writes (event ingestion) are pinned to the PRIMARY connection;
 *   - reads (GraphQL resolvers, REST GETs) round-robin across N configured
 *     read connections;
 *   - if no read connections are configured, reads fall back to the primary,
 *     so existing single-DB (single-file SQLite) deployments keep working
 *     unchanged.
 *
 * The router is engine-agnostic: each "connection" is any object exposing
 * queryAll / queryGet / queryRun. In today's SQLite deployment the replica
 * list is empty and everything correctly falls back to primary. If the indexer
 * is later moved to Postgres, `createConnection` can be pointed at pg pools and
 * DATABASE_READ_REPLICA_URLS will fan reads across real replicas with no
 * changes to the call sites.
 */

/**
 * @typedef {Object} DbConnection
 * @property {(sql:string, params?:any[]) => Promise<any[]>} queryAll
 * @property {(sql:string, params?:any[]) => Promise<any>}   queryGet
 * @property {(sql:string, params?:any[]) => Promise<any>}   queryRun
 */

class DbRouter {
  /**
   * @param {{ primary: DbConnection, replicas?: DbConnection[] }} opts
   */
  constructor({ primary, replicas = [] }) {
    if (!primary) throw new Error("DbRouter requires a primary connection");
    this.primary = primary;
    this.replicas = replicas.filter(Boolean);
    this._rr = 0;
  }

  /** @returns {boolean} */
  hasReplicas() {
    return this.replicas.length > 0;
  }

  /**
   * Pick a connection for READ queries: round-robin across replicas, or the
   * primary if none are configured.
   * @returns {DbConnection}
   */
  getReadConnection() {
    if (this.replicas.length === 0) return this.primary;
    const conn = this.replicas[this._rr % this.replicas.length];
    this._rr = (this._rr + 1) % this.replicas.length;
    return conn;
  }

  /**
   * Pick the connection for WRITE queries: always the primary.
   * @returns {DbConnection}
   */
  getWriteConnection() {
    return this.primary;
  }

  // Read paths -> read connection (replica or primary fallback).
  queryAll(sql, params = []) {
    return this.getReadConnection().queryAll(sql, params);
  }

  queryGet(sql, params = []) {
    return this.getReadConnection().queryGet(sql, params);
  }

  // Write path -> primary only.
  queryRun(sql, params = []) {
    return this.getWriteConnection().queryRun(sql, params);
  }
}

/**
 * Parse a comma-separated list of replica connection strings from the
 * environment (empty/undefined -> []).
 * @param {string|undefined} raw
 * @returns {string[]}
 */
function parseReplicaUrls(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

module.exports = { DbRouter, parseReplicaUrls };
