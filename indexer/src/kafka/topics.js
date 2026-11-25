const RAW_LEDGER_TOPIC = "indexer.raw.ledger-events";
const PARSED_EVENT_TOPIC = "indexer.parsed.events";

function partitionKeyForLedgerEvent(event) {
  const ledger = event.ledger ?? event.ledger_sequence ?? event.ledgerSequence ?? 0;
  const contract = event.contract_id || event.contractId || "unknown";
  return `${ledger}:${contract}`;
}

module.exports = {
  RAW_LEDGER_TOPIC,
  PARSED_EVENT_TOPIC,
  partitionKeyForLedgerEvent,
};
