'use strict';

const EventEmitter = require('node:events');
const { DEFAULT_TOPIC, DEFAULT_DLQ_TOPIC } = require('./kafka');

/**
 * Bounded deduplication window to prevent duplicate event persistence
 * under Kafka/RabbitMQ at-least-once delivery semantics without leaking memory.
 */
class DeduplicationWindow {
  /**
   * @param {object} [options]
   * @param {number} [options.maxEntries=100000]
   */
  constructor(options = {}) {
    this.maxEntries = Math.max(100, options.maxEntries ?? 100000);
    this._seen = new Set();
  }

  has(key) {
    return this._seen.has(key);
  }

  add(key) {
    if (this._seen.size >= this.maxEntries) {
      // Evict oldest 10% to keep insertion O(1) amortized
      const evictCount = Math.max(1, Math.floor(this.maxEntries * 0.1));
      let removed = 0;
      for (const oldest of this._seen) {
        this._seen.delete(oldest);
        removed += 1;
        if (removed >= evictCount) break;
      }
    }
    this._seen.add(key);
  }

  get size() {
    return this._seen.size;
  }

  clear() {
    this._seen.clear();
  }
}

/**
 * Derives a stable idempotency key for a blockchain event.
 *
 * @param {object} event
 * @param {object} [meta]
 * @returns {string}
 */
function buildEventDedupeKey(event, meta = {}) {
  if (event && event.event_id != null) return String(event.event_id);
  if (event && event.id != null) return String(event.id);
  const ledger = event?.ledger ?? event?.sequence ?? '0';
  const tx = event?.tx_hash ?? event?.hash ?? 'no-tx';
  const name = event?.event_name ?? event?.type ?? 'evt';
  const idx = event?.event_index ?? meta.offset ?? '0';
  return `${ledger}:${tx}:${name}:${idx}`;
}

/**
 * Serializes database batch writes across partitions so that:
 *  - SQLite / single-writer databases experience ZERO write-lock contention
 *    (dbWriteConcurrency = 1)
 *  - Partitioned PostgreSQL databases can write in parallel per partition
 *    without overlapping rows (dbWriteConcurrency = N)
 */
class SerializedBatchWriter {
  /**
   * @param {object} options
   * @param {(events: object[], meta: { partition: number }) => Promise<void>} options.persistBatch
   * @param {number} [options.concurrency=1]
   */
  constructor(options) {
    if (typeof options?.persistBatch !== 'function') {
      throw new Error('persistBatch function is required');
    }
    this.persistBatch = options.persistBatch;
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this._active = 0;
    this._queue = [];
    this.maxObservedConcurrency = 0;
    this.writeLockContentions = 0;
  }

  /**
   * Enqueue a batch write and wait for it to complete.
   *
   * @param {object[]} events
   * @param {{ partition: number }} meta
   * @returns {Promise<void>}
   */
  enqueue(events, meta) {
    if (!events || events.length === 0) return Promise.resolve();

    return new Promise((resolve, reject) => {
      this._queue.push({ events, meta, resolve, reject });
      this._drain();
    });
  }

  _drain() {
    while (this._active < this.concurrency && this._queue.length > 0) {
      const task = this._queue.shift();
      this._active += 1;
      if (this._active > this.maxObservedConcurrency) {
        this.maxObservedConcurrency = this._active;
      }

      Promise.resolve()
        .then(() => this.persistBatch(task.events, task.meta))
        .then(
          () => {
            this._active -= 1;
            task.resolve();
            this._drain();
          },
          (err) => {
            this._active -= 1;
            if (err && /SQLITE_BUSY|lock|deadlock/i.test(String(err.message))) {
              this.writeLockContentions += 1;
            }
            task.reject(err);
            this._drain();
          }
        );
    }
  }

  get pendingCount() {
    return this._queue.length;
  }

  get activeCount() {
    return this._active;
  }
}

/**
 * Partitioned high-throughput event consumer worker pool.
 * Decouples message consumption from database persistence via per-partition
 * micro-batching and a serialized batch writer to eliminate DB write-lock contention.
 */
class EventConsumerPool extends EventEmitter {
  /**
   * @param {object} options
   * @param {object} options.adapter - Broker adapter (with subscribe() or createConsumer())
   * @param {(events: object[], meta: { partition: number }) => Promise<void>} options.persistBatch
   * @param {(rawEvent: object) => object} [options.transformEvent]
   * @param {string} [options.topic]
   * @param {string} [options.dlqTopic]
   * @param {string} [options.groupId='sorotask-indexer-consumers']
   * @param {number} [options.dbWriteConcurrency=1]
   * @param {number} [options.maxBatchSize=500]
   * @param {number} [options.maxRetries=3]
   * @param {number} [options.retryBaseDelayMs=20]
   * @param {number} [options.maxDedupeEntries=100000]
   * @param {number} [options.maxPendingBatches=200]
   */
  constructor(options) {
    super();
    if (!options?.adapter) {
      throw new Error('Broker adapter is required');
    }
    if (typeof options?.persistBatch !== 'function') {
      throw new Error('persistBatch function is required');
    }

    this.adapter = options.adapter;
    this.topic = options.topic || DEFAULT_TOPIC;
    this.dlqTopic = options.dlqTopic || DEFAULT_DLQ_TOPIC;
    this.groupId = options.groupId || 'sorotask-indexer-consumers';
    this.transformEvent = options.transformEvent || ((e) => e);
    this.maxBatchSize = Math.max(1, options.maxBatchSize ?? 500);
    this.maxRetries = Math.max(1, options.maxRetries ?? 3);
    this.retryBaseDelayMs = Math.max(1, options.retryBaseDelayMs ?? 20);
    this.maxPendingBatches = Math.max(1, options.maxPendingBatches ?? 200);

    this.writer = new SerializedBatchWriter({
      persistBatch: options.persistBatch,
      concurrency: options.dbWriteConcurrency ?? 1,
    });
    this.dedupe = new DeduplicationWindow({
      maxEntries: options.maxDedupeEntries ?? 100000,
    });

    this.offsets = new Map();
    this._unsubscribe = null;
    this._kafkaConsumer = null;
    this._running = false;
    this._startedAt = null;
    this._inFlight = new Set();

    this.metrics = {
      received: 0,
      processed: 0,
      duplicates: 0,
      malformed: 0,
      batchesPersisted: 0,
      dlqRouted: 0,
      retries: 0,
    };
  }

  async start() {
    if (this._running) return;
    this._running = true;
    this._startedAt = Date.now();

    if (typeof this.adapter.subscribe === 'function') {
      this._unsubscribe = this.adapter.subscribe(this.topic, (batch) =>
        this.handlePartitionBatch(batch)
      );
      return;
    }

    if (typeof this.adapter.createConsumer === 'function') {
      this._kafkaConsumer = this.adapter.createConsumer(this.groupId);
      await this._kafkaConsumer.connect();
      await this._kafkaConsumer.subscribe({ topic: this.topic, fromBeginning: false });
      await this._kafkaConsumer.run({
        eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
          await this.handlePartitionBatch({
            topic: batch.topic,
            partition: batch.partition,
            messages: batch.messages,
          });
          for (const msg of batch.messages) {
            resolveOffset(msg.offset);
          }
          await heartbeat();
        },
      });
    }
  }

  async stop() {
    this._running = false;
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (this._kafkaConsumer) {
      await this._kafkaConsumer.disconnect();
      this._kafkaConsumer = null;
    }
    await this.drain();
  }

  /**
   * Wait until all in-flight partition batches have finished persisting.
   */
  async drain() {
    while (this._inFlight.size > 0) {
      await Promise.all(Array.from(this._inFlight));
    }
  }

  /**
   * Process a batch of messages from a single partition.
   *
   * @param {{ topic?: string, partition: number, messages: Array<{ value: Buffer|string, offset?: string }> }} batch
   */
  async handlePartitionBatch(batch) {
    const task = this._processPartitionBatch(batch);
    this._inFlight.add(task);
    try {
      await task;
    } finally {
      this._inFlight.delete(task);
    }
  }

  async _processPartitionBatch({ partition = 0, messages = [] }) {
    if (!messages || messages.length === 0) return;

    this.metrics.received += messages.length;
    const parsedEvents = [];
    let lastOffset = null;

    for (const msg of messages) {
      lastOffset = msg.offset ?? lastOffset;
      let raw;
      try {
        const text = Buffer.isBuffer(msg.value) ? msg.value.toString('utf8') : String(msg.value);
        raw = JSON.parse(text);
      } catch (_err) {
        this.metrics.malformed += 1;
        await this._sendToDlq(msg, new Error('Malformed JSON payload'));
        continue;
      }

      const dedupeKey = buildEventDedupeKey(raw, { offset: msg.offset });
      if (this.dedupe.has(dedupeKey)) {
        this.metrics.duplicates += 1;
        continue;
      }

      try {
        const transformed = this.transformEvent(raw);
        this.dedupe.add(dedupeKey);
        parsedEvents.push(transformed);
      } catch (err) {
        this.metrics.malformed += 1;
        await this._sendToDlq(msg, err);
      }
    }

    // Chunk into maxBatchSize slices and write via serialized writer
    for (let i = 0; i < parsedEvents.length; i += this.maxBatchSize) {
      const slice = parsedEvents.slice(i, i + this.maxBatchSize);
      await this._persistWithRetry(slice, { partition });
    }

    if (lastOffset != null) {
      this.offsets.set(partition, Number(lastOffset) + 1);
    }
  }

  async _persistWithRetry(events, meta) {
    let lastError;
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      try {
        await this.writer.enqueue(events, meta);
        this.metrics.processed += events.length;
        this.metrics.batchesPersisted += 1;
        return;
      } catch (err) {
        lastError = err;
        this.metrics.retries += 1;
        if (attempt < this.maxRetries - 1) {
          const delay = this.retryBaseDelayMs * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    // Route failed batch to DLQ
    for (const evt of events) {
      await this._sendToDlq({ value: JSON.stringify(evt) }, lastError);
    }
  }

  async _sendToDlq(msg, error) {
    this.metrics.dlqRouted += 1;
    if (typeof this.adapter.send === 'function') {
      try {
        await this.adapter.send({
          topic: this.dlqTopic,
          messages: [
            {
              key: msg.key || 'dlq',
              value: JSON.stringify({
                payload: Buffer.isBuffer(msg.value) ? msg.value.toString('utf8') : msg.value,
                error: error ? error.message : 'unknown_error',
                failedAt: new Date().toISOString(),
              }),
            },
          ],
        });
      } catch (_err) {
        this.emit('dlqError', _err);
      }
    }
  }

  getStats() {
    const elapsedSec = this._startedAt
      ? Math.max((Date.now() - this._startedAt) / 1000, 0.001)
      : 0;
    return {
      ...this.metrics,
      writeLockContentions: this.writer.writeLockContentions,
      maxObservedWriteConcurrency: this.writer.maxObservedConcurrency,
      dedupeCacheSize: this.dedupe.size,
      offsets: Object.fromEntries(this.offsets),
      throughputEps: elapsedSec > 0 ? Math.round(this.metrics.processed / elapsedSec) : 0,
    };
  }
}

module.exports = {
  DeduplicationWindow,
  buildEventDedupeKey,
  SerializedBatchWriter,
  EventConsumerPool,
};
