const { RAW_LEDGER_TOPIC, partitionKeyForLedgerEvent } = require("./topics");

/**
 * Publishes raw Stellar/Soroban ledger events to Kafka/Redpanda.
 * Accepts an injectable producer with `send({ topic, messages })`.
 */
class LedgerStreamProducer {
  /**
   * @param {object} options
   * @param {{ send: Function }} options.producer
   * @param {string} [options.topic]
   */
  constructor(options) {
    if (!options?.producer?.send) {
      throw new Error("Kafka producer with send() is required");
    }
    this.producer = options.producer;
    this.topic = options.topic || RAW_LEDGER_TOPIC;
  }

  async publishRawEvents(rawEvents = []) {
    if (!Array.isArray(rawEvents)) {
      throw new Error("rawEvents must be an array");
    }

    if (rawEvents.length === 0) {
      return { published: 0 };
    }

    const messages = rawEvents.map((event) => ({
      key: partitionKeyForLedgerEvent(event),
      value: JSON.stringify(event),
      headers: {
        source: "stellar-ledger-stream",
      },
    }));

    await this.producer.send({
      topic: this.topic,
      messages,
    });

    return { published: messages.length, topic: this.topic };
  }
}

module.exports = { LedgerStreamProducer };
