const { LedgerStreamProducer } = require("./ledgerProducer");
const { LedgerEventConsumerWorker } = require("./ledgerConsumer");

/**
 * Factory for KafkaJS clients when the dependency is installed.
 * Returns null when kafkajs is unavailable (unit tests use injectable mocks).
 */
function createKafkaClients({ brokers, clientId = "sorotask-indexer" } = {}) {
  if (!brokers || brokers.length === 0) {
    return null;
  }

  let Kafka;
  try {
    ({ Kafka } = require("kafkajs"));
  } catch (_err) {
    return null;
  }

  const kafka = new Kafka({ clientId, brokers });
  return {
    kafka,
    createProducer: () => kafka.producer(),
    createConsumer: (groupId) => kafka.consumer({ groupId }),
  };
}

module.exports = {
  createKafkaClients,
  LedgerStreamProducer,
  LedgerEventConsumerWorker,
};
