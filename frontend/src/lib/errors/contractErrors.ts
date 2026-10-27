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
  | "TOKEN_APPROVAL_REQUIRED"
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
  // Increase the gas budget / escrow and retry.
  | "increase_gas"
  // Reconnect the wallet so a fresh session can be authorised.
  | "reconnect_wallet"
  // Switch the wallet to the network the app expects.
  | "switch_network"
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
    diagnostic?: DecodedContractDiagnostic;
  };
}

export interface DecodedContractDiagnostic {
  format: "hex" | "base64" | "text";
  decodedText: string;
  code?: string;
  domain?: string;
  actionableMessage: string;
}

export class SorobanContractError extends Error {
  readonly code?: string;
  readonly resultXdr?: string;
  readonly diagnosticPayload?: unknown;

  constructor(
    message: string,
    details: {
      code?: string;
      resultXdr?: string;
      diagnosticPayload?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "SorobanContractError";
    this.code = details.code;
    this.resultXdr = details.resultXdr;
    this.diagnosticPayload = details.diagnosticPayload;
  }
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
  TX_FAILED: "CONTRACT_REVERT",
  INVALID_TRANSACTION: "INVALID_ARGS",
  TIMEOUT: "TIMEOUT",
  TIMEOUT_ERROR: "TIMEOUT",
  NETWORK_ERROR: "NETWORK_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  SERVER_ERROR: "SERVER_ERROR",
  SERVICE_UNAVAILABLE: "SERVER_ERROR",
  RESOURCE_LIMIT_EXCEEDED: "INSUFFICIENT_GAS",
  EXCEEDED_LIMIT: "INSUFFICIENT_GAS",
  RESOURCE_LIMIT: "INSUFFICIENT_GAS",
  TOO_MANY_REQUESTS: "RATE_LIMITED",
  OP_NO_ACCOUNT: "INSUFFICIENT_BALANCE",
  OP_LOW_RESERVE: "INSUFFICIENT_BALANCE",
  OP_INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  OP_INSUFFICIENT_FEE: "INSUFFICIENT_FEE",
  OP_BAD_AUTH: "BAD_AUTH",
  OP_BAD_AUTH_EXTRA: "BAD_AUTH",
  OP_NO_TRUST: "WRONG_NETWORK",
  OP_NO_ISSUER: "INVALID_ARGS",
  OP_LINE_FULL: "INSUFFICIENT_BALANCE",
  OP_UNDERFUNDED: "INSUFFICIENT_BALANCE",
  INSUFFICIENT_ALLOWANCE: "TOKEN_APPROVAL_REQUIRED",
  TOKEN_NOT_APPROVED: "TOKEN_APPROVAL_REQUIRED",
  CONTRACT_ERROR: "CONTRACT_REVERT",
  HOST_ERROR: "CONTRACT_REVERT",
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
  TOKEN_APPROVAL_REQUIRED: {
    title: "Token approval required",
    userMessage:
      "This contract cannot use the token yet. Review the token and spender addresses and approve only the amount required for this task.",
    action: "fix_input",
    retryable: false,
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
    userMessage: "The network didn't respond in time. Retrying automatically…",
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
  errorResultXdr?: unknown;
  diagnosticEvents?: unknown;
  events?: unknown;
  diagnosticPayload?: unknown;
  result?: unknown;
  details?: unknown;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() ? v : undefined;
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
  const xdr = asString(err.errorResultXdr);
  if (xdr) return xdr;
  const diagnostic = asString(err.diagnosticPayload);
  if (diagnostic) return diagnostic;
  return "Unknown error";
}

function collectDiagnosticText(
  value: unknown,
  seen = new Set<object>(),
): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectDiagnosticText(item, seen));
  }

  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of [
    "message",
    "error",
    "errorCode",
    "code",
    "resultXdr",
    "errorResultXdr",
    "diagnosticPayload",
    "diagnosticEvents",
    "events",
    "result",
    "details",
    "value",
    "body",
    "event",
    "contractId",
    "topics",
    "data",
    "type",
  ]) {
    if (record[key] !== undefined) {
      parts.push(...collectDiagnosticText(record[key], seen));
    }
  }
  return parts;
}

function cleanDecodedText(input: string): string | null {
  const printable = input
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return printable || null;
}

function decodeHexText(input: string): string | null {
  const stripped = input
    .trim()
    .replace(/^0x/i, "")
    .replace(/[\s:_-]/g, "");
  if (
    !stripped ||
    stripped.length > 1_000_000 ||
    stripped.length % 2 !== 0 ||
    !/^[\da-f]+$/i.test(stripped)
  ) {
    return null;
  }

  const bytes = new Uint8Array(
    stripped.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)),
  );
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return cleanDecodedText(decoded);
}

function decodeBase64Text(input: string): string | null {
  const stripped = input.trim();
  if (
    stripped.length < 8 ||
    stripped.length > 1_000_000 ||
    stripped.length % 4 !== 0 ||
    !/^[\da-z+/]+={0,2}$/i.test(stripped)
  ) {
    return null;
  }

  try {
    const bytes = Uint8Array.from(atob(stripped), (character) =>
      character.charCodeAt(0),
    );
    return cleanDecodedText(
      new TextDecoder("utf-8", { fatal: false }).decode(bytes),
    );
  } catch {
    return null;
  }
}

export function decodeContractDiagnostic(
  payload: unknown,
): DecodedContractDiagnostic {
  const sources = collectDiagnosticText(payload);
  const candidates = sources.map((source) => {
    const hexDecoded = decodeHexText(source);
    return {
      source,
      decoded: hexDecoded ?? decodeBase64Text(source),
      format: hexDecoded ? ("hex" as const) : ("base64" as const),
    };
  });
  const decodedCandidate = candidates.find((candidate) => candidate.decoded);
  const source = decodedCandidate?.source ?? sources.join(" ").trim();
  const decodedText = decodedCandidate?.decoded ?? source;
  const format = decodedCandidate?.format ?? "text";
  const hostError = decodedText.match(
    /Error\s*\(\s*([A-Za-z_]+)\s*,\s*(#?\s*\d+|[A-Za-z_][A-Za-z0-9_]*)\s*\)/i,
  );
  const codeMatch =
    decodedText.match(
      /\b(?:error|contracterror|code)\s*[:=#]\s*([A-Z][A-Z0-9_]{2,})\b/i,
    ) ??
    decodedText.match(
      /\b(TX_[A-Z0-9_]+|OP_[A-Z0-9_]+|INSUFFICIENT_GAS|CONTRACT_PANIC)\b/i,
    );
  const code = hostError
    ? `Error(${hostError[1]}, ${hostError[2].trim()})`
    : codeMatch?.[1]?.toUpperCase();
  const domain = hostError?.[1];

  let actionableMessage =
    "The diagnostic data was decoded, but it does not match a known Soroban error. Check the contract inputs and share the diagnostic code with support.";
  if (hostError) {
    const hostDomain = hostError[1].toLowerCase();
    if (hostDomain === "budget" || hostDomain === "wasmvm") {
      actionableMessage =
        "Soroban could not complete the contract execution. Review the gas budget and contract inputs.";
    } else if (hostDomain === "storage") {
      actionableMessage =
        "Contract state could not be loaded. The required ledger entry may need to be restored before retrying.";
    } else if (hostDomain === "auth") {
      actionableMessage =
        "The contract call requires authorization that was not provided. Reconnect the wallet and review the requested signature.";
    } else if (hostDomain === "contract") {
      actionableMessage = `The contract returned custom error ${hostError[2].trim()}. Check the function arguments and the contract's documented error codes.`;
    } else {
      actionableMessage = `Soroban reported a ${hostError[1]} host error. Review the contract inputs and retry after addressing the reported condition.`;
    }
  } else if (code) {
    const category = KEEPER_CODE_TO_CATEGORY[code];
    actionableMessage = category
      ? COPY[category].userMessage
      : `Soroban returned error code ${code}. Check the contract inputs and the contract's documented error codes.`;
  }

  return {
    format,
    decodedText: decodedText.slice(0, 4000),
    code,
    domain,
    actionableMessage,
  };
}

function classify(err: ErrorLike): ContractErrorCategory {
  const diagnosticSources = collectDiagnosticText(err);
  const decodedDiagnostic = diagnosticSources
    .map((source) => decodeContractDiagnostic(source))
    .find((diagnostic) => diagnostic.code);
  const diagnosticText = [
    ...diagnosticSources,
    ...(decodedDiagnostic ? [decodedDiagnostic.decodedText] : []),
  ].join(" ");
  const code =
    extractCode(err) ??
    decodedDiagnostic?.code ??
    decodeContractDiagnostic(diagnosticText).code;
  const codeUpper = code?.toUpperCase();
  const message = `${extractMessage(err)} ${diagnosticText}`.toLowerCase();
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
  // A FAILED_SIMULATION status without a VM trap is the RPC reporting a
  // contract-level validation failure, so it outranks the generic host
  // "Error(Contract, #n)" revert signal.
  if (
    asString(err.status) === "FAILED_SIMULATION" &&
    !message.includes("vm error") &&
    !message.includes("contract panicked") &&
    !message.includes("trap")
  ) {
    return "SIMULATION_FAILED";
  }
  const hostError = message.match(
    /error\s*\(\s*([a-z_]+)\s*,\s*(?:#?\s*\d+|[a-z_][a-z0-9_]*)\s*\)/i,
  );
  if (hostError) {
    const hostDomain = hostError[1].toLowerCase();
    if (hostDomain === "budget" || hostDomain === "wasmvm") {
      return "INSUFFICIENT_GAS";
    }
    if (hostDomain === "storage") return "STATE_EXPIRED";
    if (hostDomain === "auth") return "BAD_AUTH";
    if (hostDomain === "contract") return "CONTRACT_REVERT";
  }
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
    message.includes("insufficient allowance") ||
    message.includes("allowance too low") ||
    message.includes("token not approved") ||
    message.includes("approval required")
  ) {
    return "TOKEN_APPROVAL_REQUIRED";
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
  const diagnosticPayload =
    err.diagnosticPayload ??
    err.diagnosticEvents ??
    err.errorResultXdr ??
    err.resultXdr;
  const diagnostic =
    diagnosticPayload === undefined
      ? null
      : decodeContractDiagnostic(diagnosticPayload);
  return {
    category,
    title: copy.title,
    userMessage:
      diagnostic && diagnostic.code
        ? diagnostic.actionableMessage
        : copy.userMessage,
    action: copy.action,
    retryable: copy.retryable,
    debug: {
      name: asString(err.name),
      message: extractMessage(err),
      code: extractCode(err) ?? diagnostic?.code,
      raw: input,
      diagnostic: diagnostic ?? undefined,
    },
  };
}

// Convenience for tests / synthetic errors in the demo route.
export function isContractErrorCategory(v: string): v is ContractErrorCategory {
  return Object.prototype.hasOwnProperty.call(COPY, v);
}

export const ALL_CONTRACT_ERROR_CATEGORIES = Object.keys(
  COPY,
) as ContractErrorCategory[];

export interface ContractErrorDiagnostic {
  code: number;
  name: string;
  category: ContractErrorCategory;
  title: string;
  explanation: string;
  fixSuggestion: string;
  action: ContractErrorAction;
}

export const CONTRACT_ERROR_DEFINITIONS: Record<
  number,
  {
    name: string;
    category: ContractErrorCategory;
    explanation: string;
    fixSuggestion: string;
    action: ContractErrorAction;
  }
> = {
  1: {
    name: "InvalidInterval",
    category: "INVALID_ARGS",
    explanation:
      "Task execution interval is invalid or below the protocol minimum.",
    fixSuggestion: "Set task execution interval to at least 10 seconds.",
    action: "fix_input",
  },
  2: {
    name: "Unauthorized",
    category: "BAD_AUTH",
    explanation: "Caller lacks required admin or creator authorization.",
    fixSuggestion:
      "Ensure your connected wallet address matches the task creator or admin.",
    action: "reconnect_wallet",
  },
  3: {
    name: "InsufficientBalance",
    category: "INSUFFICIENT_BALANCE",
    explanation:
      "Gas escrow or account XLM balance is insufficient to execute task.",
    fixSuggestion:
      "Increase gas escrow by depositing 50 XLM to your task balance.",
    action: "increase_gas",
  },
  4: {
    name: "NotInitialized",
    category: "SIMULATION_FAILED",
    explanation: "Target contract state has not been initialized.",
    fixSuggestion:
      "Invoke contract initialization before calling task methods.",
    action: "fix_input",
  },
  5: {
    name: "TaskPaused",
    category: "SIMULATION_FAILED",
    explanation: "Target task is currently paused by admin.",
    fixSuggestion: "Unpause the task using admin controls before executing.",
    action: "fix_input",
  },
  6: {
    name: "TaskAlreadyPaused",
    category: "SIMULATION_FAILED",
    explanation: "Task is already in paused state.",
    fixSuggestion: "No action required; task is paused.",
    action: "none",
  },
  7: {
    name: "TaskAlreadyActive",
    category: "SIMULATION_FAILED",
    explanation: "Task is already active.",
    fixSuggestion: "No action required; task is active.",
    action: "none",
  },
  8: {
    name: "SelfDependency",
    category: "INVALID_ARGS",
    explanation: "Task payload cannot specify itself as a dependency.",
    fixSuggestion: "Remove self-referencing task ID from dependencies.",
    action: "fix_input",
  },
  9: {
    name: "DependencyNotFound",
    category: "INVALID_ARGS",
    explanation: "Specified dependency task ID does not exist in ledger.",
    fixSuggestion: "Verify dependency task ID and update payload.",
    action: "fix_input",
  },
  10: {
    name: "CircularDependency",
    category: "INVALID_ARGS",
    explanation: "Circular dependency loop detected between tasks.",
    fixSuggestion: "Break circular dependency chain in task DAG.",
    action: "fix_input",
  },
  11: {
    name: "DependencyBlocked",
    category: "CONTRACT_REVERT",
    explanation: "Prerequisite dependency task has not finalized successfully.",
    fixSuggestion:
      "Wait for dependency task to complete or resolve its failure.",
    action: "wait",
  },
  12: {
    name: "AlreadyInitialized",
    category: "CONTRACT_REVERT",
    explanation: "Contract has already been initialized.",
    fixSuggestion: "Skip initialization call.",
    action: "none",
  },
  13: {
    name: "UnauthorizedSlasher",
    category: "BAD_AUTH",
    explanation: "Caller is not an authorized slasher role.",
    fixSuggestion: "Connect with registered slasher key.",
    action: "reconnect_wallet",
  },
  14: {
    name: "KeeperStakeTooLow",
    category: "INSUFFICIENT_BALANCE",
    explanation: "Keeper stake is below required minimum threshold.",
    fixSuggestion:
      "Stake additional tokens to meet keeper minimum requirement.",
    action: "fix_input",
  },
  15: {
    name: "OperatorAlreadySet",
    category: "CONTRACT_REVERT",
    explanation: "Keeper operator address has already been configured.",
    fixSuggestion: "Revoke current operator before assigning a new one.",
    action: "fix_input",
  },
  16: {
    name: "InvalidPayload",
    category: "INVALID_ARGS",
    explanation: "Serialized task argument payload fails validation.",
    fixSuggestion: "Re-encode arguments according to target contract ABI.",
    action: "fix_input",
  },
  17: {
    name: "ReentrantCall",
    category: "CONTRACT_REVERT",
    explanation: "Reentrant execution call detected.",
    fixSuggestion: "Ensure state mutations precede external calls.",
    action: "none",
  },
  18: {
    name: "DependencyLimitExceeded",
    category: "INVALID_ARGS",
    explanation: "Task dependency count exceeds maximum limit (8).",
    fixSuggestion: "Reduce task dependencies to 8 or fewer.",
    action: "fix_input",
  },
  19: {
    name: "DependencyDepthExceeded",
    category: "INVALID_ARGS",
    explanation: "Dependency graph depth exceeds maximum depth (5).",
    fixSuggestion: "Flatten dependency graph depth to 5 or fewer levels.",
    action: "fix_input",
  },
  20: {
    name: "VrfOracleNotSet",
    category: "SIMULATION_FAILED",
    explanation: "VRF oracle contract address is missing.",
    fixSuggestion: "Configure valid VRF oracle address in settings.",
    action: "fix_input",
  },
  21: {
    name: "InvalidVrfRequest",
    category: "INVALID_ARGS",
    explanation: "VRF request seed or parameters are invalid.",
    fixSuggestion: "Regenerate VRF randomness seed.",
    action: "retry",
  },
  22: {
    name: "VrfRequestFailed",
    category: "CONTRACT_REVERT",
    explanation: "VRF request execution failed on host.",
    fixSuggestion: "Retry VRF request submission.",
    action: "retry",
  },
  23: {
    name: "VrfAlreadyFulfilled",
    category: "CONTRACT_REVERT",
    explanation: "VRF seed has already been fulfilled.",
    fixSuggestion: "Generate a new VRF request ID.",
    action: "retry",
  },
  24: {
    name: "YieldStrategyNotInitialized",
    category: "SIMULATION_FAILED",
    explanation: "Yield harvesting strategy is not initialized.",
    fixSuggestion: "Initialize yield strategy before harvesting.",
    action: "fix_input",
  },
  25: {
    name: "InvalidYieldStrategy",
    category: "INVALID_ARGS",
    explanation: "Yield strategy configuration parameters are invalid.",
    fixSuggestion: "Update strategy protocol address and parameters.",
    action: "fix_input",
  },
  26: {
    name: "YieldHarvestFailed",
    category: "CONTRACT_REVERT",
    explanation: "Yield harvest execution reverted.",
    fixSuggestion: "Check DeFi protocol liquidity and harvest bounds.",
    action: "retry",
  },
  27: {
    name: "InsufficientYield",
    category: "CONTRACT_REVERT",
    explanation: "Harvested yield is below minimum threshold.",
    fixSuggestion: "Wait for yield accumulation before harvesting.",
    action: "wait",
  },
  28: {
    name: "OracleNotSet",
    category: "SIMULATION_FAILED",
    explanation: "Price oracle contract is not configured.",
    fixSuggestion: "Set price oracle address in settings.",
    action: "fix_input",
  },
  29: {
    name: "OracleRequestFailed",
    category: "CONTRACT_REVERT",
    explanation: "Price oracle request failed.",
    fixSuggestion: "Retry oracle request after provider sync.",
    action: "retry",
  },
  30: {
    name: "OracleInvalidResponse",
    category: "CONTRACT_REVERT",
    explanation: "Oracle returned malformed or negative data.",
    fixSuggestion: "Verify oracle feed configuration.",
    action: "fix_input",
  },
  31: {
    name: "OracleTimeout",
    category: "TIMEOUT",
    explanation: "Price oracle response timed out.",
    fixSuggestion: "Retry request with fresh oracle response.",
    action: "wait",
  },
  32: {
    name: "OracleUnsupportedProvider",
    category: "INVALID_ARGS",
    explanation: "Oracle provider type is unsupported.",
    fixSuggestion: "Select supported provider (Chainlink or Band).",
    action: "fix_input",
  },
  33: {
    name: "InvalidInsurancePolicy",
    category: "INVALID_ARGS",
    explanation: "Insurance policy limits are invalid.",
    fixSuggestion: "Update insurance coverage parameters.",
    action: "fix_input",
  },
  34: {
    name: "ArgsTooMany",
    category: "INVALID_ARGS",
    explanation: "Task payload contains too many arguments (>32).",
    fixSuggestion: "Reduce argument count to 32 or fewer.",
    action: "fix_input",
  },
  35: {
    name: "ArgsTooLarge",
    category: "INVALID_ARGS",
    explanation: "Serialized task payload exceeds 4KB limit.",
    fixSuggestion: "Reduce serialized payload size below 4096 bytes.",
    action: "fix_input",
  },
  36: {
    name: "TaskNotFound",
    category: "SIMULATION_FAILED",
    explanation: "Task ID was not found in contract storage.",
    fixSuggestion: "Confirm task registration and ID.",
    action: "fix_input",
  },
  37: {
    name: "InvalidUpgradeVersion",
    category: "INVALID_ARGS",
    explanation:
      "WASM upgrade version must be strictly greater than current version.",
    fixSuggestion: "Increment WASM upgrade version counter.",
    action: "fix_input",
  },
  38: {
    name: "DuplicateTask",
    category: "DUPLICATE_TRANSACTION",
    explanation: "Task payload matches an existing registered task.",
    fixSuggestion: "Modify task payload parameters.",
    action: "fix_input",
  },
  39: {
    name: "BountyBelowMinimum",
    category: "INSUFFICIENT_BALANCE",
    explanation: "Bounty reward is below protocol minimum.",
    fixSuggestion: "Increase bounty reward contribution.",
    action: "fix_input",
  },
  40: {
    name: "InvalidBounty",
    category: "INVALID_ARGS",
    explanation: "Bounty token or parameters are invalid.",
    fixSuggestion: "Check bounty asset address and value.",
    action: "fix_input",
  },
  41: {
    name: "FeatureDisabled",
    category: "SIMULATION_FAILED",
    explanation: "Protocol feature disabled by governance.",
    fixSuggestion: "Wait for governance feature activation proposal.",
    action: "none",
  },
  42: {
    name: "InvalidZkProof",
    category: "CONTRACT_REVERT",
    explanation: "Zero-knowledge proof verification failed.",
    fixSuggestion: "Re-generate ZK proof with valid witness input.",
    action: "retry",
  },
  43: {
    name: "FlashSwapFailed",
    category: "CONTRACT_REVERT",
    explanation: "Flash swap transaction reverted.",
    fixSuggestion: "Check liquidity pool path and balance.",
    action: "retry",
  },
  44: {
    name: "InsufficientFlashProfit",
    category: "CONTRACT_REVERT",
    explanation: "Flash swap arbitrage profit fell below minimum threshold.",
    fixSuggestion: "Adjust trade route or profit tolerance.",
    action: "fix_input",
  },
  45: {
    name: "InvalidSlippage",
    category: "CONTRACT_REVERT",
    explanation: "Trade slippage exceeded maximum threshold.",
    fixSuggestion: "Increase slippage tolerance setting.",
    action: "fix_input",
  },
  46: {
    name: "OptimisticClaimPending",
    category: "CONTRACT_REVERT",
    explanation: "Optimistic claim is open and pending challenge window.",
    fixSuggestion: "Wait for challenge window ledgers to elapse.",
    action: "wait",
  },
  47: {
    name: "NoOptimisticClaim",
    category: "SIMULATION_FAILED",
    explanation: "No active optimistic claim found for task.",
    fixSuggestion: "Submit optimistic claim prior to finalization.",
    action: "fix_input",
  },
  48: {
    name: "ChallengeWindowClosed",
    category: "CONTRACT_REVERT",
    explanation: "Challenge window has closed for claim.",
    fixSuggestion: "Finalize optimistic claim instead of challenging.",
    action: "fix_input",
  },
  49: {
    name: "ChallengeWindowActive",
    category: "CONTRACT_REVERT",
    explanation: "Optimistic challenge window is still active.",
    fixSuggestion: "Wait for challenge window ledgers to expire.",
    action: "wait",
  },
  50: {
    name: "FraudProofInvalid",
    category: "CONTRACT_REVERT",
    explanation: "Fraud proof verification failed.",
    fixSuggestion: "Provide valid state trace diff for fraud proof.",
    action: "retry",
  },
  51: {
    name: "EmptyBundle",
    category: "INVALID_ARGS",
    explanation: "Task bundle contains no steps.",
    fixSuggestion: "Add at least one step to task bundle.",
    action: "fix_input",
  },
  52: {
    name: "BundleTooLarge",
    category: "INVALID_ARGS",
    explanation: "Task bundle exceeds maximum steps (16).",
    fixSuggestion: "Split bundle into 16 or fewer steps.",
    action: "fix_input",
  },
  53: {
    name: "BundleStepFailed",
    category: "CONTRACT_REVERT",
    explanation: "Atomic task bundle step execution failed.",
    fixSuggestion: "Check individual step parameters and dependencies.",
    action: "fix_input",
  },
  54: {
    name: "BlockExecutionLimitReached",
    category: "RATE_LIMITED",
    explanation: "Rate limit reached for current ledger block.",
    fixSuggestion: "Wait for next ledger block execution slot.",
    action: "wait",
  },
  55: {
    name: "DecryptionFailed",
    category: "CONTRACT_REVERT",
    explanation: "In-memory parameter decryption failed.",
    fixSuggestion: "Check encryption key and nonce.",
    action: "fix_input",
  },
  56: {
    name: "InsufficientDelegation",
    category: "INSUFFICIENT_BALANCE",
    explanation: "Delegation stake is insufficient.",
    fixSuggestion: "Increase delegated stake balance.",
    action: "fix_input",
  },
  57: {
    name: "InvalidCommissionRate",
    category: "INVALID_ARGS",
    explanation: "Operator commission rate exceeds 10,000 bps.",
    fixSuggestion: "Set commission rate between 0 and 10000 basis points.",
    action: "fix_input",
  },
  58: {
    name: "InvalidVdfProof",
    category: "CONTRACT_REVERT",
    explanation: "VDF proof verification failed.",
    fixSuggestion: "Recompute VDF proof with valid seed.",
    action: "retry",
  },
  59: {
    name: "UpgradeNotProposed",
    category: "SIMULATION_FAILED",
    explanation: "WASM upgrade proposal does not exist.",
    fixSuggestion: "Submit upgrade proposal first.",
    action: "fix_input",
  },
  60: {
    name: "UpgradeTimelockActive",
    category: "CONTRACT_REVERT",
    explanation: "Upgrade timelock delay has not elapsed.",
    fixSuggestion: "Wait for upgrade timelock delay to expire.",
    action: "wait",
  },
  65: {
    name: "UnpauseNotProposed",
    category: "SIMULATION_FAILED",
    explanation: "Unpause proposal not found.",
    fixSuggestion: "Submit unpause proposal to governance.",
    action: "fix_input",
  },
  66: {
    name: "UnpauseTimelockActive",
    category: "CONTRACT_REVERT",
    explanation: "Unpause timelock delay is active.",
    fixSuggestion: "Wait 24 hours for unpause timelock to expire.",
    action: "wait",
  },
  67: {
    name: "InvalidPauseThreshold",
    category: "INVALID_ARGS",
    explanation: "Pause threshold value is invalid.",
    fixSuggestion: "Set valid pause threshold parameter.",
    action: "fix_input",
  },
  68: {
    name: "TaskStillActive",
    category: "CONTRACT_REVERT",
    explanation: "Task is active and cannot be refunded.",
    fixSuggestion: "Pause task before requesting gas refund.",
    action: "fix_input",
  },
  69: {
    name: "AbandonmentPeriodNotElapsed",
    category: "CONTRACT_REVERT",
    explanation: "Task has not been inactive for required 90-day period.",
    fixSuggestion: "Wait for 90 days of inactivity before claiming refund.",
    action: "wait",
  },
  411: {
    name: "OracleStale",
    category: "CONTRACT_REVERT",
    explanation: "Oracle price feed data is older than 300 seconds.",
    fixSuggestion: "Fetch fresh price data update from oracle.",
    action: "retry",
  },
  412: {
    name: "OracleDeviationExceeded",
    category: "CONTRACT_REVERT",
    explanation: "Price deviation across oracle feeds exceeds 250 bps.",
    fixSuggestion: "Wait for oracle price convergence.",
    action: "wait",
  },
  413: {
    name: "InsufficientOracleFeeds",
    category: "SIMULATION_FAILED",
    explanation: "Fewer than required minimum oracle price feeds active.",
    fixSuggestion: "Activate additional oracle feeds.",
    action: "fix_input",
  },
  414: {
    name: "VrfFulfillmentTooEarly",
    category: "CONTRACT_REVERT",
    explanation: "VRF reveal submitted before minimum delay elapsed.",
    fixSuggestion: "Wait for minimum delay ledgers before revealing VRF.",
    action: "wait",
  },
  415: {
    name: "VrfFulfillmentExpired",
    category: "CONTRACT_REVERT",
    explanation: "VRF reveal window has expired.",
    fixSuggestion: "Re-submit VRF commitment.",
    action: "retry",
  },
  416: {
    name: "VrfCommitAlreadyRevealed",
    category: "CONTRACT_REVERT",
    explanation: "VRF commitment has already been revealed.",
    fixSuggestion: "Commit a fresh VRF seed.",
    action: "retry",
  },
  417: {
    name: "InvalidVrfCommit",
    category: "CONTRACT_REVERT",
    explanation: "VRF commit hash does not match revealed seed.",
    fixSuggestion: "Verify VRF seed and hash.",
    action: "fix_input",
  },
  418: {
    name: "KeeperBondInsufficient",
    category: "INSUFFICIENT_BALANCE",
    explanation: "Keeper bond balance is below minimum requirement (100 XLM).",
    fixSuggestion: "Increase gas escrow by 50 XLM or top up keeper bond.",
    action: "increase_gas",
  },
  419: {
    name: "KeeperSlashed",
    category: "CONTRACT_REVERT",
    explanation: "Keeper address has been slashed for misbehavior.",
    fixSuggestion: "Re-register keeper with fresh stake bond.",
    action: "reconnect_wallet",
  },
  420: {
    name: "KeeperNotBonded",
    category: "SIMULATION_FAILED",
    explanation: "Keeper address is not bonded in contract.",
    fixSuggestion: "Deposit keeper bond before claiming tasks.",
    action: "fix_input",
  },
  600: {
    name: "VolatilityExceeded",
    category: "CONTRACT_REVERT",
    explanation: "Market volatility exceeded safe operating parameters.",
    fixSuggestion: "Wait for market volatility to stabilize.",
    action: "wait",
  },
  601: {
    name: "VolatilityCircuitBreakerTripped",
    category: "CONTRACT_REVERT",
    explanation: "Volatility circuit breaker tripped.",
    fixSuggestion: "Admin reset required after market stabilization.",
    action: "wait",
  },
  602: {
    name: "VolatilityTimelockActive",
    category: "CONTRACT_REVERT",
    explanation: "Volatility reset timelock active.",
    fixSuggestion: "Wait for circuit breaker timelock to expire.",
    action: "wait",
  },
  700: {
    name: "UnsupportedSourceChain",
    category: "INVALID_ARGS",
    explanation: "Cross-chain source chain ID is unsupported.",
    fixSuggestion: "Select supported CCIP source chain.",
    action: "switch_network",
  },
  701: {
    name: "InvalidCrossChainPayload",
    category: "INVALID_ARGS",
    explanation: "Cross-chain payload format is invalid.",
    fixSuggestion: "Format CCIP payload per gateway spec.",
    action: "fix_input",
  },
  702: {
    name: "InvalidCrossChainSignature",
    category: "BAD_AUTH",
    explanation: "Cross-chain gateway signature is invalid.",
    fixSuggestion: "Verify relayer signatures.",
    action: "fix_input",
  },
  703: {
    name: "GatewayNotConfigured",
    category: "SIMULATION_FAILED",
    explanation: "Cross-chain CCIP gateway is not configured.",
    fixSuggestion: "Set CCIP gateway contract address.",
    action: "fix_input",
  },
  704: {
    name: "GatewayUnauthorized",
    category: "BAD_AUTH",
    explanation: "Caller is not an authorized CCIP gateway.",
    fixSuggestion: "Submit message via registered gateway.",
    action: "reconnect_wallet",
  },
  705: {
    name: "CrossChainNonceReplay",
    category: "DUPLICATE_TRANSACTION",
    explanation: "Cross-chain message nonce replay detected.",
    fixSuggestion: "Use incremented cross-chain nonce.",
    action: "retry",
  },
};

/**
 * Parses Soroban XDR error streams or raw strings (e.g., "HostError: Error(Contract, #3)" or "Error(Contract, #418)")
 * to extract the contract error code number.
 */
export function decodeSorobanContractError(
  input: unknown,
): ContractErrorDiagnostic | null {
  if (typeof input === "number") {
    const def = CONTRACT_ERROR_DEFINITIONS[input];
    if (def) {
      return {
        code: input,
        name: def.name,
        category: def.category,
        title: `Contract Error #${input}: ${def.name}`,
        explanation: def.explanation,
        fixSuggestion: def.fixSuggestion,
        action: def.action,
      };
    }
  }

  const str = String(input || "");
  const match =
    str.match(/Error\(\s*Contract\s*,\s*#?(\d+)\s*\)/i) ||
    str.match(/ContractError\s*#?(\d+)/i) ||
    str.match(/#(\d+)/);

  if (match && match[1]) {
    const codeNum = parseInt(match[1], 10);
    const def = CONTRACT_ERROR_DEFINITIONS[codeNum];
    if (def) {
      return {
        code: codeNum,
        name: def.name,
        category: def.category,
        title: `Contract Error #${codeNum}: ${def.name}`,
        explanation: def.explanation,
        fixSuggestion: def.fixSuggestion,
        action: def.action,
      };
    }
  }

  return null;
}
