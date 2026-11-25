// Frontend error model for Soroban / Stellar / wallet failures.

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

export const ALL_CONTRACT_ERROR_CATEGORIES: ContractErrorCategory[] = [
  "WALLET_NOT_INSTALLED",
  "WALLET_LOCKED",
  "WALLET_REJECTED",
  "WRONG_NETWORK",
  "INSUFFICIENT_BALANCE",
  "INSUFFICIENT_FEE",
  "BAD_SEQUENCE",
  "BAD_AUTH",
  "TX_TOO_LATE",
  "TX_TOO_EARLY",
  "DUPLICATE_TRANSACTION",
  "SIMULATION_FAILED",
  "CONTRACT_REVERT",
  "INVALID_ARGS",
  "INSUFFICIENT_GAS",
  "STATE_EXPIRED",
  "NETWORK_ERROR",
  "TIMEOUT",
  "RATE_LIMITED",
  "SERVER_ERROR",
  "UNKNOWN",
];

export type ContractErrorAction =
  | "retry"
  | "wait"
  | "fix_input"
  | "increase_gas"
  | "reconnect_wallet"
  | "switch_network"
  | "none";

export interface MappedContractError {
  category: ContractErrorCategory;
  title: string;
  userMessage: string;
  action: ContractErrorAction;
  retryable: boolean;
  errorCode?: number;
  errorName?: string;
  fixSuggestion?: string;
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

function collectDiagnosticText(value: unknown, seen = new Set<object>()): string[] {
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
  const stripped = input.trim().replace(/^0x/i, "").replace(/[\s:_-]/g, "");
  if (
    !stripped ||
    stripped.length > 1_000_000 ||
    stripped.length % 2 !== 0 ||
    !/^[\da-f]+$/i.test(stripped)
  ) {
    return null;
  }

  const bytes = new Uint8Array(stripped.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)));
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
    return cleanDecodedText(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
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
      format: hexDecoded ? "hex" as const : "base64" as const,
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
    decodedText.match(/\b(?:error|contracterror|code)\s*[:=#]\s*([A-Z][A-Z0-9_]{2,})\b/i) ??
    decodedText.match(/\b(TX_[A-Z0-9_]+|OP_[A-Z0-9_]+|INSUFFICIENT_GAS|CONTRACT_PANIC)\b/i);
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

  const str = String(input || "");
  const match = str.match(/Error\(\s*Contract\s*,\s*#?(\d+)\s*\)/i) || str.match(/ContractError\s*#?(\d+)/i) || str.match(/#(\d+)/);

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
  const diagnostic = diagnosticPayload === undefined
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
