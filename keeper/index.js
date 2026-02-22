import { loadConfig } from "./src/config.js";
import { createLogger } from "./src/logger.js";
import { createRpc } from "./src/rpc.js";
import { loadAccount } from "./src/account.js";
import { createPoller } from "./src/poller.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger();

  logger.info("Starting SoroTask Keeper...");

  const rpc = createRpc(config, logger);
  const keeperAccount = loadAccount(config);

  const poller = createPoller({
    config,
    logger,
    rpc,
    keeperAccount,
  });

  poller.start();

  const shutdown = async (signal) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    await poller.stop?.();
    logger.info("Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal Keeper Error:", err);
  process.exit(1);
});