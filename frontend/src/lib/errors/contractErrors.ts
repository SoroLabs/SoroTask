// Frontend error model for Soroban / Stellar / wallet failures.
//
// Codes mirror keeper/src/retry.js where they overlap, so frontend and
// keeper logs can be correlated. Wallet-only categories (rejected, locked,
// not installed, wrong network) are added here because they have no
// equivalent on the keeper side.

export type ContractErrorCategory =
  // Wallet UX
  | "WALLET_NOT_INSTALLED"
  | "WALLET_LOCKED"
  | "WALLET_REJECTED"
  | "WRONG_NETWORK"
  // Funds
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_FEE"
  // Transaction-level
  | "BAD_SEQUENCE"
  | "BAD_AUTH"
  | "TX_TOO_LATE"
  | "TX_TOO_EARLY"
  | "DUPLICATE_TRANSACTION"
  // Soroban / contract
  | "SIMULATION_FAILED"
  | "CONTRACT_REVERT"
  | "INVALID_ARGS"
  | "INSUFFICIENT_GAS"
  | "STATE_EXPIRED"
  // Network / RPC
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  // Catchall
  | "UNKNOWN";

export type ContractErrorAction =
  // Show "Try again" button — user can retry the same call.
  | "retry"
  // Caller is auto-retrying with backoff — show a wait indicator.
  | "wait"
  // User must change something (input, balance, network, wallet) before
  // a retry can succeed.
  | "fix_input"
  // No recovery path beyond reloading / contacting support.
  | "none";

export interface MappedContractError {
  category: ContractErrorCategory;
  title: string;
  userMessage: string;
  action: ContractErrorAction;
  // True if a fresh attempt with the same inputs could succeed (e.g.
  // BAD_SEQUENCE, NETWORK_ERROR). False when user must change something.
  retryable: boolean;
  // Original technical detail, kept verbatim for the dev panel / logs.
  // Never shown to end users in the default UI.
  debug: {
    name?: string;
    message: string;
    code?: string | number;
    raw?: unknown;
  };
}

// Codes the keeper already uses, lowercased for substring matching.
const KEEPER_CODE_TO_CATEGORY: Record<string, ContractErrorCategory> = {
  TX_BAD_SEQ: "BAD_SEQUENCE",
  TX_INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  TX_INSUFFICIENT_FEE: "INSUFFICIENT_FEE",
  TX_BAD_AUTH: "BAD_AUTH",
  TX_BAD_AUTH_EXTRA: "BAD_AUTH",
  TX_TOO_LATE: "TX_TOO_LATE",
  TX_TOO_EARLY: "TX_TOO_EARLY",
  TX_MISSING_OPERATION: "INVALID_ARGS",
  TX_NOT_SUPPORTED: "INVALID_ARGS",
  INVALID_ARGS: "INVALID_ARGS",
  INSUFFICIENT_GAS: "INSUFFICIENT_GAS",
  CONTRACT_PANIC: "CONTRACT_REVERT",
  INVALID_TRANSACTION: "INVALID_ARGS",
  TIMEOUT: "TIMEOUT",
  TIMEOUT_ERROR: "TIMEOUT",
  NETWORK_ERROR: "NETWORK_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  SERVER_ERROR: "SERVER_ERROR",
  SERVICE_UNAVAILABLE: "SERVER_ERROR",
  DUPLICATE_TRANSACTION: "DUPLICATE_TRANSACTION",
  TX_ALREADY_IN_LEDGER: "DUPLICATE_TRANSACTION",
  TX_DUPLICATE: "DUPLICATE_TRANSACTION",
};

const COPY: Record<
  ContractErrorCategory,
  Pick<MappedContractError, "title" | "userMessage" | "action" | "retryable">
> = {
  WALLET_NOT_INSTALLED: {
    title: "Wallet not detected",
    userMessage:
      "We couldn't find a Stellar wallet in this browser. Install Freighter to continue.",
    action: "fix_input",
    retryable: false,
  },
  WALLET_LOCKED: {
    title: "Wallet is locked",
    userMessage:
      "Unlock your wallet, then try again. We weren't able to read your account because the wallet is locked.",
    action: "fix_input",
    retryable: true,
  },
  WALLET_REJECTED: {
    title: "Request was rejected",
    userMessage:
      "The wallet request was declined. If that wasn't intentional, you can try again.",
    action: "retry",
    retryable: true,
  },
  WRONG_NETWORK: {
    title: "Wrong network",
    userMessage:
      "Your wallet is on a different network than this app. Switch networks in the wallet, then try again.",
    action: "fix_input",
    retryable: true,
  },
  INSUFFICIENT_BALANCE: {
    title: "Not enough balance",
    userMessage:
      "Your account doesn't have enough funds for this transaction. Top up and try again.",
    action: "fix_input",
    retryable: true,
  },
  INSUFFICIENT_FEE: {
    title: "Fee too low",
    userMessage:
      "The transaction fee was below the network minimum. Try again — we'll bid a higher fee.",
    action: "retry",
    retryable: true,
  },
  BAD_SEQUENCE: {
    title: "Sequence number out of date",
    userMessage:
      "Another transaction from your account landed first. Retrying with a fresh sequence…",
    action: "wait",
    retryable: true,
  },
  BAD_AUTH: {
    title: "Signature was rejected",
    userMessage:
      "The network rejected the signature on this transaction. Reconnect your wallet and try again.",
    action: "fix_input",
    retryable: true,
  },
  TX_TOO_LATE: {
    title: "Transaction expired",
    userMessage:
      "This transaction took too long to submit. Build a fresh one and try again.",
    action: "retry",
    retryable: true,
  },
  TX_TOO_EARLY: {
    title: "Transaction not yet valid",
    userMessage:
      "This transaction can't be submitted yet. Wait a moment and try again.",
    action: "wait",
    retryable: true,
  },
  DUPLICATE_TRANSACTION: {
    title: "Already submitted",
    userMessage:
      "This transaction has already been accepted by the network — no action needed.",
    action: "none",
    retryable: false,
  },
  SIMULATION_FAILED: {
    title: "Simulation failed",
    userMessage:
      "We pre-checked this call against the network and it would fail. Check your inputs before submitting.",
    action: "fix_input",
    retryable: false,
  },
  CONTRACT_REVERT: {
    title: "Contract rejected the call",
    userMessage:
      "The contract returned an error for this input. Check the values you entered and try again.",
    action: "fix_input",
    retryable: false,
  },
  INVALID_ARGS: {
    title: "Invalid input",
    userMessage:
      "One of the values supplied to the contract isn't valid. Review your inputs and try again.",
    action: "fix_input",
    retryable: false,
  },
  INSUFFICIENT_GAS: {
    title: "Not enough gas",
    userMessage:
      "The task ran out of gas during execution. Increase the gas budget and try again.",
    action: "fix_input",
    retryable: false,
  },
  STATE_EXPIRED: {
    title: "Contract storage expired",
    userMessage:
      "Some on-chain data this call relies on has expired and needs to be restored before the call can run.",
    action: "fix_input",
    retryable: true,
  },
  NETWORK_ERROR: {
    title: "Network problem",
    userMessage:
      "We couldn't reach the Stellar network. Check your connection — we'll keep retrying.",
    action: "wait",
    retryable: true,
  },
  TIMEOUT: {
    title: "Request timed out",
    userMessage:
      "The network didn't respond in time. Retrying automatically…",
    action: "wait",
    retryable: true,
  },
  RATE_LIMITED: {
    title: "Too many requests",
    userMessage:
      "We're being rate-limited by the RPC. Slowing down and retrying…",
    action: "wait",
    retryable: true,
  },
  SERVER_ERROR: {
    title: "RPC server error",
    userMessage:
      "The Stellar RPC reported an internal error. Retrying automatically…",
    action: "wait",
    retryable: true,
  },
  UNKNOWN: {
    title: "Something went wrong",
    userMessage:
      "We hit an unexpected error. If this keeps happening, copy the technical details and share them with support.",
    action: "retry",
    retryable: true,
  },
};

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  errorCode?: unknown;
  status?: unknown;
  resultXdr?: unknown;
  // Soroban simulate error payload
  error?: unknown;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function extractCode(err: ErrorLike): string | undefined {
  return asString(err.code) ?? asString(err.errorCode);
}

function extractMessage(err: ErrorLike): string {
  const m = asString(err.message);
  if (m) return m;
  const e = asString(err.error);
  if (e) return e;
  const r = asString(err.resultXdr);
  if (r) return r;
  return "Unknown error";
}

function classify(err: ErrorLike): ContractErrorCategory {
  const code = extractCode(err);
  const codeUpper = code?.toUpperCase();
  const message = extractMessage(err).toLowerCase();
  const name = asString(err.name)?.toLowerCase() ?? "";

  // 1) Direct keeper-style code match
  if (codeUpper && KEEPER_CODE_TO_CATEGORY[codeUpper]) {
    return KEEPER_CODE_TO_CATEGORY[codeUpper];
  }

  // 2) Wallet-specific. Freighter throws Errors whose .message contains
  //    distinctive substrings; we duck-type here rather than depending on
  //    the freighter-api package.
  if (
    message.includes("freighter is not installed") ||
    message.includes("wallet not installed") ||
    message.includes("no wallet detected") ||
    name === "freighternotinstallederror"
  ) {
    return "WALLET_NOT_INSTALLED";
  }
  if (
    message.includes("wallet is locked") ||
    message.includes("user is not authenticated") ||
    message.includes("freighter is locked")
  ) {
    return "WALLET_LOCKED";
  }
  if (
    message.includes("user declined") ||
    message.includes("user rejected") ||
    message.includes("request rejected") ||
    message.includes("user denied") ||
    codeUpper === "USER_REJECTED"
  ) {
    return "WALLET_REJECTED";
  }
  if (
    message.includes("network passphrase mismatch") ||
    message.includes("wrong network") ||
    message.includes("network mismatch")
  ) {
    return "WRONG_NETWORK";
  }

  // 3) Soroban host / state errors
  if (
    message.includes("entry expired") ||
    message.includes("state archived") ||
    message.includes("ledger entry has expired") ||
    message.includes("restorepreamble")
  ) {
    return "STATE_EXPIRED";
  }
  if (
    message.includes("simulation failed") ||
    message.includes("simulate failed") ||
    asString(err.status) === "FAILED_SIMULATION"
  ) {
    // Distinguish revert (host trap) from generic simulate failure where
    // possible. A host trap in the simulate payload usually surfaces with
    // "host error" or "vm error".
    if (
      message.includes("host error") ||
      message.includes("vm error") ||
      message.includes("contract panicked") ||
      message.includes("trap")
    ) {
      return "CONTRACT_REVERT";
    }
    return "SIMULATION_FAILED";
  }

  // 4) Transaction-level XDR / result codes embedded in messages
  if (message.includes("tx_bad_seq") || message.includes("txbadseq")) {
    return "BAD_SEQUENCE";
  }
  if (
    message.includes("tx_insufficient_balance") ||
    message.includes("insufficient balance")
  ) {
    return "INSUFFICIENT_BALANCE";
  }
  if (
    message.includes("tx_insufficient_fee") ||
    message.includes("insufficient fee")
  ) {
    return "INSUFFICIENT_FEE";
  }
  if (message.includes("tx_bad_auth") || message.includes("bad auth")) {
    return "BAD_AUTH";
  }
  if (message.includes("tx_too_late")) return "TX_TOO_LATE";
  if (message.includes("tx_too_early")) return "TX_TOO_EARLY";
  if (
    message.includes("already in ledger") ||
    message.includes("duplicate") ||
    message.includes("tx_already")
  ) {
    return "DUPLICATE_TRANSACTION";
  }

  // 5) Network / transport
  if (
    message.includes("rate limit") ||
    asString(err.status) === "429" ||
    err.status === 429
  ) {
    return "RATE_LIMITED";
  }
  if (message.includes("timeout") || message.includes("etimedout")) {
    return "TIMEOUT";
  }
  if (
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("socket hang up") ||
    message.includes("fetch failed") ||
    message.includes("network request failed") ||
    name === "networkerror"
  ) {
    return "NETWORK_ERROR";
  }
  const statusNum =
    typeof err.status === "number"
      ? err.status
      : Number.parseInt(asString(err.status) ?? "", 10);
  if (Number.isFinite(statusNum) && statusNum >= 500 && statusNum < 600) {
    return "SERVER_ERROR";
  }

  return "UNKNOWN";
}

export function mapContractError(input: unknown): MappedContractError {
  const err: ErrorLike =
    input && typeof input === "object" ? (input as ErrorLike) : {};
  const category = classify(err);
  const copy = COPY[category];
  return {
    category,
    title: copy.title,
    userMessage: copy.userMessage,
    action: copy.action,
    retryable: copy.retryable,
    debug: {
      name: asString(err.name),
      message: extractMessage(err),
      code: extractCode(err),
      raw: input,
    },
  };
}

// Convenience for tests / synthetic errors in the demo route.
export function isContractErrorCategory(
  v: string,
): v is ContractErrorCategory {
  return Object.prototype.hasOwnProperty.call(COPY, v);
}

export const ALL_CONTRACT_ERROR_CATEGORIES = Object.keys(
  COPY,
) as ContractErrorCategory[];
