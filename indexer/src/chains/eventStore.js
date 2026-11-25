const { normalizeUnifiedEvent } = require("./unifiedEvent");

/** @type {Map<string, import('./unifiedEvent').UnifiedChainEvent>} */
const eventsById = new Map();

function resetCrossChainEventStore() {
  eventsById.clear();
}

/**
 * @param {import('./unifiedEvent').UnifiedChainEvent|object} event
 */
function storeUnifiedEvent(event) {
  const normalized = normalizeUnifiedEvent(event);
  eventsById.set(normalized.id, normalized);
  return normalized;
}

function storeUnifiedEvents(events) {
  return events.map((event) => storeUnifiedEvent(event));
}

function listStoredEvents({ chain_id } = {}) {
  const all = Array.from(eventsById.values());
  if (!chain_id) return all;
  return all.filter((event) => event.chain_id === chain_id);
}

module.exports = {
  resetCrossChainEventStore,
  storeUnifiedEvent,
  storeUnifiedEvents,
  listStoredEvents,
};
