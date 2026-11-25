'use strict';
const { Kafka } = require('kafkajs');
const { createLogger } = require('./logger');

class DistributedKafkaPipeline {
  constructor(config = {}) {
    this.logger = createLogger('kafka-pipeline-v2');
    this.kafka = new Kafka({
      clientId: config.clientId || 'sorotask-indexer-v2',
      brokers: config.brokers || ['localhost:9092'],
    });
    this.producer = this.kafka.producer({ allowAutoTopicCreation: true });
    this.consumer = this.kafka.consumer({
      groupId: config.groupId || 'indexer-consumer-v2',
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });
    this.dedupCache = new Map();
    this.offsetCheckpoints = new Map();
  }

  async connect() {
    await this.producer.connect();
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: 'ledger-events', fromBeginning: false });
  }

  async publishLedgerBlock(block) {
    const key = `${block.sequence}-${block.hash}`;
    if (this.dedupCache.has(key)) return { published: false, reason: 'duplicate' };
    await this.producer.send({
      topic: 'ledger-events',
      messages: [{ key, value: JSON.stringify(block) }],
    });
    this.dedupCache.set(key, Date.now());
    return { published: true, key };
  }

  async startConsumer(handler) {
    await this.consumer.run({
      eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
        for (const msg of batch.messages) {
          const event = JSON.parse(msg.value.toString());
          await handler(event);
          resolveOffset(msg.offset);
          this.offsetCheckpoints.set(batch.partition, Number(msg.offset));
          await heartbeat();
        }
      },
    });
  }
}
module.exports = { DistributedKafkaPipeline };
