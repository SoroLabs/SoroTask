const { CHAIN_IDS, DRIVER_NAMES } = require("../chainIds");
const { normalizeUnifiedEvent } = require("../unifiedEvent");

/**
 * Normalizes Stellar Classic (Horizon / RPC) style transaction effects.
 * Expected raw shape:
 * { chain_id?, tx_hash, ledger, created_at?, type, contract_id?, details? }
 */
function normalizeStellarRpcEvent(raw, options = {}) {
  if (!raw?.tx_hash) {
    throw new Error("StellarRPC event missing tx_hash");
  }

  const chain_id = raw.chain_id || options.chainId || CHAIN_IDS.STELLAR_TESTNET;
  const event_name = raw.type || raw.event_name;
  if (!event_name) {
    throw new Error("StellarRPC event missing type/event_name");
  }

  return normalizeUnifiedEvent({
    chain_id,
    tx_hash: raw.tx_hash,
    event_name,
    contract_id: raw.contract_id || raw.account || "stellar:classic",
    ledger_sequence: raw.ledger ?? raw.ledger_sequence,
    payload: {
      details: raw.details || raw.data || {},
      operation_index: raw.operation_index ?? null,
    },
    occurred_at: raw.created_at,
    driver: DRIVER_NAMES.STELLAR_RPC,
  });
}

module.exports = {
  name: DRIVER_NAMES.STELLAR_RPC,
  defaultChainId: CHAIN_IDS.STELLAR_TESTNET,
  normalize: normalizeStellarRpcEvent,
};
