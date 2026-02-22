import { Server } from "soroban-client";

export function createRpc(config, logger) {
  const server = new Server(config.rpcUrl);

  logger.info("Connected to RPC", { url: config.rpcUrl });

  return server;
}
