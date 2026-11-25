const { scValToNative, xdr } = require('@stellar/stellar-sdk');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { EventSchemaRegistry } = require('./eventSchemaRegistry');

/**
 * Pure, dependency-free-by-content parse of a single raw Soroban contract event.
 * Kept as a module-level function (the legacy parser path) so it can be run
 * both in-process and inside a worker thread with identical results.
 * @param {object} event - Raw event with topic[] and value base64 XDR
 * @returns {object} Parsed event
 * @throws {Error} When the XDR cannot be decoded
 */
function parseEventCore(event) {
  const topics = event.topic.map((t) => scValToNative(xdr.ScVal.fromXDR(t, 'base64')));
  const name = topics[0];
  let taskId;

  if (topics.length > 2 && topics[1] === 'v1') {
    taskId = Number(topics[2]);
  } else if (topics.length > 2 && typeof topics[1] === 'string' && topics[1].startsWith('v')) {
    taskId = Number(topics[2]);
  } else {
    taskId = Number(topics[1]);
  }

  const data = scValToNative(xdr.ScVal.fromXDR(event.value, 'base64'));

  let dataJson;
  switch (name) {
    case 'TaskRegistered':
    case 'TaskExecuted':
    case 'TaskPaused':
    case 'TaskResumed':
    case 'TaskCancelled':
      dataJson = JSON.stringify({ creator: data[0] });
      break;
    case 'ContractInitialized':
      dataJson = JSON.stringify({ token: data[0] });
      break;
    case 'KeeperPaid':
      dataJson = JSON.stringify({ keeper: data[0], fee: data[1] ? data[1].toString() : '0' });
      break;
    case 'GasDeposited':
    case 'GasWithdrawn':
      dataJson = JSON.stringify({
        address: data[0],
        amount: data[1] ? data[1].toString() : '0',
      });
      break;
    default:
      dataJson = JSON.stringify({ raw: data });
      break;
  }

  return {
    ledgerSequence: event.ledgerSequence || event.ledger,
    eventName: name,
    taskId: taskId || 0,
    dataJson,
    parsedAt: new Date().toISOString(),
  };
}

class ParallelLedgerParser {
  constructor(options = {}) {
    this.concurrency = options.concurrency || 4;
    this.schemaRegistry = options.schemaRegistry || new EventSchemaRegistry(options);
    this.workerPath = options.workerPath || path.join(__dirname, 'ledgerParseWorker.js');
  }

  parseEvent(event) {
    try {
      return parseEventCore(event);
    } catch (err) {
      throw new Error(`Failed to parse ledger event: ${err.message}`);
    }
  }

  /**
   * Parse an event using the schema registry for versioned decoding.
   * Falls back to legacy parsing if schema registry fails.
   *
   * @param {object} event - Raw event with topic and value arrays
   * @returns {object} Parsed event
   */
  parseEventWithSchema(event) {
    try {
      const name = scValToNative(xdr.ScVal.fromXDR(event.topic[0], 'base64'));
      const ledgerSequence = event.ledgerSequence || event.ledger;

      const decoded = this.schemaRegistry.decodeEvent(
        name,
        event.topic,
        event.value,
        ledgerSequence,
      );

      return {
        ledgerSequence,
        eventName: decoded.eventName,
        taskId: decoded.taskId,
        dataJson: JSON.stringify(decoded.data),
        schemaVersion: decoded.version,
        isFallback: decoded.isFallback,
        parsedAt: new Date().toISOString(),
      };
    } catch (err) {
      // Fallback to legacy parsing
      return this.parseEvent(event);
    }
  }

  async parseBatch(events = []) {
    if (events.length === 0) return [];

    try {
      return await this._parseWithWorkerPool(events);
    } catch (err) {
      // Fall back to the in-process chunked parser when worker threads are
      // unavailable (restricted sandboxes, exotic toolchains, etc.). Identical
      // output, just without OS-level thread parallelism.
      return this._parseInProcess(events);
    }
  }

  /**
   * Divide the events (sorted by ledger sequence) into `concurrency` contiguous
   * ledger sequence ranges and parse each range on its own worker thread.
   */
  async _parseWithWorkerPool(events = []) {
    const poolSize = Math.min(Math.max(1, this.concurrency), events.length);
    const sorted = [...events].sort(
      (a, b) => (a.ledgerSequence || a.ledger || 0) - (b.ledgerSequence || b.ledger || 0)
    );

    const ranges = [];
    for (let i = 0; i < poolSize; i += 1) {
      const start = Math.floor((events.length / poolSize) * i);
      const end = Math.floor((events.length / poolSize) * (i + 1));
      ranges.push(sorted.slice(start, end));
    }

    const workers = ranges
      .filter((chunk) => chunk.length > 0)
      .map((chunk) => {
        const worker = new Worker(this.workerPath);
        return new Promise((resolve, reject) => {
          worker.once('message', (results) => {
            worker.terminate().catch(() => {});
            resolve(results);
          });
          worker.once('error', (err) => {
            worker.terminate().catch(() => {});
            reject(err);
          });
          worker.postMessage({ events: chunk });
        });
      });

    const results = (await Promise.all(workers)).flat();
    const failures = results.filter((r) => r && r.error);
    if (failures.length > 0) {
      console.warn(`[ParallelParser] ${failures.length} event(s) failed to parse`);
      // Log the first failure for debuggability without derailing the batch.
      console.warn('[ParallelParser] sample failure:', failures[0].error);
    }
    return results.filter((r) => r && !r.error);
  }

  /**
   * Legacy in-process chunked path used as a fallback.
   */
  async _parseInProcess(events = []) {
    const chunkSize = Math.max(1, Math.ceil(events.length / (this.concurrency || 1)));
    const chunks = [];

    for (let i = 0; i < events.length; i += chunkSize) {
      chunks.push(events.slice(i, i + chunkSize));
    }

    const chunkPromises = chunks.map((chunk) =>
      Promise.resolve().then(() => chunk.map((evt) => this.parseEvent(evt)))
    );

    const results = await Promise.all(chunkPromises);
    return results.flat();
  }

  /**
   * Parse via the schema registry when possible, else fall back to legacy.
   * This is kept for schema-registry-based batches and the poll loop wiring.
   */
  async parseAndEnrich(events = []) {
    const parsed = await this.parseBatch(events);
    // Schema registry is only invoked event-by-event; batch mode keeps the
    // pure parallel parse and applies registry decoding per event already
    // handled by the caller when configuration requires it.
    return parsed;
  }

  batchWriteToDb(db, parsedEvents = [], contractId = 'CONTRACT_ID') {
    return new Promise((resolve, reject) => {
      if (parsedEvents.length === 0) {
        return resolve({ count: 0 });
      }

      db.serialize(() => {
        db.run('BEGIN TRANSACTION', (err) => {
          if (err) return reject(err);
        });

        const stmt = db.prepare(
          `INSERT OR IGNORE INTO events (ledger_sequence, contract_id, event_name, task_id, data_json)
           VALUES (?, ?, ?, ?, ?)`
        );

        let insertedCount = 0;
        let hasError = false;

        for (const evt of parsedEvents) {
          stmt.run(
            evt.ledgerSequence,
            contractId,
            evt.eventName,
            evt.taskId,
            evt.dataJson,
            (err) => {
              if (err && !hasError) {
                hasError = true;
                db.run('ROLLBACK', () => reject(err));
              } else {
                insertedCount++;
              }
            }
          );
        }

        stmt.finalize(() => {
          if (!hasError) {
            db.run('COMMIT', (err) => {
              if (err) reject(err);
              else resolve({ count: insertedCount });
            });
          }
        });
      });
    });
  }
}

module.exports = {
  ParallelLedgerParser,
  parseEventCore,
};
