const crypto = require("crypto");

function buildIngestionEventId(rawEvent) {
  const material = JSON.stringify({
    ledger: rawEvent.ledger ?? rawEvent.ledger_sequence,
    contract_id: rawEvent.contract_id || rawEvent.contractId,
    tx_hash: rawEvent.tx_hash || rawEvent.transactionHash,
    event_name: rawEvent.event_name,
    log_index: rawEvent.log_index ?? rawEvent.logIndex,
  });
  return crypto.createHash("sha256").update(material).digest("hex");
}

class IngestionIdempotencyStore {
  constructor() {
    /** @type {Set<string>} */
    this.seen = new Set();
  }

  reset() {
    this.seen.clear();
  }

  has(eventId) {
    return this.seen.has(eventId);
  }

  mark(eventId) {
    this.seen.add(eventId);
  }
}

module.exports = { buildIngestionEventId, IngestionIdempotencyStore };
