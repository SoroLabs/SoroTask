const crypto = require("crypto");

/**
 * @typedef {object} UnifiedChainEvent
 * @property {string} id
 * @property {string} chain_id
 * @property {string} tx_hash
 * @property {string} event_name
 * @property {string} contract_id
 * @property {object} payload
 * @property {number|null} [ledger_sequence]
 * @property {number|null} [block_number]
 * @property {string} occurred_at
 * @property {string} driver
 */

function buildEventId({ chain_id, tx_hash, event_name, contract_id, log_index }) {
  const material = [chain_id, tx_hash, event_name, contract_id, log_index ?? ""].join("|");
  return crypto.createHash("sha256").update(material).digest("hex");
}

/**
 * Normalize and validate a unified cross-chain event record.
 * @param {Partial<UnifiedChainEvent>} input
 * @returns {UnifiedChainEvent}
 */
function normalizeUnifiedEvent(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Event payload must be an object");
  }

  const chain_id = String(input.chain_id || "").trim();
  const tx_hash = String(input.tx_hash || "").trim();
  const event_name = String(input.event_name || "").trim();
  const contract_id = String(input.contract_id || "").trim();

  if (!chain_id) throw new Error("chain_id is required");
  if (!tx_hash) throw new Error("tx_hash is required");
  if (!event_name) throw new Error("event_name is required");
  if (!contract_id) throw new Error("contract_id is required");

  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const occurred_at = input.occurred_at || new Date().toISOString();
  const driver = String(input.driver || "unknown");

  const ledger_sequence =
    input.ledger_sequence === undefined || input.ledger_sequence === null
      ? null
      : Number(input.ledger_sequence);
  const block_number =
    input.block_number === undefined || input.block_number === null
      ? null
      : Number(input.block_number);

  const id =
    input.id ||
    buildEventId({
      chain_id,
      tx_hash,
      event_name,
      contract_id,
      log_index: payload.log_index,
    });

  return {
    id,
    chain_id,
    tx_hash,
    event_name,
    contract_id,
    payload,
    ledger_sequence: Number.isFinite(ledger_sequence) ? ledger_sequence : null,
    block_number: Number.isFinite(block_number) ? block_number : null,
    occurred_at,
    driver,
  };
}

module.exports = { normalizeUnifiedEvent, buildEventId };
