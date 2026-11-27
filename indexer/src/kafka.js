'use strict';

const EventEmitter = require('node:events');

const DEFAULT_TOPIC = process.env.KAFKA_EVENTS_TOPIC || 'sorotask.ledger.events';
const DEFAULT_DLQ_TOPIC = process.env.KAFKA_EVENTS_DLQ_TOPIC || 'sorotask.ledger.events.dlq';

/**
 * Fast FNV-1a 32-bit hash for deterministic partition assignment.
 * Keeps events for the same contract/task ordered on the same partition.
 *
 * @param {string} key
 * @param {number} partitionCount
 * @returns {number}
 */
function computePartition(key, partitionCount = 8) {
  const count = Math.max(1, Number(partitionCount) || 1);
  const str = String(key ?? 'default');
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % count;
}

/**
 * Derives a deterministic partition key from a blockchain event.
 *
 * @param {object} event
 * @returns {string}
 */
function derivePartitionKey(event) {
  if (!event || typeof event !== 'object') {
    return 'unknown';
  }
  if (event.partitionKey) return String(event.partitionKey);
  if (event.contract_id) return String(event.contract_id);
  if (event.contractId) return String(event.contractId);
  if (event.task_id != null) return `task:${event.task_id}`;
  if (event.ledger != null) return `ledger:${event.ledger}`;
  return 'default';
}

/**
 * Error thrown when the backpressure buffer rejects an event under overflow.
 */
class BackpressureError extends Error {
  constructor(message = 'Backpressure buffer capacity exceeded') {
    super(message);
    this.name = 'BackpressureError';
    this.code = 'ERR_BACKPRESSURE_OVERFLOW';
  }
}

/**
 * Bounded ring-like backpressure buffer that protects the indexer process
 * from unbounded memory growth and OOM crashes during traffic spikes.
 */
class BackpressureBuffer extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.maxSize=50000]
   * @param {number} [options.highWaterMarkRatio=0.8]
   * @param {number} [options.lowWaterMarkRatio=0.5]
   * @param {'reject'|'drop-oldest'|'block'} [options.overflowPolicy='reject']
   * @param {number} [options.blockTimeoutMs=5000]
   */
  constructor(options = {}) {
    super();
    this.maxSize = Math.max(1, options.maxSize ?? 50000);
    this.highWaterMark = Math.max(
      1,
      Math.floor(this.maxSize * (options.highWaterMarkRatio ?? 0.8))
    );
    this.lowWaterMark = Math.max(
      0,
      Math.floor(this.maxSize * (options.lowWaterMarkRatio ?? 0.5))
    );
    this.overflowPolicy = options.overflowPolicy || 'reject';
    this.blockTimeoutMs = options.blockTimeoutMs ?? 5000;

    this._queue = [];
    this._head = 0;
    this._pressured = false;
    this._waiters = [];

    this.stats = {
      enqueued: 0,
      dequeued: 0,
      dropped: 0,
      rejected: 0,
      highWaterHits: 0,
      peakSize: 0,
    };
  }

  get size() {
    return this._queue.length - this._head;
  }

  get isPressured() {
    return this._pressured;
  }

  /**
   * Push an item into the buffer, applying the configured overflow policy.
   *
   * @param {*} item
   * @returns {Promise<{ accepted: boolean, dropped?: boolean, reason?: string }>}
   */
  async push(item) {
    if (this.size >= this.maxSize) {
      if (this.overflowPolicy === 'drop-oldest') {
        this._head += 1;
        this._compactIfNeeded();
        this.stats.dropped += 1;
        this.emit('drop', { size: this.size, maxSize: this.maxSize });
      } else if (this.overflowPolicy === 'block') {
        const drained = await this._waitForDrain(this.blockTimeoutMs);
        if (!drained && this.size >= this.maxSize) {
          this.stats.rejected += 1;
          return { accepted: false, reason: 'backpressure_timeout' };
        }
      } else {
        this.stats.rejected += 1;
        this.emit('overflow', { size: this.size, maxSize: this.maxSize });
        return { accepted: false, reason: 'backpressure_overflow' };
      }
    }

    this._queue.push(item);
    this.stats.enqueued += 1;
    const currentSize = this.size;
    if (currentSize > this.stats.peakSize) {
      this.stats.peakSize = currentSize;
    }

    if (!this._pressured && currentSize >= this.highWaterMark) {
      this._pressured = true;
      this.stats.highWaterHits += 1;
      this.emit('highWaterMark', { size: currentSize, highWaterMark: this.highWaterMark });
    }

    return { accepted: true };
  }

  /**
   * Pop up to `count` items from the buffer in FIFO order.
   *
   * @param {number} count
   * @returns {Array<*>}
   */
  drain(count = 500) {
    const available = this.size;
    if (available === 0) return [];

    const take = Math.min(available, Math.max(1, count));
    const batch = this._queue.slice(this._head, this._head + take);
    this._head += take;
    this._compactIfNeeded();
    this.stats.dequeued += take;

    if (this._pressured && this.size <= this.lowWaterMark) {
      this._pressured = false;
      this.emit('lowWaterMark', { size: this.size, lowWaterMark: this.lowWaterMark });
    }

    if (this.size < this.maxSize && this._waiters.length > 0) {
      const waiters = this._waiters.splice(0, this._waiters.length);
      for (const resolve of waiters) {
        resolve(true);
      }
    }

    return batch;
  }

  _compactIfNeeded() {
    if (this._head > 0 && (this._head >= 1024 || this._head >= this._queue.length / 2)) {
      this._queue = this._queue.slice(this._head);
      this._head = 0;
    }
  }

  _waitForDrain(timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          const idx = this._waiters.indexOf(onDrain);
          if (idx !== -1) this._waiters.splice(idx, 1);
          resolve(false);
        }
      }, timeoutMs);
      if (timer.unref) timer.unref();

      const onDrain = (ok) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(ok);
        }
      };

      this._waiters.push(onDrain);
    });
  }

  getStats() {
    return {
      ...this.stats,
      size: this.size,
      maxSize: this.maxSize,
      isPressured: this._pressured,
    };
  }
}

/**
 * High-throughput in-memory partitioned message broker.
 * Provides Kafka-compatible partitioned topics, offset tracking, and
 * consumer-group batch delivery for local dev, fallback, and stress testing.
 */
class InMemoryPartitionedBroker extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.partitions=8]
   */
  constructor(options = {}) {
    super();
    this.partitions = Math.max(1, options.partitions ?? 8);
    this.topics = new Map();
    this.dlq = [];
    this.connected = false;
    this._subscribers = new Map();
  }

  async connect() {
    this.connected = true;
  }

  async disconnect() {
    this.connected = false;
  }

  _ensureTopic(topic) {
    if (!this.topics.has(topic)) {
      const partitionLogs = Array.from({ length: this.partitions }, () => []);
      this.topics.set(topic, partitionLogs);
    }
    return this.topics.get(topic);
  }

  /**
   * Publish a batch of messages to a topic, partitioned deterministically.
   *
   * @param {{ topic: string, messages: Array<{ key?: string, value: string|Buffer, partition?: number, headers?: object }> }} payload
   */
  async send({ topic, messages = [] }) {
    const partitionLogs = this._ensureTopic(topic);
    const byPartition = new Map();

    for (const msg of messages) {
      const partition =
        typeof msg.partition === 'number'
          ? ((msg.partition % this.partitions) + this.partitions) % this.partitions
          : computePartition(msg.key, this.partitions);

      const log = partitionLogs[partition];
      const offset = log.length;
      const record = {
        topic,
        partition,
        offset: String(offset),
        key: msg.key != null ? String(msg.key) : null,
        value: Buffer.isBuffer(msg.value) ? msg.value : Buffer.from(String(msg.value)),
        headers: msg.headers || {},
        timestamp: String(Date.now()),
      };
      log.push(record);

      if (!byPartition.has(partition)) {
        byPartition.set(partition, []);
      }
      byPartition.get(partition).push(record);
    }

    const subscribers = this._subscribers.get(topic);
    if (subscribers && subscribers.size > 0) {
      const deliveries = [];
      for (const subscriber of subscribers) {
        for (const [partition, records] of byPartition.entries()) {
          deliveries.push(subscriber({ topic, partition, messages: records }));
        }
      }
      await Promise.all(deliveries);
    }

    return {
      topic,
      published: messages.length,
    };
  }

  /**
   * Register a batch subscriber for a topic.
   *
   * @param {string} topic
   * @param {Function} handler
   * @returns {Function} unsubscribe function
   */
  subscribe(topic, handler) {
    this._ensureTopic(topic);
    if (!this._subscribers.has(topic)) {
      this._subscribers.set(topic, new Set());
    }
    this._subscribers.get(topic).add(handler);
    return () => {
      const set = this._subscribers.get(topic);
      if (set) set.delete(handler);
    };
  }

  getPartitionDepths(topic) {
    const logs = this.topics.get(topic);
    if (!logs) return [];
    return logs.map((l) => l.length);
  }
}

/**
 * Creates a KafkaJS or RabbitMQ adapter when configured and installed,
 * otherwise falls back to InMemoryPartitionedBroker.
 *
 * @param {object} [options]
 * @param {'kafka'|'rabbitmq'|'memory'} [options.transport='memory']
 * @param {string[]} [options.brokers]
 * @param {string} [options.clientId='sorotask-indexer']
 * @param {string} [options.amqpUrl]
 * @param {number} [options.partitions=8]
 */
function createBrokerAdapter(options = {}) {
  const transport = (options.transport || process.env.QUEUE_TRANSPORT || 'memory').toLowerCase();
  const partitions = Math.max(1, options.partitions ?? 8);

  if (transport === 'kafka') {
    try {
      const { Kafka } = require('kafkajs');
      const brokers = options.brokers || (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
      const kafka = new Kafka({
        clientId: options.clientId || 'sorotask-indexer',
        brokers,
      });
      const producer = kafka.producer({ allowAutoTopicCreation: true });
      return {
        type: 'kafka',
        partitions,
        connect: () => producer.connect(),
        disconnect: () => producer.disconnect(),
        send: (payload) => producer.send(payload),
        createConsumer: (groupId) => kafka.consumer({ groupId }),
      };
    } catch (_err) {
      // Fallback gracefully when kafkajs is not installed in this environment
    }
  }

  if (transport === 'rabbitmq') {
    try {
      const amqplib = require('amqplib');
      let connection = null;
      let channel = null;
      const amqpUrl = options.amqpUrl || process.env.RABBITMQ_URL || 'amqp://localhost';

      return {
        type: 'rabbitmq',
        partitions,
        async connect() {
          connection = await amqplib.connect(amqpUrl);
          channel = await connection.createConfirmChannel();
        },
        async disconnect() {
          if (channel) await channel.close();
          if (connection) await connection.close();
        },
        async send({ topic, messages = [] }) {
          await channel.assertExchange(topic, 'direct', { durable: true });
          for (const msg of messages) {
            const partition =
              typeof msg.partition === 'number'
                ? msg.partition
                : computePartition(msg.key, partitions);
            const buf = Buffer.isBuffer(msg.value) ? msg.value : Buffer.from(String(msg.value));
            channel.publish(topic, String(partition), buf, { persistent: true });
          }
          await channel.waitForConfirms();
          return { topic, published: messages.length };
        },
      };
    } catch (_err) {
      // Fallback gracefully when amqplib is not installed in this environment
    }
  }

  const memoryBroker = new InMemoryPartitionedBroker({ partitions });
  return {
    type: 'memory',
    partitions,
    broker: memoryBroker,
    connect: () => memoryBroker.connect(),
    disconnect: () => memoryBroker.disconnect(),
    send: (payload) => memoryBroker.send(payload),
    subscribe: (topic, handler) => memoryBroker.subscribe(topic, handler),
    getPartitionDepths: (topic) => memoryBroker.getPartitionDepths(topic),
  };
}

/**
 * Resilient, high-throughput event ingestion producer with micro-batching,
 * deterministic partitioning, bounded backpressure buffering, retry backoff,
 * and dead-letter queue (DLQ) routing.
 */
class EventIngestionProducer extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {object} [options.adapter] - Broker adapter with connect(), disconnect(), send()
   * @param {string} [options.topic]
   * @param {string} [options.dlqTopic]
   * @param {number} [options.partitions=8]
   * @param {number} [options.batchSize=500]
   * @param {number} [options.flushIntervalMs=10]
   * @param {number} [options.maxBufferSize=50000]
   * @param {'reject'|'drop-oldest'|'block'} [options.overflowPolicy='reject']
   * @param {number} [options.maxRetries=3]
   * @param {number} [options.retryBaseDelayMs=25]
   */
  constructor(options = {}) {
    super();
    this.partitions = Math.max(1, options.partitions ?? 8);
    this.adapter = options.adapter || createBrokerAdapter({ partitions: this.partitions });
    this.topic = options.topic || DEFAULT_TOPIC;
    this.dlqTopic = options.dlqTopic || DEFAULT_DLQ_TOPIC;
    this.batchSize = Math.max(1, options.batchSize ?? 500);
    this.flushIntervalMs = Math.max(1, options.flushIntervalMs ?? 10);
    this.maxRetries = Math.max(1, options.maxRetries ?? 3);
    this.retryBaseDelayMs = Math.max(1, options.retryBaseDelayMs ?? 25);

    this.buffer = new BackpressureBuffer({
      maxSize: options.maxBufferSize ?? 50000,
      highWaterMarkRatio: options.highWaterMarkRatio ?? 0.8,
      lowWaterMarkRatio: options.lowWaterMarkRatio ?? 0.5,
      overflowPolicy: options.overflowPolicy || 'reject',
      blockTimeoutMs: options.blockTimeoutMs ?? 5000,
    });

    this.buffer.on('highWaterMark', (info) => this.emit('backpressure', info));
    this.buffer.on('lowWaterMark', (info) => this.emit('drain', info));
    this.buffer.on('overflow', (info) => this.emit('overflow', info));

    this._flushTimer = null;
    this._flushing = false;
    this._connected = false;
    this._startedAt = null;

    this.metrics = {
      ingested: 0,
      published: 0,
      batchesFlushed: 0,
      dlqRouted: 0,
      errors: 0,
    };
  }

  async start() {
    if (this._connected) return;
    if (typeof this.adapter.connect === 'function') {
      await this.adapter.connect();
    }
    this._connected = true;
    this._startedAt = Date.now();
    this._flushTimer = setInterval(() => {
      if (this.buffer.size > 0 && !this._flushing) {
        this.flush().catch((err) => this.emit('error', err));
      }
    }, this.flushIntervalMs);
    if (this._flushTimer.unref) this._flushTimer.unref();
  }

  async stop() {
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
    await this.flushAll();
    if (this._connected && typeof this.adapter.disconnect === 'function') {
      await this.adapter.disconnect();
    }
    this._connected = false;
  }

  /**
   * Ingest a single blockchain event into the backpressure buffer.
   *
   * @param {object} event
   * @returns {Promise<{ accepted: boolean, partition?: number, reason?: string }>}
   */
  async ingest(event) {
    if (!event || typeof event !== 'object') {
      throw new Error('Event must be a non-null object');
    }

    const key = derivePartitionKey(event);
    const partition = computePartition(key, this.partitions);
    const envelope = {
      key,
      partition,
      value: JSON.stringify(event),
      headers: {
        'event-type': String(event.event_name || event.type || 'ledger_event'),
        'ingested-at': String(Date.now()),
      },
    };

    const result = await this.buffer.push(envelope);
    if (!result.accepted) {
      return result;
    }

    this.metrics.ingested += 1;

    if (this.buffer.size >= this.batchSize && !this._flushing) {
      // Trigger asynchronous micro-batch flush without blocking caller
      setImmediate(() => {
        this.flush().catch((err) => this.emit('error', err));
      });
    }

    return { accepted: true, partition };
  }

  /**
   * Ingest an array of events in bulk with backpressure enforcement.
   *
   * @param {object[]} events
   * @returns {Promise<{ accepted: number, rejected: number }>}
   */
  async ingestBatch(events = []) {
    let accepted = 0;
    let rejected = 0;

    for (let i = 0; i < events.length; i += 1) {
      const res = await this.ingest(events[i]);
      if (res.accepted) {
        accepted += 1;
      } else {
        rejected += 1;
      }
    }

    if (this.buffer.size >= this.batchSize && !this._flushing) {
      await this.flush();
    }

    return { accepted, rejected };
  }

  /**
   * Flush one micro-batch from the backpressure buffer to the broker.
   *
   * @returns {Promise<number>} number of messages published
   */
  async flush() {
    if (this._flushing || this.buffer.size === 0) return 0;
    this._flushing = true;

    try {
      const messages = this.buffer.drain(this.batchSize);
      if (messages.length === 0) return 0;

      await this._sendWithRetry(this.topic, messages);
      this.metrics.published += messages.length;
      this.metrics.batchesFlushed += 1;
      return messages.length;
    } finally {
      this._flushing = false;
    }
  }

  /**
   * Drain and flush all buffered events.
   *
   * @returns {Promise<number>} total messages published
   */
  async flushAll() {
    let total = 0;
    while (this.buffer.size > 0) {
      if (this._flushing) {
        await new Promise((r) => setImmediate(r));
        continue;
      }
      total += await this.flush();
    }
    return total;
  }

  async _sendWithRetry(topic, messages) {
    let lastError;
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      try {
        await this.adapter.send({ topic, messages });
        return;
      } catch (err) {
        lastError = err;
        this.metrics.errors += 1;
        if (attempt < this.maxRetries - 1) {
          const delay = this.retryBaseDelayMs * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    // Route failed batch to DLQ so ingestion never deadlocks
    try {
      const dlqMessages = messages.map((m) => ({
        key: m.key,
        value: JSON.stringify({
          original: m.value,
          error: lastError ? lastError.message : 'unknown_error',
          failedAt: new Date().toISOString(),
        }),
      }));
      await this.adapter.send({ topic: this.dlqTopic, messages: dlqMessages });
      this.metrics.dlqRouted += messages.length;
    } catch (_dlqErr) {
      // Emit error if DLQ itself is unreachable
      this.emit('dlqError', _dlqErr);
    }
  }

  getStats() {
    const elapsedSec = this._startedAt
      ? Math.max((Date.now() - this._startedAt) / 1000, 0.001)
      : 0;
    return {
      ...this.metrics,
      buffer: this.buffer.getStats(),
      throughputEps: elapsedSec > 0 ? Math.round(this.metrics.published / elapsedSec) : 0,
      topic: this.topic,
      partitions: this.partitions,
      transport: this.adapter.type || 'custom',
    };
  }
}

module.exports = {
  DEFAULT_TOPIC,
  DEFAULT_DLQ_TOPIC,
  computePartition,
  derivePartitionKey,
  BackpressureError,
  BackpressureBuffer,
  InMemoryPartitionedBroker,
  createBrokerAdapter,
  EventIngestionProducer,
};
