import dotenv from "dotenv";

dotenv.config();

export function loadConfig() {
  const required = ["SOROBAN_RPC_URL", "NETWORK_PASSPHRASE", "KEEPER_SECRET"];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  return {
    rpcUrl: process.env.SOROBAN_RPC_URL,
    networkPassphrase: process.env.NETWORK_PASSPHRASE,
    keeperSecret: process.env.KEEPER_SECRET,
    pollIntervalMs: 10000,
  };
}
