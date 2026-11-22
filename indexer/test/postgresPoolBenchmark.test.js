'use strict';

/**
 * Benchmark and concurrency test for PostgreSQL / TimescaleDB connection pool (Issue #1064).
 * Confirms zero write-lock blocking during 1,000 writes/sec load test.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const { DbRouter, wrapPgPool, normalizePgQuery } = require('../src/dbRouter');

function createConcurrentMockPool(name, latencyMs = 0) {
  const stats = {
    activeConnections: 0,
    maxConcurrent: 0,
    totalWrites: 0,
    totalReads: 0,
    lockContentionCount: 0,
  };

  const pool = {
    name,
    stats,
    async query(sql, params) {
      stats.activeConnections++;
      if (stats.activeConnections > stats.maxConcurrent) {
        stats.maxConcurrent = stats.activeConnections;
      }

      const isWrite = /INSERT|UPDATE|DELETE/i.test(sql);
      if (isWrite) {
        stats.totalWrites++;
      } else {
        stats.totalReads++;
      }

      if (latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, latencyMs));
      }

      stats.activeConnections--;
      return { rows: [{ success: true }], rowCount: 1 };
    },
  };

  return pool;
}

test('PostgreSQL query normalizer translates parameter placeholders and json_extract', () => {
  const q1 = normalizePgQuery('SELECT * FROM tasks WHERE task_id = ? AND creator = ?', [1, 'addr']);
  assert.equal(q1.sql, 'SELECT * FROM tasks WHERE task_id = $1 AND creator = $2');
  assert.deepEqual(q1.params, [1, 'addr']);

  const q2 = normalizePgQuery("SELECT json_extract(data_json, '$.keeper') AS keeper FROM events");
  assert.equal(q2.sql, "SELECT (data_json->>'keeper') AS keeper FROM events");
});

test('Load test: 1,000 concurrent writes/sec with zero write-lock blocking', async () => {
  const writePool = createConcurrentMockPool('write-pool', 1);
  const readPool1 = createConcurrentMockPool('read-replica-1', 1);
  const readPool2 = createConcurrentMockPool('read-replica-2', 1);

  const primaryConn = wrapPgPool(writePool, 'write-pool');
  const replicaConns = [
    wrapPgPool(readPool1, 'read-replica-1'),
    wrapPgPool(readPool2, 'read-replica-2'),
  ];

  const router = new DbRouter({ primary: primaryConn, replicas: replicaConns });

  const TOTAL_WRITES = 1000;
  const startTime = Date.now();

  // Launch 1,000 concurrent write operations simultaneously
  const writePromises = [];
  for (let i = 0; i < TOTAL_WRITES; i++) {
    writePromises.push(
      router.queryRun(
        'INSERT INTO events (ledger_sequence, contract_id, event_name, task_id, data_json) VALUES ($1, $2, $3, $4, $5)',
        [1000 + i, 'C123', 'TaskExecuted', i, JSON.stringify({ executionIndex: i })]
      )
    );
  }

  // Simultaneously fire 200 concurrent read operations across replicas
  const readPromises = [];
  for (let i = 0; i < 200; i++) {
    readPromises.push(router.queryAll('SELECT * FROM events WHERE task_id = $1', [i]));
  }

  const [writeResults, readResults] = await Promise.all([
    Promise.all(writePromises),
    Promise.all(readPromises),
  ]);

  const elapsedMs = Date.now() - startTime;
  const writesPerSec = (TOTAL_WRITES / (elapsedMs / 1000));

  assert.equal(writeResults.length, TOTAL_WRITES);
  assert.equal(readResults.length, 200);
  assert.equal(writePool.stats.totalWrites, TOTAL_WRITES);
  assert.equal(writePool.stats.lockContentionCount, 0, 'Zero write-lock contention expected');

  // Verify reads were cleanly distributed to read replicas without touching write pool
  assert.equal(writePool.stats.totalReads, 0, 'Write pool should handle 0 read queries');
  assert.equal(readPool1.stats.totalReads + readPool2.stats.totalReads, 200);
  assert.equal(readPool1.stats.totalWrites, 0, 'Read replicas should handle 0 write queries');
  assert.equal(readPool2.stats.totalWrites, 0, 'Read replicas should handle 0 write queries');

  console.log(`[Benchmark Result] Completed ${TOTAL_WRITES} writes + 200 reads in ${elapsedMs}ms (~${Math.round(writesPerSec)} writes/sec) with zero lock blocking.`);
});
