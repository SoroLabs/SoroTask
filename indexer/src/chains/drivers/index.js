const stellarRpcDriver = require("./stellarRpcDriver");
const sorobanRpcDriver = require("./sorobanRpcDriver");
const evmJsonRpcDriver = require("./evmJsonRpcDriver");

const DRIVERS = Object.freeze({
  [stellarRpcDriver.name]: stellarRpcDriver,
  [sorobanRpcDriver.name]: sorobanRpcDriver,
  [evmJsonRpcDriver.name]: evmJsonRpcDriver,
});

function getDriver(name) {
  const driver = DRIVERS[name];
  if (!driver) {
    throw new Error(`Unknown ingestion driver: ${name}`);
  }
  return driver;
}

function listDrivers() {
  return Object.values(DRIVERS);
}

/**
 * Normalize a batch of raw chain events through the selected driver.
 * @param {string} driverName
 * @param {object[]} rawEvents
 * @param {object} [options]
 */
function ingestRawEvents(driverName, rawEvents, options = {}) {
  const driver = getDriver(driverName);
  if (!Array.isArray(rawEvents)) {
    throw new Error("rawEvents must be an array");
  }

  const normalized = [];
  const errors = [];

  rawEvents.forEach((raw, index) => {
    try {
      normalized.push(driver.normalize(raw, options));
    } catch (err) {
      errors.push({ index, message: err.message });
    }
  });

  return { normalized, errors };
}

module.exports = {
  getDriver,
  listDrivers,
  ingestRawEvents,
  stellarRpcDriver,
  sorobanRpcDriver,
  evmJsonRpcDriver,
};
