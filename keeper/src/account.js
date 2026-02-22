import { Keypair } from "soroban-client";

export function loadAccount(config) {
  return Keypair.fromSecret(config.keeperSecret);
}
