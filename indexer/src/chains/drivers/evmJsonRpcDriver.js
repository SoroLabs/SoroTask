const { CHAIN_IDS, DRIVER_NAMES } = require("../chainIds");
const { normalizeUnifiedEvent } = require("../unifiedEvent");

/**
 * Normalizes EVM JSON-RPC log entries (eth_getLogs).
 * Expected raw shape:
 * { chain_id?, transactionHash, blockNumber, address, topics[], data, logIndex? }
 */
function normalizeEvmJsonRpcEvent(raw, options = {}) {
  const tx_hash = raw.transactionHash || raw.tx_hash;
  if (!tx_hash) {
    throw new Error("EVM JsonRPC event missing transactionHash");
  }

  const contract_id = raw.address || raw.contract_id;
  if (!contract_id) {
    throw new Error("EVM JsonRPC event missing contract address");
  }

  const topics = Array.isArray(raw.topics) ? raw.topics : [];
  const event_name = raw.event_name || topics[0] || "Log";
  const chain_id = raw.chain_id || options.chainId || CHAIN_IDS.EVM_SEPOLIA;

  let block_number = raw.blockNumber;
  if (typeof block_number === "string" && block_number.startsWith("0x")) {
    block_number = parseInt(block_number, 16);
  }

  return normalizeUnifiedEvent({
    chain_id,
    tx_hash,
    event_name: String(event_name),
    contract_id: String(contract_id),
    block_number: block_number != null ? Number(block_number) : null,
    payload: {
      topics,
      data: raw.data ?? null,
      log_index: raw.logIndex ?? raw.log_index ?? null,
    },
    occurred_at: raw.occurred_at,
    driver: DRIVER_NAMES.EVM_JSONRPC,
  });
}

module.exports = {
  name: DRIVER_NAMES.EVM_JSONRPC,
  defaultChainId: CHAIN_IDS.EVM_SEPOLIA,
  normalize: normalizeEvmJsonRpcEvent,
};
