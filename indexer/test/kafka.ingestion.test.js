const assert = require("node:assert/strict");
const test = require("node:test");

const { RAW_LEDGER_TOPIC, partitionKeyForLedgerEvent } = require("../src/kafka/topics");
const { buildIngestionEventId, IngestionIdempotencyStore } = require("../src/kafka/idempotency");
const { LedgerStreamProducer } = require("../src/kafka/ledgerProducer");
const { LedgerEventConsumerWorker } = require("../src/kafka/ledgerConsumer");

test("partitionKeyForLedgerEvent uses ledger and contract", () => {
  const key = partitionKeyForLedgerEvent({
    ledger: 100,
    contract_id: "C123",
  });
  assert.equal(key, "100:C123");
});

test("ledger producer publishes raw events to kafka topic", async () => {
  const sent = [];
  const producer = {
    send: async (payload) => {
      sent.push(payload);
    },
  };

  const streamProducer = new LedgerStreamProducer({ producer });
  const result = await streamProducer.publishRawEvents([
    { ledger: 1, contract_id: "C1", event_name: "TaskRegistered" },
    { ledger: 2, contract_id: "C2", event_name: "KeeperPaid" },
  ]);

  assert.equal(result.published, 2);
  assert.equal(sent[0].topic, RAW_LEDGER_TOPIC);
  assert.equal(sent[0].messages.length, 2);
  assert.equal(sent[0].messages[0].key, "1:C1");
});

test("consumer worker parses and persists events with idempotency", async () => {
  const persisted = [];
  const idempotency = new IngestionIdempotencyStore();
  let handler;

  const consumer = {
    run: async ({ eachMessage }) => {
      handler = eachMessage;
    },
  };

  const worker = new LedgerEventConsumerWorker({
    consumer,
    groupId: "worker-a",
    idempotency,
    parseEvent: async (raw) => ({ ...raw, parsed: true }),
    persistEvent: async (parsed) => {
      persisted.push(parsed);
    },
  });

  await worker.start();

  const raw = {
    ledger: 10,
    contract_id: "C9",
    event_name: "KeeperPaid",
    tx_hash: "tx-1",
  };

  await handler({
    message: { value: Buffer.from(JSON.stringify(raw)) },
  });
  await handler({
    message: { value: Buffer.from(JSON.stringify(raw)) },
  });

  assert.equal(persisted.length, 1);
  const stats = worker.getStats();
  assert.equal(stats.processed, 1);
  assert.equal(stats.duplicates, 1);
});

test("multiple consumer workers can share idempotency state", async () => {
  const idempotency = new IngestionIdempotencyStore();
  const persisted = [];

  async function createWorker(name) {
    let handler;
    const consumer = {
      run: async ({ eachMessage }) => {
        handler = eachMessage;
      },
    };

    const worker = new LedgerEventConsumerWorker({
      consumer,
      groupId: name,
      idempotency,
      parseEvent: (raw) => raw,
      persistEvent: (parsed) => {
        persisted.push(parsed);
      },
    });
    await worker.start();
    return handler;
  }

  const workerA = await createWorker("worker-a");
  const workerB = await createWorker("worker-b");

  const raw = {
    ledger: 44,
    contract_id: "C44",
    event_name: "GasDeposited",
    tx_hash: "tx-44",
  };

  await workerA({ message: { value: Buffer.from(JSON.stringify(raw)) } });
  await workerB({ message: { value: Buffer.from(JSON.stringify(raw)) } });

  assert.equal(persisted.length, 1);
});

test("consumer worker counts malformed payloads as failures", async () => {
  let handler;
  const consumer = {
    run: async ({ eachMessage }) => {
      handler = eachMessage;
    },
  };

  const worker = new LedgerEventConsumerWorker({
    consumer,
    parseEvent: (raw) => raw,
    persistEvent: async () => {},
  });

  await worker.start();
  await handler({ message: { value: Buffer.from("not-json") } });
  assert.equal(worker.getStats().failures, 1);
});

test("buildIngestionEventId is stable for identical payloads", () => {
  const raw = {
    ledger: 1,
    contract_id: "C1",
    tx_hash: "abc",
    event_name: "TaskRegistered",
  };
  assert.equal(buildIngestionEventId(raw), buildIngestionEventId(raw));
});
