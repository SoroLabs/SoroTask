import type { ContractErrorCategory } from "./contractErrors";

// One representative raw error per category. These mimic the shape we
// actually see from @stellar/stellar-sdk, the Soroban RPC, and Freighter,
// but are inert objects — no SDK calls happen. Used by the demo route and
// by tests.
export const RAW_ERROR_FIXTURES: Record<ContractErrorCategory, unknown> = {
  WALLET_NOT_INSTALLED: new Error("Freighter is not installed"),
  WALLET_LOCKED: new Error("Wallet is locked. Please unlock to continue."),
  WALLET_REJECTED: new Error("User declined access to their account."),
  WRONG_NETWORK: new Error(
    "Network passphrase mismatch. Expected: Test SDF Network ; September 2015, Got: Public Global Stellar Network ; September 2015",
  ),

  INSUFFICIENT_BALANCE: Object.assign(new Error("tx_insufficient_balance"), {
    code: "TX_INSUFFICIENT_BALANCE",
  }),
  INSUFFICIENT_FEE: Object.assign(new Error("tx_insufficient_fee"), {
    code: "TX_INSUFFICIENT_FEE",
  }),

  BAD_SEQUENCE: Object.assign(new Error("tx_bad_seq"), { code: "TX_BAD_SEQ" }),
  BAD_AUTH: Object.assign(new Error("tx_bad_auth"), { code: "TX_BAD_AUTH" }),
  TX_TOO_LATE: Object.assign(new Error("tx_too_late"), { code: "TX_TOO_LATE" }),
  TX_TOO_EARLY: Object.assign(new Error("tx_too_early"), {
    code: "TX_TOO_EARLY",
  }),
  DUPLICATE_TRANSACTION: Object.assign(new Error("tx_already_in_ledger"), {
    code: "TX_ALREADY_IN_LEDGER",
  }),

  SIMULATION_FAILED: Object.assign(
    new Error(
      "Simulation failed: HostError: Error(Contract, #2): missing required parameter 'amount'",
    ),
    { status: "FAILED_SIMULATION" },
  ),
  CONTRACT_REVERT: new Error(
    "Simulation failed: VM error: contract panicked: assertion failed",
  ),
  INVALID_ARGS: Object.assign(new Error("Invalid contract arguments"), {
    code: "INVALID_ARGS",
  }),
  INSUFFICIENT_GAS: Object.assign(
    new Error("Insufficient gas budget for execution"),
    { code: "INSUFFICIENT_GAS" },
  ),
  STATE_EXPIRED: new Error(
    "Ledger entry has expired (state archived). RestorePreamble required.",
  ),

  NETWORK_ERROR: Object.assign(new Error("fetch failed"), {
    name: "NetworkError",
  }),
  TIMEOUT: Object.assign(new Error("Request timeout"), { code: "TIMEOUT" }),
  RATE_LIMITED: Object.assign(new Error("Too many requests"), { status: 429 }),
  SERVER_ERROR: Object.assign(new Error("Internal server error"), {
    status: 503,
  }),

  UNKNOWN: new Error("Something nobody anticipated happened"),
};
