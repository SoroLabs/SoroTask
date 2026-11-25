'use strict';

const { parentPort } = require('node:worker_threads');
const { parseEventCore } = require('./parallelParser');

/**
 * Issue #797 worker-thread entry point.
 *
 * Each worker receives a contiguous range of raw Soroban contract events
 * (a slice of a ledger sequence range that the pool divided among workers)
 * and replies with the parsed events. A failed event never aborts the batch:
 * it is surfaced as { error } so the caller can log and continue, which
 * keeps high-throughput ingestion resilient.
 */
function handleRange(chunk) {
  const events = Array.isArray(chunk.events) ? chunk.events : [];
  const results = [];
  for (const evt of events) {
    try {
      results.push(parseEventCore(evt));
    } catch (err) {
      results.push({
        error: err.message,
        ledgerSequence: evt.ledgerSequence || evt.ledger || null,
      });
    }
  }
  return results;
}

if (parentPort) {
  parentPort.on('message', (msg) => {
    if (msg === 'shutdown') {
      parentPort.postMessage('done');
      return;
    }
    parentPort.postMessage(handleRange(msg));
  });
}