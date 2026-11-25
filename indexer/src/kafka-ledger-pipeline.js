'use strict';

const { Kafka, logLevel } = require('kafkajs');
const { createLogger } = require('./logger');

const DEFAULT_CONFIG = {
  clientId: 'sorotask-indexer',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  groupId: 'indexer-consumer-group',
  topic: 'ledger-events',
  deadLetterTopic: 'ledger-events-dlq',
  deduplicationWindowMs: 5 * 60 * 1000,
  maxRetries: 3,
  batchSize: 100,
  commitIntervalMs: 5000,
};

class DeduplicationCache {
  constructor(windowMs = 300000) {
    this.cache = new Map();
    this.windowMs = windowMs;
    this.cleanupInterval = setInterval(() => this.cleanup(), windowMs);
  }

  isDuplicate(key) {
    if (this.cache.has(key)) {
      return true;
    }
    this.cache.set(key, Date.now());
    return false;
  }

  cleanup() {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, timestamp] of this.cache) {
      if (timestamp < cutoff) {
        this.cache.delete(key);
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.cache.clear();
  }
}

class ConsumerOffsetCheckpoint {
  constructor(groupId) {
    this.groupId = groupId;
    this.checkpoints = new Map();
  }

  async checkpoint(partition, offset) {
    this.checkpoints.set(partition, {
      offset: offset + 1,
      timestamp: Date.now(),
    });
  }

  async getCheckpoint(partition) {
    return this.checkpoints.get(partition) || null;
  }

  async getAllCheckpoints() {
    return Object.fromEntries(this.checkpoints);
  }
}

class KafkaLedgerPipeline {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = createLogger('kafka-ledger-pipeline');
    this.kafka = new Kafka({
      clientId: this.config.clientId,
      brokers: this.config.brokers,
      logLevel: logLevel.WARN,
    });
    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
    });
    this.consumer = this.kafka.consumer({
      groupId: this.config.groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });
    this.deduplication = new DeduplicationCache(this.config.deduplicationWindowMs);
    this.offsetCheckpoint = new ConsumerOffsetCheckpoint(this.config.groupId);
    this.isProcessing = false;
    this.batchBuffer = [];
    this.lastCommitTime = Date.now();
  }

  async connect() {
    await this.producer.connect();
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.config.topic, fromBeginning: false });
    this.logger.info('Connected to Kafka', {
      brokers: this.config.brokers,
      topic: this.config.topic,
    });
  }

  async publishLedgerEvent(ledgerEvent) {
    const eventKey = `${ledgerEvent.sequence}-${ledgerEvent.hash}`;
    if (this.deduplication.isDuplicate(eventKey)) {
      this.logger.debug('Duplicate event skipped', { key: eventKey });
      return { published: false, reason: 'duplicate' };
    }

    try {
      const transaction = await this.producer.transaction();
      await transaction.send({
        topic: this.config.topic,
        messages: [
          {
            key: eventKey,
            value: JSON.stringify(ledgerEvent),
            partition: ledgerEvent.sequence % 4,
            timestamp: Date.now().toString(),
            headers: {
              'content-type': 'application/json',
              'event-type': ledgerEvent.type || 'unknown',
              'sequence': ledgerEvent.sequence.toString(),
            },
          },
        ],
      });
      await transaction.commit();
      this.logger.debug('Event published', { key: eventKey, sequence: ledgerEvent.sequence });
      return { published: true, key: eventKey };
    } catch (error) {
      this.logger.error('Failed to publish event', { error: error.message, key: eventKey });
      throw error;
    }
  }

  async processEvent(event, handler) {
    const eventKey = `${event.sequence}-${event.hash}`;
    if (this.deduplication.isDuplicate(eventKey)) {
      this.logger.debug('Duplicate event in consumer', { key: eventKey });
      return { processed: false, reason: 'duplicate' };
    }

    for (let retry = 0; retry < this.config.maxRetries; retry++) {
      try {
        const result = await handler(event);
        this.logger.debug('Event processed', { key: eventKey, retry });
        return { processed: true, result };
      } catch (error) {
        this.logger.warn('Event processing failed', {
          key: eventKey,
          retry,
          error: error.message,
        });
        if (retry === this.config.maxRetries - 1) {
          await this.sendToDeadLetterQueue(event, error);
          return { processed: false, reason: 'max_retries_exceeded' };
        }
        await this.delay(Math.pow(2, retry) * 1000);
      }
    }
  }

  async sendToDeadLetterQueue(event, error) {
    try {
      await this.producer.send({
        topic: this.config.deadLetterTopic,
        messages: [
          {
            key: `${event.sequence}-${event.hash}`,
            value: JSON.stringify({
              originalEvent: event,
              error: error.message,
              failedAt: new Date().toISOString(),
            }),
          },
        ],
      });
      this.logger.error('Event sent to DLQ', { key: `${event.sequence}-${event.hash}` });
    } catch (dlqError) {
      this.logger.error('Failed to send to DLQ', { error: dlqError.message });
    }
  }

  async startConsumer(handler) {
    await this.consumer.run({
      eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary }) => {
        for (const message of batch.messages) {
          const event = JSON.parse(message.value.toString());
          await this.processEvent(event, handler);
          await this.offsetCheckpoint.checkpoint(batch.partition, Number(message.offset));
          resolveOffset(message.offset);
          await heartbeat();
        }
      },
    });
    this.logger.info('Consumer started', { groupId: this.config.groupId });
  }

  async stop() {
    await this.producer.disconnect();
    await this.consumer.disconnect();
    this.deduplication.destroy();
    this.logger.info('Pipeline stopped');
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getStats() {
    return {
      deduplicationCacheSize: this.deduplication.cache.size,
      config: {
        clientId: this.config.clientId,
        brokers: this.config.brokers,
        topic: this.config.topic,
      },
    };
  }
}

module.exports = {
  KafkaLedgerPipeline,
  DeduplicationCache,
  ConsumerOffsetCheckpoint,
  DEFAULT_CONFIG,
};
