/** Canonical chain identifiers for cross-network indexer events. */
const CHAIN_IDS = Object.freeze({
  STELLAR_CLASSIC: "stellar:pubnet",
  STELLAR_TESTNET: "stellar:testnet",
  SOROBAN_MAINNET: "soroban:pubnet",
  SOROBAN_TESTNET: "soroban:testnet",
  EVM_SEPOLIA: "evm:11155111",
  EVM_ANVIL: "evm:31337",
});

const DRIVER_NAMES = Object.freeze({
  STELLAR_RPC: "stellar-rpc",
  SOROBAN_RPC: "soroban-rpc",
  EVM_JSONRPC: "evm-jsonrpc",
});

module.exports = { CHAIN_IDS, DRIVER_NAMES };
