"use strict";

/**
 * Cold-storage archival for old indexed events (Issue #825).
 *
 * Events older than ARCHIVAL_CUTOFF_DAYS are exported to a Parquet file,
 * uploaded to S3 under `events/year=YYYY/month=MM/`, and pruned from the
 * primary `events` table (see index.js for its schema). Dependencies are
 * injected as `{queryAll, queryRun}` so this is testable against an
 * in-memory SQLite database, matching the pattern in merkleStore.js.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const ARCHIVAL_CUTOFF_DAYS = Number(process.env.ARCHIVAL_CUTOFF_DAYS || 90);
const ARCHIVAL_BATCH_LIMIT = Number(process.env.ARCHIVAL_BATCH_LIMIT || 50000);
const S3_BUCKET = process.env.S3_COLD_STORAGE_BUCKET || "ignition-cold-storage";

/**
 * Formats a cutoff Date as `YYYY-MM-DD HH:MM:SS` (space-separated, UTC) to
 * match SQLite's `CURRENT_TIMESTAMP` format exactly - comparing against an
 * ISO string (`T`-separated) would sort incorrectly for events processed
 * later on the same UTC day as the cutoff.
 */
function cutoffTimestamp(now = Date.now()) {
  const cutoffMs = now - ARCHIVAL_CUTOFF_DAYS * 24 * 60 * 60 * 1000;
  return new Date(cutoffMs).toISOString().slice(0, 19).replace("T", " ");
}

async function findArchivableEvents({ queryAll }, now = Date.now()) {
  return queryAll(
    `SELECT id, ledger_sequence, contract_id, event_name, task_id, data_json, processed_at
     FROM events
     WHERE processed_at < ?
     ORDER BY processed_at ASC
     LIMIT ?`,
    [cutoffTimestamp(now), ARCHIVAL_BATCH_LIMIT],
  );
}

async function writeParquetFile(events, filePath) {
  const parquet = require("parquetjs-lite");
  const schema = new parquet.ParquetSchema({
    id: { type: "INT64" },
    ledger_sequence: { type: "INT64" },
    contract_id: { type: "UTF8" },
    event_name: { type: "UTF8" },
    task_id: { type: "INT64" },
    data_json: { type: "UTF8" },
    processed_at: { type: "UTF8" },
  });
  const writer = await parquet.ParquetWriter.openFile(schema, filePath, {
    compression: "SNAPPY",
  });
  for (const row of events) {
    await writer.appendRow({
      id: BigInt(row.id),
      ledger_sequence: BigInt(row.ledger_sequence),
      contract_id: row.contract_id,
      event_name: row.event_name,
      task_id: BigInt(row.task_id),
      data_json: row.data_json,
      processed_at: String(row.processed_at),
    });
  }
  await writer.close();
}

/** Uploads a local Parquet file to S3 and returns the key it was stored under. */
async function uploadToS3(filePath, now = Date.now()) {
  const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
  const date = new Date(now);
  const key = `events/year=${date.getUTCFullYear()}/month=${String(
    date.getUTCMonth() + 1,
  ).padStart(2, "0")}/${path.basename(filePath)}`;

  const client = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
  await client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: "application/vnd.apache.parquet",
    }),
  );
  return key;
}

/**
 * Runs one archival pass: finds events past the retention window, writes
 * them to Parquet, uploads to S3, then prunes them from the primary table.
 * No-ops (`{archived: 0}`) when nothing is eligible yet.
 *
 * `writeParquet`/`upload` are injectable (defaulting to the real Parquet/S3
 * implementations) so this can be tested without touching the filesystem or
 * network, matching the dependency-injection style used elsewhere in the
 * indexer (see merkleStore.js, staleTasks.js).
 */
async function archiveOldEvents(
  deps,
  { now = Date.now(), writeParquet = writeParquetFile, upload = uploadToS3 } = {},
) {
  const events = await findArchivableEvents(deps, now);
  if (events.length === 0) {
    return { archived: 0, s3Key: null };
  }

  const tempFilePath = path.join(os.tmpdir(), `events_archive_${now}.parquet`);
  await writeParquet(events, tempFilePath);

  let s3Key;
  try {
    s3Key = await upload(tempFilePath, now);
  } finally {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
  }

  const ids = events.map((e) => e.id);
  const placeholders = ids.map(() => "?").join(",");
  await deps.queryRun(`DELETE FROM events WHERE id IN (${placeholders})`, ids);

  return { archived: events.length, s3Key };
}

/**
 * Wires `archiveOldEvents` into the indexer's setInterval-based scheduler
 * (see index.js's POLL_INTERVAL_MS/RECONCILE_INTERVAL_MS for the same
 * pattern). Checked daily by default; a run with nothing eligible costs one
 * indexed SELECT.
 */
function scheduleArchival(deps, intervalMs = 24 * 60 * 60 * 1000) {
  return setInterval(() => {
    archiveOldEvents(deps).catch((err) => {
      console.error("Event archival run failed:", err.message);
    });
  }, intervalMs);
}


/**
 * S3 cold-storage tiering for historical task executions (issue #1206).
 *
 * Mirrors the event archival flow above: rows older than the retention
 * cutoff are exported to Parquet under `executions/year=YYYY/month=MM/`,
 * uploaded to S3, then pruned from the primary `executions` hypertable.
 * `created_at` (see migration 006) is the tiering key, so retention is
 * measured from when the execution row was ingested.
 */

const EXECUTION_CUTOFF_DAYS = Number(
  process.env.EXECUTION_ARCHIVAL_CUTOFF_DAYS || ARCHIVAL_CUTOFF_DAYS,
);
const EXECUTION_BATCH_LIMIT = Number(process.env.EXECUTION_ARCHIVAL_BATCH_LIMIT || 50000);

function executionCutoffTimestamp(now = Date.now()) {
  const cutoffMs = now - EXECUTION_CUTOFF_DAYS * 24 * 60 * 60 * 1000;
  return new Date(cutoffMs).toISOString().slice(0, 19).replace("T", " ");
}

async function findArchivableExecutions({ queryAll }, now = Date.now()) {
  return queryAll(
    `SELECT id, task_id, keeper_address, tx_hash, status, fee_paid,
            ledger_sequence, error_message, executed_at, created_at
     FROM executions
     WHERE created_at < ?
     ORDER BY created_at ASC
     LIMIT ?`,
    [executionCutoffTimestamp(now), EXECUTION_BATCH_LIMIT],
  );
}

async function writeExecutionsParquetFile(executions, filePath) {
  const parquet = require("parquetjs-lite");
  const schema = new parquet.ParquetSchema({
    id: { type: "INT64" },
    task_id: { type: "INT64" },
    keeper_address: { type: "UTF8" },
    tx_hash: { type: "UTF8" },
    status: { type: "UTF8" },
    fee_paid: { type: "DOUBLE" },
    ledger_sequence: { type: "INT64" },
    error_message: { type: "UTF8" },
    executed_at: { type: "UTF8" },
    created_at: { type: "UTF8" },
  });
  const writer = await parquet.ParquetWriter.openFile(schema, filePath, {
    compression: "SNAPPY",
  });
  for (const row of executions) {
    await writer.appendRow({
      id: BigInt(row.id),
      task_id: BigInt(row.task_id),
      keeper_address: row.keeper_address,
      tx_hash: row.tx_hash,
      status: row.status,
      fee_paid: Number(row.fee_paid),
      ledger_sequence: row.ledger_sequence === null ? BigInt(0) : BigInt(row.ledger_sequence),
      error_message: row.error_message,
      executed_at: String(row.executed_at),
      created_at: String(row.created_at),
    });
  }
  await writer.close();
}

/** Uploads an executions Parquet file to S3 and returns the stored key. */
async function uploadExecutionsToS3(filePath, now = Date.now()) {
  const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
  const date = new Date(now);
  const key = `executions/year=${date.getUTCFullYear()}/month=${String(
    date.getUTCMonth() + 1,
  ).padStart(2, "0")}/${path.basename(filePath)}`;

  const client = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
  await client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: "application/vnd.apache.parquet",
    }),
  );
  return key;
}

/**
 * Runs one executions tiering pass: rows past the retention window are
 * written to Parquet, uploaded to S3, then pruned from `executions`.
 * No-ops (`{archived: 0}`) when nothing is eligible yet; `writeParquet`
 * and `upload` are injectable for tests like `archiveOldEvents`.
 */
async function archiveExecutions(
  deps,
  { now = Date.now(), writeParquet = writeExecutionsParquetFile, upload = uploadExecutionsToS3 } = {},
) {
  const executions = await findArchivableExecutions(deps, now);
  if (executions.length === 0) {
    return { archived: 0, s3Key: null };
  }

  const tempFilePath = path.join(os.tmpdir(), `executions_archive_${now}.parquet`);
  await writeParquet(executions, tempFilePath);

  let s3Key;
  try {
    s3Key = await upload(tempFilePath, now);
  } finally {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
  }

  const ids = executions.map((e) => e.id);
  const placeholders = ids.map(() => "?").join(",");
  await deps.queryRun(`DELETE FROM executions WHERE id IN (${placeholders})`, ids);

  return { archived: executions.length, s3Key };
}

/**
 * Schedules the executions tiering pass alongside the events archival
 * sweep (issue #1206). Runs daily by default, right after the event pass.
 */
function scheduleExecutionsArchival(deps, intervalMs = 24 * 60 * 60 * 1000) {
  return setInterval(() => {
    archiveExecutions(deps).catch((err) => {
      console.error("Execution archival run failed:", err.message);
    });
  }, intervalMs);
}

module.exports = {
  ARCHIVAL_CUTOFF_DAYS,
  cutoffTimestamp,
  findArchivableEvents,
  archiveOldEvents,
  scheduleArchival,
  EXECUTION_CUTOFF_DAYS,
  executionCutoffTimestamp,
  findArchivableExecutions,
  archiveExecutions,
  scheduleExecutionsArchival,
};
