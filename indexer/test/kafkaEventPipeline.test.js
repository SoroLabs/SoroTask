'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computePartition,
  derivePartitionKey,
  BackpressureBuffer,
  createBrokerAdapter,
  EventIngestionProducer,
  DEFAULT_DLQ_TOPIC,
} = require('../src/kafka');

const {
  DeduplicationWindow,
  buildEventDedupeKey,
  SerializedBatchWriter,
  EventConsumerPool,
} = require('../src/eventConsumer');

test('computePartition is deterministic and stays within bounds', () => {
  const p1 = computePartition('C12345', 8);
  const p2 = computePartition('C12345', 8);
  assert.equal(p1, p2);
  assert.ok(p1 >= 0 && p1 < 8);
  assert.equal(derivePartitionKey({ contract_id: 'CABC' }), 'CABC');
  assert.equal(derivePartitionKey({ task_id: 42 }), 'task:42');
});

test('BackpressureBuffer enforces reject policy and emits high/low watermarks', async () => {
  const events = [];
  const buf = new BackpressureBuffer({
    maxSize: 10,
    highWaterMarkRatio: 0.8,
    lowWaterMarkRatio: 0.5,
    overflowPolicy: 'reject',
  });

  buf.on('highWaterMark', () => events.push('high'));
  buf.on('lowWaterMark', () => events.push('low'));
  buf.on('overflow', () => events.push('overflow'));

  for (let i = 0; i < 10; i += 1) {
    const res = await buf.push({ i });
    assert.equal(res.accepted, true);
  }
  assert.equal(buf.isPressured, true);

  // 11th item must be rejected without crashing
  const overflowRes = await buf.push({ i: 10 });
  assert.equal(overflowRes.accepted, false);
  assert.equal(overflowRes.reason, 'backpressure_overflow');

  // Drain below lowWaterMark
  const drained = buf.drain(6);
  assert.equal(drained.length, 6);
  assert.equal(buf.isPressured, false);
  assert.deepEqual(events, ['high', 'overflow', 'low']);
});

test('BackpressureBuffer supports drop-oldest overflow policy', async () => {
  const buf = new BackpressureBuffer({
    maxSize: 3,
    overflowPolicy: 'drop-oldest',
  });

  await buf.push(1);
  await buf.push(2);
  await buf.push(3);
  await buf.push(4);

  const items = buf.drain(10);
  assert.deepEqual(items, [2, 3, 4]);
  assert.equal(buf.getStats().dropped, 1);
});

test('DeduplicationWindow deduplicates and evicts bounded entries', () => {
  const win = new DeduplicationWindow({ maxEntries: 100 });
  for (let i = 0; i < 150; i += 1) {
    win.add(`evt-${i}`);
  }
  assert.ok(win.size <= 100);
  assert.equal(win.has('evt-149'), true);
  assert.equal(
    buildEventDedupeKey({ ledger: 10, tx_hash: '0xabc', event_name: 'TaskExecuted', event_index: 2 }),
    '10:0xabc:TaskExecuted:2'
  );
});

test('SerializedBatchWriter prevents database write-lock contention', async () => {
  let concurrentWriters = 0;
  let lockViolations = 0;
  let persistedCount = 0;

  const writer = new SerializedBatchWriter({
    concurrency: 1,
    persistBatch: async (events) => {
      concurrentWriters += 1;
      if (concurrentWriters > 1) {
        lockViolations += 1;
        throw new Error('SQLITE_BUSY: database is locked');
      }
      await new Promise((r) => setTimeout(r, 2));
      persistedCount += events.length;
      concurrentWriters -= 1;
    },
  });

  // Fire 20 concurrent partition writes simultaneously
  await Promise.all(
    Array.from({ length: 20 }, (_, i) => writer.enqueue([{ id: i }], { partition: i % 8 }))
  );

  assert.equal(lockViolations, 0);
  assert.equal(writer.writeLockContentions, 0);
  assert.equal(writer.maxObservedConcurrency, 1);
  assert.equal(persistedCount, 20);
});

test('Integration: producer -> partitioned broker -> consumer with deduplication and DLQ', async () => {
  const adapter = createBrokerAdapter({ transport: 'memory', partitions: 4 });
  const persisted = [];
  const dlqMessages = [];

  adapter.subscribe(DEFAULT_DLQ_TOPIC, async ({ messages }) => {
    dlqMessages.push(...messages);
  });

  const producer = new EventIngestionProducer({
    adapter,
    partitions: 4,
    batchSize: 50,
    flushIntervalMs: 5,
  });

  const consumer = new EventConsumerPool({
    adapter,
    dbWriteConcurrency: 1,
    persistBatch: async (events) => {
      persisted.push(...events);
    },
  });

  await producer.start();
  await consumer.start();

  // Ingest 5 unique events + 2 duplicates
  const baseEvents = [
    { event_id: 'e1', contract_id: 'C1', ledger: 100, event_name: 'TaskRegistered' },
    { event_id: 'e2', contract_id: 'C2', ledger: 100, event_name: 'TaskExecuted' },
    { event_id: 'e3', contract_id: 'C1', ledger: 101, event_name: 'KeeperPaid' },
    { event_id: 'e1', contract_id: 'C1', ledger: 100, event_name: 'TaskRegistered' }, // dup
    { event_id: 'e2', contract_id: 'C2', ledger: 100, event_name: 'TaskExecuted' }, // dup
  ];

  await producer.ingestBatch(baseEvents);
  await producer.flushAll();
  await consumer.drain();

  // Send a malformed message directly to consumer to verify DLQ routing
  await consumer.handlePartitionBatch({
    partition: 0,
    messages: [{ offset: '999', value: Buffer.from('{bad-json') }],
  });

  await producer.stop();
  await consumer.stop();

  const stats = consumer.getStats();
  assert.equal(persisted.length, 3);
  assert.equal(stats.processed, 3);
  assert.equal(stats.duplicates, 2);
  assert.equal(stats.malformed, 1);
  assert.equal(stats.dlqRouted, 1);
  assert.equal(dlqMessages.length, 1);
  assert.equal(stats.writeLockContentions, 0);
});

test('Stress test: sustained throughput >= 10,000 events/second with zero DB write-lock contention', async () => {
  const TOTAL_EVENTS = 25000;
  const PARTITIONS = 8;
  const adapter = createBrokerAdapter({ transport: 'memory', partitions: PARTITIONS });

  let persistedTotal = 0;
  let activeDbWriters = 0;
  let lockContentionDetected = 0;

  const producer = new EventIngestionProducer({
    adapter,
    partitions: PARTITIONS,
    batchSize: 1000,
    flushIntervalMs: 5,
    maxBufferSize: 50000,
    overflowPolicy: 'reject',
  });

  const consumer = new EventConsumerPool({
    adapter,
    dbWriteConcurrency: 1, // Single-writer serialization guarantees zero write-lock contention
    maxBatchSize: 1000,
    persistBatch: async (events) => {
      activeDbWriters += 1;
      if (activeDbWriters > 1) {
        lockContentionDetected += 1;
      }
      persistedTotal += events.length;
      activeDbWriters -= 1;
    },
  });

  await producer.start();
  await consumer.start();

  // Pre-build payloads to measure pipeline throughput cleanly
  const events = new Array(TOTAL_EVENTS);
  for (let i = 0; i < TOTAL_EVENTS; i += 1) {
    events[i] = {
      event_id: `stress-${i}`,
      contract_id: `C${i % 32}`,
      ledger: 50000 + (i >> 4),
      event_name: 'TaskExecuted',
      tx_hash: `tx-${i}`,
    };
  }

  const startMs = performance.now();
  const ingestResult = await producer.ingestBatch(events);
  await producer.flushAll();
  await consumer.drain();
  const elapsedSec = (performance.now() - startMs) / 1000;

  const throughputEps = Math.round(persistedTotal / elapsedSec);

  await producer.stop();
  await consumer.stop();

  const consumerStats = consumer.getStats();

  assert.equal(ingestResult.accepted, TOTAL_EVENTS);
  assert.equal(ingestResult.rejected, 0);
  assert.equal(persistedTotal, TOTAL_EVENTS);
  assert.equal(lockContentionDetected, 0);
  assert.equal(consumerStats.writeLockContentions, 0);
  assert.equal(consumerStats.maxObservedWriteConcurrency, 1);
  assert.ok(
    throughputEps >= 10000,
    `Expected sustained throughput >= 10,000 events/sec, got ${throughputEps} events/sec`
  );
});
