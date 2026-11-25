/** @type {import('./dispatcher').DeadLetterRecord[]} */
let deadLetters = [];

function resetDeadLetterStore() {
  deadLetters = [];
}

function storeDeadLetter(record) {
  deadLetters.push({
    ...record,
    stored_at: new Date().toISOString(),
  });
  return record;
}

function listDeadLetters({ destinationId } = {}) {
  if (!destinationId) return [...deadLetters];
  return deadLetters.filter((entry) => entry.destinationId === destinationId);
}

module.exports = {
  resetDeadLetterStore,
  storeDeadLetter,
  listDeadLetters,
};
