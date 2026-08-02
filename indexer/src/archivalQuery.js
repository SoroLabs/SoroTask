"use strict";

/**
 * Queries cold-storage event archives (S3 Parquet, written by archival.js)
 * directly via DuckDB's httpfs extension, without rehydrating them into the
 * primary database. This is an optional convenience layer: `duckdb-async` is
 * not a hard dependency of the indexer's core event pipeline, so it's
 * required lazily and only when this query path is actually used.
 */

const S3_BUCKET = process.env.S3_COLD_STORAGE_BUCKET || "ignition-cold-storage";

/** Queries archived events for one contract across all S3 Parquet partitions. */
async function queryArchivedEvents(contractId, limit = 100) {
  const { Database } = require("duckdb-async");
  const db = await Database.create(":memory:");
  try {
    await db.run("INSTALL httpfs;");
    await db.run("LOAD httpfs;");
    await db.run(`SET s3_region='${process.env.AWS_REGION || "us-east-1"}';`);
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      await db.run(`SET s3_access_key_id='${process.env.AWS_ACCESS_KEY_ID}';`);
      await db.run(`SET s3_secret_access_key='${process.env.AWS_SECRET_ACCESS_KEY}';`);
    }

    const glob = `s3://${S3_BUCKET}/events/*/*/*.parquet`;
    return await db.all(
      `SELECT id, ledger_sequence, contract_id, event_name, task_id, data_json, processed_at
       FROM read_parquet(?)
       WHERE contract_id = ?
       ORDER BY processed_at DESC
       LIMIT ?`,
      [glob, contractId, limit],
    );
  } finally {
    await db.close();
  }
}

module.exports = { queryArchivedEvents };
