const assert = require("node:assert/strict");
const test = require("node:test");

const { CHAIN_IDS, DRIVER_NAMES } = require("../src/chains/chainIds");
const { normalizeUnifiedEvent } = require("../src/chains/unifiedEvent");
const {
  ingestRawEvents,
  stellarRpcDriver,
  sorobanRpcDriver,
  evmJsonRpcDriver,
} = require("../src/chains/drivers");
const {
  resetCrossChainEventStore,
  storeUnifiedEvents,
} = require("../src/chains/eventStore");
const { buildCrossChainTimeline } = require("../src/chains/timeline");

test.beforeEach(() => {
  resetCrossChainEventStore();
});

test("normalizeUnifiedEvent requires chain_id and tx_hash", () => {
  assert.throws(() => normalizeUnifiedEvent({}), /chain_id is required/);
  assert.throws(
    () => normalizeUnifiedEvent({ chain_id: CHAIN_IDS.SOROBAN_TESTNET }),
    /tx_hash is required/,
  );
});

test("stellar RPC driver normalizes classic transaction events", () => {
  const event = stellarRpcDriver.normalize({
    tx_hash: "abc123",
    ledger: 12345,
    type: "payment",
    account: "GABC",
    created_at: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(event.chain_id, CHAIN_IDS.STELLAR_TESTNET);
  assert.equal(event.tx_hash, "abc123");
  assert.equal(event.driver, DRIVER_NAMES.STELLAR_RPC);
  assert.equal(event.ledger_sequence, 12345);
});

test("stellar RPC driver normalizes classic mainnet events", () => {
  const event = stellarRpcDriver.normalize({
    chain_id: CHAIN_IDS.STELLAR_CLASSIC,
    tx_hash: "classic_tx_789",
    ledger: 99999,
    type: "payment",
    account: "GCLASSIC",
  });

  assert.equal(event.chain_id, CHAIN_IDS.STELLAR_CLASSIC);
  assert.equal(event.tx_hash, "classic_tx_789");
  assert.equal(event.driver, DRIVER_NAMES.STELLAR_RPC);
});

test("soroban RPC driver normalizes contract events on mainnet", () => {
  const event = sorobanRpcDriver.normalize({
    chain_id: CHAIN_IDS.SOROBAN_MAINNET,
    ledger: 999,
    contract_id: "C123",
    event_name: "KeeperPaid",
    tx_hash: "0xsoroban_mainnet",
    task_id: 7,
  });

  assert.equal(event.chain_id, CHAIN_IDS.SOROBAN_MAINNET);
  assert.equal(event.tx_hash, "0xsoroban_mainnet");
  assert.equal(event.event_name, "KeeperPaid");
  assert.equal(event.payload.task_id, 7);
});

test("EVM JsonRPC driver normalizes eth_getLogs entries", () => {
  const event = evmJsonRpcDriver.normalize({
    transactionHash: "0xdeadbeef",
    address: "0xcontract",
    topics: ["TaskExecuted"],
    blockNumber: "0x10",
    data: "0x01",
    logIndex: 2,
    chain_id: CHAIN_IDS.EVM_SEPOLIA,
  });

  assert.equal(event.chain_id, CHAIN_IDS.EVM_SEPOLIA);
  assert.equal(event.tx_hash, "0xdeadbeef");
  assert.equal(event.block_number, 16);
  assert.equal(event.payload.log_index, 2);
});

test("ingestRawEvents reports malformed records without failing the batch", () => {
  const { normalized, errors } = ingestRawEvents(DRIVER_NAMES.STELLAR_RPC, [
    { tx_hash: "ok", type: "payment", ledger: 1 },
    { ledger: 2 },
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /tx_hash/);
});

test("cross-chain timeline aggregates and paginates events", () => {
  const { normalized } = ingestRawEvents(DRIVER_NAMES.SOROBAN_RPC, [
    {
      ledger: 1,
      contract_id: "C1",
      event_name: "A",
      tx_hash: "tx-a",
      occurred_at: "2026-01-02T00:00:00.000Z",
    },
    {
      ledger: 2,
      contract_id: "C1",
      event_name: "B",
      tx_hash: "tx-b",
      occurred_at: "2026-01-03T00:00:00.000Z",
    },
  ]);

  const { normalized: evmEvents } = ingestRawEvents(DRIVER_NAMES.EVM_JSONRPC, [
    {
      transactionHash: "0xevm",
      address: "0xabc",
      topics: ["Execution"],
      blockNumber: 42,
      chain_id: CHAIN_IDS.EVM_SEPOLIA,
      occurred_at: "2026-01-04T00:00:00.000Z",
    },
  ]);

  storeUnifiedEvents([...normalized, ...evmEvents]);

  const page1 = buildCrossChainTimeline({ limit: 2 });
  assert.equal(page1.events.length, 2);
  assert.equal(page1.events[0].tx_hash, "0xevm");
  assert.ok(page1.pagination.next_cursor);

  const page2 = buildCrossChainTimeline({
    limit: 2,
    cursor: page1.pagination.next_cursor,
  });
  assert.equal(page2.events.length, 1);

  const sorobanOnly = buildCrossChainTimeline({
    chain_id: CHAIN_IDS.SOROBAN_TESTNET,
  });
  assert.equal(sorobanOnly.events.length, 2);
  assert.ok(sorobanOnly.events.every((event) => event.chain_id === CHAIN_IDS.SOROBAN_TESTNET));
});
