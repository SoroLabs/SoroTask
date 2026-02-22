export function createGasMonitor({ logger }) {
  return {
    async check() {
      logger.debug("Checking gas balance...");
      // TODO: check account balance
    },
  };
}
