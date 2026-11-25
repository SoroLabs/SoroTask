export type SimulationSeverity = "info" | "warning" | "critical";

export type SandboxInput = {
  taskId: string;
  targetContract: string;
  functionName: string;
  argsJson: string;
  gasBalanceXlm: number;
  intervalSeconds: number;
  forkLedger: number;
  forkRpcUrl: string;
  keeperCount: number;
  failureRatePercent: number;
};

export type SimulationError = {
  id: string;
  severity: SimulationSeverity;
  message: string;
  detail?: string;
  timestamp: string;
};

export type StateChange = {
  path: string;
  before: string;
  after: string;
  impact: "neutral" | "positive" | "negative";
};

export type CostProjection = {
  networkFeeXlm: number;
  rentFeeXlm: number;
  keeperFeeXlm: number;
  totalXlm: number;
};

export type SimulationResult = {
  id: string;
  status: "success" | "warning" | "blocked";
  mode: "remote" | "local-fallback";
  forkLedger: number;
  projectedAt: string;
  confidence: number;
  costs: CostProjection;
  stateChanges: StateChange[];
  warnings: string[];
  errors: SimulationError[];
};

export type RemoteSimulationTransport = {
  simulate: (input: SanitizedSandboxInput) => Promise<Partial<SimulationResult>>;
};

export type SanitizedSandboxInput = Omit<SandboxInput, "argsJson"> & {
  args: unknown[];
  argsJson: string;
};

const CONTRACT_ID_PATTERN = /^[A-Z0-9]{8,64}$/;
const FUNCTION_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{1,63}$/;
const HTTPS_OR_LOCAL_PATTERN = /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$))/i;

export class AnalyticsSandboxErrorTracker {
  private readonly entries: SimulationError[] = [];

  track(error: Omit<SimulationError, "id" | "timestamp">): SimulationError {
    const entry: SimulationError = {
      ...error,
      id: `err_${this.entries.length + 1}`,
      timestamp: new Date().toISOString(),
    };
    this.entries.push(entry);
    return entry;
  }

  list(): SimulationError[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.splice(0, this.entries.length);
  }
}

export function sanitizeSandboxInput(input: SandboxInput): SanitizedSandboxInput {
  const parsedArgs = parseArgs(input.argsJson);
  return {
    taskId: input.taskId.trim(),
    targetContract: input.targetContract.trim().toUpperCase(),
    functionName: input.functionName.trim(),
    args: parsedArgs,
    argsJson: JSON.stringify(parsedArgs),
    gasBalanceXlm: round(Math.max(0, Number(input.gasBalanceXlm))),
    intervalSeconds: Math.trunc(Number(input.intervalSeconds)),
    forkLedger: Math.trunc(Number(input.forkLedger)),
    forkRpcUrl: input.forkRpcUrl.trim(),
    keeperCount: Math.trunc(Number(input.keeperCount)),
    failureRatePercent: round(Math.max(0, Math.min(100, Number(input.failureRatePercent)))),
  };
}

export function validateSandboxInput(input: SanitizedSandboxInput): string[] {
  const errors: string[] = [];

  if (!input.taskId) errors.push("Task id is required.");
  if (!CONTRACT_ID_PATTERN.test(input.targetContract)) {
    errors.push("Target contract must be an uppercase contract id between 8 and 64 characters.");
  }
  if (!FUNCTION_NAME_PATTERN.test(input.functionName)) {
    errors.push("Function name must start with a letter or underscore and stay under 64 characters.");
  }
  if (input.intervalSeconds < 60) errors.push("Interval must be at least 60 seconds.");
  if (input.gasBalanceXlm <= 0) errors.push("Gas balance must be greater than 0 XLM.");
  if (input.forkLedger < 1) errors.push("Fork ledger must be a positive number.");
  if (!HTTPS_OR_LOCAL_PATTERN.test(input.forkRpcUrl)) {
    errors.push("Fork RPC URL must use HTTPS, except localhost test endpoints.");
  }
  if (input.keeperCount < 1 || input.keeperCount > 100) {
    errors.push("Keeper count must be between 1 and 100.");
  }

  return errors;
}

export async function runAnalyticsSimulation({
  input,
  transport,
  tracker = new AnalyticsSandboxErrorTracker(),
  now = () => new Date(),
}: {
  input: SandboxInput;
  transport?: RemoteSimulationTransport;
  tracker?: AnalyticsSandboxErrorTracker;
  now?: () => Date;
}): Promise<SimulationResult> {
  const sanitized = sanitizeSandboxInput(input);
  const validationErrors = validateSandboxInput(sanitized);
  const projectedAt = now().toISOString();

  if (validationErrors.length > 0) {
    validationErrors.forEach((message) => tracker.track({ severity: "critical", message }));
    return buildBlockedResult(sanitized, projectedAt, tracker.list());
  }

  const local = buildLocalProjection(sanitized, projectedAt, []);
  if (!transport) return local;

  try {
    const remote = await transport.simulate(sanitized);
    return normalizeRemoteResult(remote, local, projectedAt);
  } catch (error) {
    const entry = tracker.track({
      severity: "warning",
      message: "Remote fork simulation failed; local fallback projection was used.",
      detail: error instanceof Error ? error.message : String(error),
    });

    return {
      ...local,
      mode: "local-fallback",
      status: "warning",
      confidence: Math.min(local.confidence, 72),
      warnings: [...local.warnings, entry.message],
      errors: tracker.list(),
    };
  }
}

function parseArgs(argsJson: string): unknown[] {
  const trimmed = argsJson.trim();
  if (!trimmed) return [];

  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Arguments JSON must be an array.");
  }
  return parsed;
}

function buildBlockedResult(
  input: SanitizedSandboxInput,
  projectedAt: string,
  errors: SimulationError[],
): SimulationResult {
  return {
    id: `sim_${input.taskId || "invalid"}`,
    status: "blocked",
    mode: "local-fallback",
    forkLedger: Math.max(0, input.forkLedger),
    projectedAt,
    confidence: 0,
    costs: { networkFeeXlm: 0, rentFeeXlm: 0, keeperFeeXlm: 0, totalXlm: 0 },
    stateChanges: [],
    warnings: [],
    errors,
  };
}

function buildLocalProjection(
  input: SanitizedSandboxInput,
  projectedAt: string,
  errors: SimulationError[],
): SimulationResult {
  const argWeight = Math.max(1, input.argsJson.length / 120);
  const networkFeeXlm = round(0.00001 * argWeight);
  const rentFeeXlm = round(0.00018 + input.argsJson.length * 0.000002);
  const keeperFeeXlm = round(0.004 * Math.max(1, Math.log2(input.keeperCount + 1)));
  const totalXlm = round(networkFeeXlm + rentFeeXlm + keeperFeeXlm);
  const afterBalance = round(input.gasBalanceXlm - totalXlm);
  const warnings = buildWarnings(input, totalXlm, afterBalance);

  return {
    id: `sim_${input.taskId}_${input.forkLedger}`,
    status: warnings.length > 0 ? "warning" : "success",
    mode: "local-fallback",
    forkLedger: input.forkLedger,
    projectedAt,
    confidence: warnings.length > 0 ? 84 : 91,
    costs: { networkFeeXlm, rentFeeXlm, keeperFeeXlm, totalXlm },
    stateChanges: [
      {
        path: `tasks.${input.taskId}.last_run_ledger`,
        before: String(input.forkLedger - input.intervalSeconds),
        after: String(input.forkLedger),
        impact: "positive",
      },
      {
        path: `tasks.${input.taskId}.gas_balance_xlm`,
        before: formatXlm(input.gasBalanceXlm),
        after: formatXlm(afterBalance),
        impact: afterBalance < 1 ? "negative" : "neutral",
      },
      {
        path: `tasks.${input.taskId}.execution_count`,
        before: "41",
        after: "42",
        impact: "positive",
      },
      {
        path: `contracts.${input.targetContract}.${input.functionName}.args_hash`,
        before: "unchanged",
        after: hashLite(input.argsJson),
        impact: "neutral",
      },
    ],
    warnings,
    errors,
  };
}

function normalizeRemoteResult(
  remote: Partial<SimulationResult>,
  fallback: SimulationResult,
  projectedAt: string,
): SimulationResult {
  const costs = remote.costs ?? fallback.costs;
  const warnings = remote.warnings ?? fallback.warnings;
  return {
    ...fallback,
    ...remote,
    mode: "remote",
    projectedAt,
    costs,
    warnings,
    stateChanges: remote.stateChanges?.length ? remote.stateChanges : fallback.stateChanges,
    errors: remote.errors ?? [],
    status: remote.status ?? (warnings.length > 0 ? "warning" : "success"),
    confidence: remote.confidence ?? 96,
  };
}

function buildWarnings(input: SanitizedSandboxInput, totalXlm: number, afterBalance: number): string[] {
  const warnings: string[] = [];
  if (input.failureRatePercent >= 25) {
    warnings.push("Keeper failure rate is high enough to affect execution reliability.");
  }
  if (afterBalance < totalXlm * 3) {
    warnings.push("Projected gas balance leaves fewer than three future executions funded.");
  }
  if (input.intervalSeconds < 300) {
    warnings.push("Short intervals can amplify fees and rate-limit exposure.");
  }
  return warnings;
}

function hashLite(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return `0x${hash.toString(16).padStart(8, "0")}`;
}

function round(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 1_000_000) / 1_000_000;
}

function formatXlm(value: number): string {
  return `${round(value).toFixed(6)} XLM`;
}
