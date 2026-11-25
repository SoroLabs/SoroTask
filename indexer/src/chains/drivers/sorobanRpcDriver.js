const { CHAIN_IDS, DRIVER_NAMES } = require("../chainIds");
const { normalizeUnifiedEvent } = require("../unifiedEvent");

/**
 * Normalizes Soroban contract events from Soroban RPC getEvents payloads.
 * Expected raw shape:
 * { chain_id?, tx_hash?, id?, ledger, contract_id, topic?, value?, event_name?, task_id? }
 */
function normalizeSorobanRpcEvent(raw, options = {}) {
  const ledger = raw.ledger ?? raw.ledgerSequence ?? raw.ledger_sequence;
  if (ledger === undefined || ledger === null) {
    throw new Error("SorobanRPC event missing ledger sequence");
  }

  const tx_hash =
    raw.tx_hash ||
    raw.transactionHash ||
    raw.id ||
    `soroban-ledger-${ledger}-${raw.contract_id || "contract"}`;

  const event_name = raw.event_name || (Array.isArray(raw.topic) ? raw.topic[0] : null);
  if (!event_name) {
    throw new Error("SorobanRPC event missing event_name/topic");
  }

  const contract_id = raw.contract_id || raw.contractId;
  if (!contract_id) {
    throw new Error("SorobanRPC event missing contract_id");
  }

  const chain_id = raw.chain_id || options.chainId || CHAIN_IDS.SOROBAN_TESTNET;

  return normalizeUnifiedEvent({
    chain_id,
    tx_hash,
    event_name: String(event_name),
    contract_id: String(contract_id),
    ledger_sequence: Number(ledger),
    payload: {
      task_id: raw.task_id ?? null,
      topic: raw.topic ?? null,
      value: raw.value ?? null,
      data: raw.data ?? null,
    },
    occurred_at: raw.processed_at || raw.occurred_at,
    driver: DRIVER_NAMES.SOROBAN_RPC,
  });
}

module.exports = {
  name: DRIVER_NAMES.SOROBAN_RPC,
  defaultChainId: CHAIN_IDS.SOROBAN_TESTNET,
  normalize: normalizeSorobanRpcEvent,
};
