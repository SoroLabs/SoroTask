const { buildIngestionEventId, IngestionIdempotencyStore } = require("./idempotency");

/**
 * Consumer-group worker that parses raw ledger Kafka messages into indexed events.
 * The Kafka client is injectable for tests.
 */
class LedgerEventConsumerWorker {
  /**
   * @param {object} options
   * @param {object} options.consumer - object with run({ eachMessage })
   * @param {(rawEvent: object) => Promise<object>|object} options.parseEvent
   * @param {(parsedEvent: object) => Promise<void>|void} options.persistEvent
   * @param {IngestionIdempotencyStore} [options.idempotency]
   * @param {string} [options.groupId]
   */
  constructor(options) {
    if (!options?.consumer?.run) {
      throw new Error("Kafka consumer with run() is required");
    }
    if (typeof options.parseEvent !== "function") {
      throw new Error("parseEvent function is required");
    }
    if (typeof options.persistEvent !== "function") {
      throw new Error("persistEvent function is required");
    }

    this.consumer = options.consumer;
    this.parseEvent = options.parseEvent;
    this.persistEvent = options.persistEvent;
    this.idempotency = options.idempotency || new IngestionIdempotencyStore();
    this.groupId = options.groupId || "indexer-ledger-parsers";
    this.processed = 0;
    this.duplicates = 0;
    this.failures = 0;
  }

  async start() {
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        if (!message?.value) return;
        let rawEvent;
        try {
          rawEvent = JSON.parse(message.value.toString());
        } catch (_err) {
          this.failures += 1;
          return;
        }

        const eventId = buildIngestionEventId(rawEvent);
        if (this.idempotency.has(eventId)) {
          this.duplicates += 1;
          return;
        }

        try {
          const parsed = await this.parseEvent(rawEvent);
          await this.persistEvent(parsed);
          this.idempotency.mark(eventId);
          this.processed += 1;
        } catch (_err) {
          this.failures += 1;
          throw _err;
        }
      },
    });
  }

  getStats() {
    return {
      groupId: this.groupId,
      processed: this.processed,
      duplicates: this.duplicates,
      failures: this.failures,
    };
  }
}

module.exports = { LedgerEventConsumerWorker };
