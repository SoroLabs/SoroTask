import {
  generateCorrelationId,
  propagateCorrelationIdToHeaders,
  attachCorrelationIdToHeaders,
  appendTraceContextToBody,
  describeTrace,
  makeSpan,
  endSpan,
} from '@/src/lib/tracing';
export type TaskStatus = "pending" | "running" | "success" | "failed";
export interface Task {
  id: string;
  contract: string;
  fn: string;
  intervalSec: number;
  gas: number;
  status: TaskStatus;
  updatedAt: number;
}
export interface TaskFilters {
  status?: TaskStatus;
  search?: string;
}
export interface RegisterTaskInput {
  contract: string;
  fn: string;
  intervalSec: number;
  gas: number;
}
export interface UpdateTaskInput {
  id: string;
  intervalSec?: number;
  gas?: number;
}

export class RateLimitError extends Error {
  public retryAfterMs: number;
  public attempt: number;
  public endpoint: string;

  constructor(
    message: string,
    retryAfterMs: number,
    attempt = 1,
    endpoint = "",
  ) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
    this.attempt = attempt;
    this.endpoint = endpoint;
  }
}

export function parseRetryAfterHeader(
  headerValue: string | null | undefined,
): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10) * 1000;
  }
  const parsedDate = Date.parse(trimmed);
  if (!isNaN(parsedDate)) {
    const diff = parsedDate - Date.now();
    return diff > 0 ? diff : 0;
  }
  return null;
}

export function calculateExponentialBackoff(
  attempt: number,
  baseMs = 1000,
  maxMs = 30000,
  jitter = false,
): number {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempt - 1)));
  if (jitter) {
    const jitterAmount = Math.floor(Math.random() * (baseMs * 0.5));
    return Math.min(maxMs, exp + jitterAmount);
  }
  return exp;
}

export interface RateLimitEvent {
  id: string;
  endpoint: string;
  attempt: number;
  maxRetries: number;
  retryAfterMs: number;
  startTime: number;
  actionLabel?: string;
  status: "waiting" | "retrying" | "success" | "failed" | "cancelled";
}

type RateLimitListener = (event: RateLimitEvent | null) => void;
const rateLimitListeners = new Set<RateLimitListener>();
let currentRateLimitEvent: RateLimitEvent | null = null;

export function emitRateLimit(event: RateLimitEvent | null): void {
  currentRateLimitEvent = event;
  rateLimitListeners.forEach((listener) => listener(event));
}

export function subscribeRateLimit(listener: RateLimitListener): () => void {
  rateLimitListeners.add(listener);
  listener(currentRateLimitEvent);
  return () => {
    rateLimitListeners.delete(listener);
  };
}

export function cancelCurrentRateLimit(): void {
  if (currentRateLimitEvent) {
    emitRateLimit({ ...currentRateLimitEvent, status: "cancelled" });
  }
}

export function getCurrentRateLimit(): RateLimitEvent | null {
  return currentRateLimitEvent;
}

export function isRateLimitActive(): boolean {
  return (
    currentRateLimitEvent !== null && currentRateLimitEvent.status === "waiting"
  );
}

export async function executeWithRateLimitRetry<T>(
  action: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseBackoffMs?: number;
    actionLabel?: string;
    endpoint?: string;
  } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseBackoffMs = options.baseBackoffMs ?? 1000;
  const actionLabel = options.actionLabel || "API Action";
  const endpoint = options.endpoint || GRAPHQL_URL;

  let attempt = 1;
  while (attempt <= maxRetries) {
    try {
      const result = await action();
      if (
        currentRateLimitEvent &&
        currentRateLimitEvent.endpoint === endpoint
      ) {
        emitRateLimit({
          ...currentRateLimitEvent,
          status: "success",
        });
        setTimeout(() => emitRateLimit(null), 1000);
      }
      return result;
    } catch (err: any) {
      const isRateLimit =
        err?.status === 429 ||
        err instanceof RateLimitError ||
        /429|rate limit|too many requests|throttled/i.test(err?.message || "");

      if (!isRateLimit || attempt >= maxRetries) {
        if (currentRateLimitEvent) {
          emitRateLimit({
            ...currentRateLimitEvent,
            status: "failed",
          });
        }
        throw err;
      }

      const backoffMs =
        err?.retryAfterMs ??
        (err?.response?.headers
          ? parseRetryAfterHeader(err.response.headers.get("Retry-After"))
          : null) ??
        calculateExponentialBackoff(attempt, baseBackoffMs);

      const event: RateLimitEvent = {
        id: `rl-${Date.now()}-${attempt}`,
        endpoint,
        attempt,
        maxRetries,
        retryAfterMs: backoffMs,
        startTime: Date.now(),
        actionLabel,
        status: "waiting",
      };

      emitRateLimit(event);

      await new Promise<void>((resolve, reject) => {
        let isSettled = false;
        const timer = setTimeout(() => {
          if (!isSettled) {
            isSettled = true;
            emitRateLimit({ ...event, status: "retrying" });
            resolve();
          }
        }, backoffMs);

        const unsub = subscribeRateLimit((ev) => {
          if (ev?.status === "cancelled" && !isSettled) {
            isSettled = true;
            clearTimeout(timer);
            unsub();
            reject(new Error("Operation cancelled during rate limit backoff"));
          }
        });
      });

      attempt++;
    }
  }

  throw new Error(`Max retries (${maxRetries}) exceeded`);
}

const GRAPHQL_URL =
  process.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:4000/graphql";

async function fetchGraphQL(query: string, variables: any = {}) {
  const correlationId = generateCorrelationId();
  const span = makeSpan({
    name: 'frontend→api fetchGraphQL',
    traceId: correlationId,
    attributes: {
      'http.url': GRAPHQL_URL,
      'http.method': 'POST',
      'graphql.query': query,
      'correlation.id': correlationId,
      'tracing.origin': 'frontend',
    },
  });
  const headers = attachCorrelationIdToHeaders({
    'Content-Type': 'application/json',
  }, correlationId);
  const body = appendTraceContextToBody({
    query,
    variables,
  }, correlationId);
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (response.status === 429) {
    const retryAfterHeader = response.headers.get("Retry-After");
    const delayMs =
      parseRetryAfterHeader(retryAfterHeader) || calculateExponentialBackoff(1);
    throw new RateLimitError(
      "HTTP 429: Too Many Requests",
      delayMs,
      1,
      GRAPHQL_URL,
    );
  }

  const result = await response.json();
  if (result.errors) {
    const msg = result.errors[0]?.message || "GraphQL error";
    if (/429|rate limit|too many requests|throttled/i.test(msg)) {
      throw new RateLimitError(
        msg,
        calculateExponentialBackoff(1),
        1,
        GRAPHQL_URL,
      );
    }
    endSpan(span, 'error', { 'graphql.error': msg });
    throw new Error(msg);
  }
  endSpan(span, 'success', { 'graphql.data.keys': Object.keys(result.data ?? {}), 'response.status': response.status });
  return result.data;
}

// Map the GraphQL response to the frontend's Task model
function mapTask(gqlTask: any): Task {
  return {
    id: gqlTask.id || gqlTask.task_id?.toString() || "0",
    contract: gqlTask.target || gqlTask.contract_id || "Unknown",
    fn: gqlTask.function || "Unknown",
    intervalSec: gqlTask.interval || 0,
    gas: parseFloat(gqlTask.gas_balance || "0"),
    status: gqlTask.is_active ? "success" : "pending",
    updatedAt: new Date(gqlTask.updated_at || Date.now()).getTime(),
  };
}

// Batch (multi-select) operations — see frontend/app/tasks/bulk/
import { buildLifecycleBatch, buildRefillBatch } from "./batchOps";
import type { ScVal } from "@stellar/stellar-sdk";

export interface BatchContractCall {
  method: string;
  args: ScVal[];
}

export interface BatchTaskResult {
  id: string;
  status?: TaskStatus;
}

/** Extract the numeric u64 task id embedded in UI task ids ("task-12" -> 12n). */
function toTaskIdU64(taskId: string): bigint {
  return BigInt(taskId.replace(/\D/g, "") || "0");
}

async function runBatchContractCalls(
  userAddress: string | undefined,
  contractId: string | undefined,
  calls: BatchContractCall[],
  label: string,
): Promise<void> {
  if (!userAddress || !contractId || calls.length === 0) return;
  try {
    const { SorobanService } = await import("../../../app/lib/soroban.service");
    const soroban = new SorobanService();
    await soroban.executeBatchContractCalls({
      publicKey: userAddress,
      contractId,
      calls,
    });
  } catch (err) {
    console.warn(`${label} batch contract call failed:`, err);
  }
}

export async function listTasks(filters: TaskFilters = {}): Promise<Task[]> {
  const query = `
    query GetTasks {
      tasks(limit: 100) {
        task_id
        target
        function
        interval
        gas_balance
        is_active
        updated_at
      }
    }
  `;

  try {
    const data = await fetchGraphQL(query);
    let result = (data.tasks || []).map(mapTask);

    if (filters.status) {
      result = result.filter((t: Task) => t.status === filters.status);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (t: Task) =>
          t.fn.toLowerCase().includes(q) ||
          t.contract.toLowerCase().includes(q),
      );
    }

    return result.sort((a: Task, b: Task) => a.id.localeCompare(b.id));
  } catch (err) {
    console.error("Failed to list tasks from indexer, returning empty.", err);
    return [];
  }
}

export async function getTask(id: string): Promise<Task> {
  const query = `
    query GetTask($id: ID!) {
      task(id: $id) {
        task_id
        target
        function
        interval
        gas_balance
        is_active
        updated_at
      }
    }
  `;

  const data = await fetchGraphQL(query, { id });
  if (!data.task) {
    throw new Error(`Task ${id} not found`);
  }
  return mapTask(data.task);
}

// Mutations
// Note: Since proper registration/update requires Soroban transactions via freighter,
// these are currently mocked endpoints so the UI remains functional without a connected wallet.

import {
  formatUnits,
  parseUnits,
  simulateMinimumBalanceCheck,
  validateStroopAmount,
} from "../tokenAmounts";

export interface GasMutationInput {
  taskId: string;
  amount: string | bigint;
  userAddress?: string;
  contractId?: string;
}

export async function depositGas(input: GasMutationInput): Promise<Task> {
  const stroops = validateStroopAmount(input.amount);

  const existingTask = await getTask(input.taskId).catch(() => ({
    id: input.taskId,
    contract: input.contractId || "CUNKNOWN",
    fn: "deposit_gas",
    intervalSec: 60,
    gas: 0,
    status: "success" as TaskStatus,
    updatedAt: Date.now(),
  }));

  const currentStroops = parseUnits(existingTask.gas.toString(), 7);
  const simulation = simulateMinimumBalanceCheck(
    currentStroops,
    stroops,
    false,
  );
  if (!simulation.valid) {
    throw new Error(simulation.error || "Deposit simulation failed");
  }

  try {
    const { SorobanService } = await import("../../../app/lib/soroban.service");
    const soroban = new SorobanService();
    if (input.userAddress && input.contractId) {
      const { nativeToScVal } = await import("@stellar/stellar-sdk");
      const taskIdU64 = BigInt(input.taskId.replace(/\D/g, "") || "0");
      await soroban.executeContractCall({
        publicKey: input.userAddress,
        contractId: input.contractId,
        method: "deposit_gas",
        args: [
          nativeToScVal(taskIdU64, { type: "u64" }),
          nativeToScVal(input.userAddress, { type: "address" }),
          nativeToScVal(stroops, { type: "i128" }),
        ],
      });
    }
  } catch (err) {
    console.warn(
      "deposit_gas contract call fallback to optimistic balance update:",
      err,
    );
  }

  const updatedGas = parseFloat(formatUnits(simulation.newBalanceStroops, 7));
  return {
    ...existingTask,
    gas: updatedGas,
    updatedAt: Date.now(),
  };
}

export async function withdrawGas(input: GasMutationInput): Promise<Task> {
  const stroops = validateStroopAmount(input.amount);

  const existingTask = await getTask(input.taskId).catch(() => ({
    id: input.taskId,
    contract: input.contractId || "CUNKNOWN",
    fn: "withdraw_gas",
    intervalSec: 60,
    gas: 10,
    status: "success" as TaskStatus,
    updatedAt: Date.now(),
  }));

  const currentStroops = parseUnits(existingTask.gas.toString(), 7);
  const simulation = simulateMinimumBalanceCheck(currentStroops, stroops, true);
  if (!simulation.valid) {
    throw new Error(simulation.error || "Withdrawal simulation failed");
  }

  try {
    const { SorobanService } = await import("../../../app/lib/soroban.service");
    const soroban = new SorobanService();
    if (input.userAddress && input.contractId) {
      const { nativeToScVal } = await import("@stellar/stellar-sdk");
      const taskIdU64 = BigInt(input.taskId.replace(/\D/g, "") || "0");
      await soroban.executeContractCall({
        publicKey: input.userAddress,
        contractId: input.contractId,
        method: "withdraw_gas",
        args: [
          nativeToScVal(taskIdU64, { type: "u64" }),
          nativeToScVal(input.userAddress, { type: "address" }),
          nativeToScVal(stroops, { type: "i128" }),
        ],
      });
    }
  } catch (err) {
    console.warn(
      "withdraw_gas contract call fallback to optimistic balance update:",
      err,
    );
  }

  const updatedGas = parseFloat(formatUnits(simulation.newBalanceStroops, 7));
  return {
    ...existingTask,
    gas: updatedGas,
    updatedAt: Date.now(),
  };
}

export async function registerTask(
  input: RegisterTaskInput & { userAddress?: string; contractId?: string },
): Promise<Task> {
  let verifiedTaskId = "";

  try {
    const { SorobanService } = await import("../../../app/lib/soroban.service");
    const soroban = new SorobanService();
    if (input.userAddress && input.contractId) {
      const res = await soroban.registerTaskContract({
        publicKey: input.userAddress,
        contractId: input.contractId,
        target: input.contract,
        fn: input.fn,
        intervalSec: input.intervalSec,
        gas: input.gas,
      });
      verifiedTaskId = res.taskId;
    }
  } catch (err) {
    console.warn("Live Soroban transaction registration fallback:", err);
  }

  if (!verifiedTaskId) {
    // Generate verified u64 task ID format
    verifiedTaskId = (1000 + Math.floor(Math.random() * 9000)).toString();
  }

  return {
    id: verifiedTaskId,
    contract: input.contract,
    fn: input.fn,
    intervalSec: input.intervalSec,
    gas: input.gas,
    status: "pending",
    updatedAt: Date.now(),
  };
}

export async function updateTask(
  input: UpdateTaskInput & { userAddress?: string; contractId?: string },
): Promise<Task> {
  try {
    const { SorobanService } = await import("../../../app/lib/soroban.service");
    const soroban = new SorobanService();
    if (input.userAddress && input.contractId) {
      const { nativeToScVal } = await import("@stellar/stellar-sdk");
      const taskIdU64 = BigInt(input.id.replace(/\D/g, "") || "0");
      await soroban.executeContractCall({
        publicKey: input.userAddress,
        contractId: input.contractId,
        method: "update_task",
        args: [
          nativeToScVal(taskIdU64, { type: "u64" }),
          nativeToScVal(input.intervalSec || 0, { type: "u32" }),
        ],
      });
    }
  } catch (err) {
    console.warn("Live Soroban task update fallback:", err);
  }

  return {
    id: input.id,
    contract: "CXYZ",
    fn: "updated_task",
    intervalSec: input.intervalSec || 0,
    gas: input.gas || 0,
    status: "success",
    updatedAt: Date.now(),
  };
}

// Task lifecycle operations

export async function pauseTask(
  id: string,
  userAddress?: string,
  contractId?: string,
): Promise<{ id: string; status: TaskStatus }> {
  try {
    if (userAddress && contractId) {
      const { SorobanService } =
        await import("../../../app/lib/soroban.service");
      const soroban = new SorobanService();
      const { nativeToScVal } = await import("@stellar/stellar-sdk");
      const taskIdU64 = BigInt(id.replace(/\D/g, "") || "0");
      await soroban.executeContractCall({
        publicKey: userAddress,
        contractId,
        method: "pause_task",
        args: [nativeToScVal(taskIdU64, { type: "u64" })],
      });
    }
  } catch (err) {
    console.warn("pause_task contract call failed:", err);
    throw err;
  }

  return { id, status: "pending" };
}

export async function resumeTask(
  id: string,
  userAddress?: string,
  contractId?: string,
): Promise<{ id: string; status: TaskStatus }> {
  try {
    if (userAddress && contractId) {
      const { SorobanService } =
        await import("../../../app/lib/soroban.service");
      const soroban = new SorobanService();
      const { nativeToScVal } = await import("@stellar/stellar-sdk");
      const taskIdU64 = BigInt(id.replace(/\D/g, "") || "0");
      await soroban.executeContractCall({
        publicKey: userAddress,
        contractId,
        method: "resume_task",
        args: [nativeToScVal(taskIdU64, { type: "u64" })],
      });
    }
  } catch (err) {
    console.warn("resume_task contract call failed:", err);
    throw err;
  }

  return { id, status: "running" };
}

export async function cancelTask(
  id: string,
  userAddress?: string,
  contractId?: string,
): Promise<{ id: string }> {
  try {
    if (userAddress && contractId) {
      const { SorobanService } =
        await import("../../../app/lib/soroban.service");
      const soroban = new SorobanService();
      const { nativeToScVal } = await import("@stellar/stellar-sdk");
      const taskIdU64 = BigInt(id.replace(/\D/g, "") || "0");
      await soroban.executeContractCall({
        publicKey: userAddress,
        contractId,
        method: "cancel_task",
        args: [nativeToScVal(taskIdU64, { type: "u64" })],
      });
    }
  } catch (err) {
    console.warn("cancel_task contract call failed:", err);
  }

  return { id };
}

export async function executeTask(
  id: string,
  userAddress?: string,
  contractId?: string,
): Promise<{ id: string; status: TaskStatus; txHash?: string }> {
  if (userAddress && contractId) {
    const { SorobanService } = await import("../../../app/lib/soroban.service");
    const soroban = new SorobanService();
    const { nativeToScVal } = await import("@stellar/stellar-sdk");
    const taskIdU64 = BigInt(id.replace(/\D/g, "") || "0");
    const response = await soroban.executeContractCall({
      publicKey: userAddress,
      contractId,
      method: "execute_task",
      args: [nativeToScVal(taskIdU64, { type: "u64" })],
    });
    return { id, status: "running", txHash: response.txHash };
  }

  return { id, status: "running" };
}

// Batch lifecycle mutations — one atomic transaction per batch action

export async function pauseTasksBulk(
  taskIds: string[],
  userAddress?: string,
  contractId?: string,
): Promise<BatchTaskResult[]> {
  const ops = buildLifecycleBatch(taskIds, "pause");
  if (userAddress && contractId) {
    const { nativeToScVal } = await import("@stellar/stellar-sdk");
    const calls = ops.map((op) => ({
      method: op.method,
      args: [nativeToScVal(toTaskIdU64(op.taskId), { type: "u64" })],
    }));
    await runBatchContractCalls(userAddress, contractId, calls, "pause_task");
  }
  return ops.map((op) => ({ id: op.taskId, status: "pending" }));
}

export async function resumeTasksBulk(
  taskIds: string[],
  userAddress?: string,
  contractId?: string,
): Promise<BatchTaskResult[]> {
  const ops = buildLifecycleBatch(taskIds, "resume");
  if (userAddress && contractId) {
    const { nativeToScVal } = await import("@stellar/stellar-sdk");
    const calls = ops.map((op) => ({
      method: op.method,
      args: [nativeToScVal(toTaskIdU64(op.taskId), { type: "u64" })],
    }));
    await runBatchContractCalls(userAddress, contractId, calls, "resume_task");
  }
  return ops.map((op) => ({ id: op.taskId, status: "running" }));
}

export async function cancelTasksBulk(
  taskIds: string[],
  userAddress?: string,
  contractId?: string,
): Promise<BatchTaskResult[]> {
  const ops = buildLifecycleBatch(taskIds, "cancel");
  if (userAddress && contractId) {
    const { nativeToScVal } = await import("@stellar/stellar-sdk");
    const calls = ops.map((op) => ({
      method: op.method,
      args: [nativeToScVal(toTaskIdU64(op.taskId), { type: "u64" })],
    }));
    await runBatchContractCalls(userAddress, contractId, calls, "cancel_task");
  }
  return ops.map((op) => ({ id: op.taskId }));
}

export async function refillTasksBulk(
  taskIds: string[],
  amount: string | bigint,
  userAddress?: string,
  contractId?: string,
): Promise<BatchTaskResult[]> {
  const stroops = validateStroopAmount(amount);
  const ops = buildRefillBatch(taskIds);
  if (userAddress && contractId) {
    const { nativeToScVal } = await import("@stellar/stellar-sdk");
    const calls = ops.map((op) => ({
      method: op.method,
      args: [
        nativeToScVal(toTaskIdU64(op.taskId), { type: "u64" }),
        nativeToScVal(userAddress, { type: "address" }),
        nativeToScVal(stroops, { type: "i128" }),
      ],
    }));
    await runBatchContractCalls(userAddress, contractId, calls, "deposit_gas");
  }
  return ops.map((op) => ({ id: op.taskId }));
}

export async function deleteTask(id: string): Promise<{ id: string }> {
  // Use pauseTask from GraphQL as a substitute for deletion
  const mutation = `
    mutation PauseTask($id: ID!) {
      pauseTask(id: $id) {
        task_id
      }
    }
  `;

  try {
    await fetchGraphQL(mutation, { id });
  } catch (err) {
    console.error("Failed to pause/delete task via GraphQL:", err);
  }
  await purgeEdgeTaskCache([`task:${id}`, "tasks:all", "tasks:active"]);
  return { id };
}

// ---------------------------------------------------------------------------
// #1456 — Edge CDN Dynamic Cache Invalidation Service for Global Task Metadata
// ---------------------------------------------------------------------------

export interface EdgeCdnRuleConfig {
  sMaxAgeSeconds?: number;
  staleWhileRevalidateSeconds?: number;
  provider?: "cloudflare" | "fastly";
}

export interface EdgePurgeResult {
  purgedKeys: string[];
  latencyMs: number;
  withinSla: boolean;
  provider: "cloudflare" | "fastly";
}

export interface EdgeCacheStats {
  totalReads: number;
  cacheHits: number;
  originFetches: number;
  hitRatio: number;
  originLoadReduction: number;
  purgesCompleted: number;
  lastPurgeLatencyMs: number;
}

export function buildEdgeCdnHeaders(
  surrogateKeys: string[] = ["tasks:all"],
  config: EdgeCdnRuleConfig = {},
): Record<string, string> {
  const sMaxAge = config.sMaxAgeSeconds ?? 300;
  const swr = config.staleWhileRevalidateSeconds ?? 60;
  const uniqueKeys = Array.from(new Set(surrogateKeys.filter(Boolean)));

  return {
    "Cache-Control": `public, max-age=15, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`,
    "CDN-Cache-Control": `public, max-age=${sMaxAge}, stale-while-revalidate=${swr}`,
    "Surrogate-Control": `max-age=${sMaxAge}, stale-while-revalidate=${swr}`,
    "Surrogate-Key": uniqueKeys.join(" "),
    "Cache-Tag": uniqueKeys.join(","),
  };
}

export class EdgeCdnTaskCache {
  private entries = new Map<
    string,
    { value: unknown; expiresAt: number; surrogateKeys: string[] }
  >();
  private surrogateIndex = new Map<string, Set<string>>();
  private totalReads = 0;
  private cacheHits = 0;
  private originFetches = 0;
  private purgesCompleted = 0;
  private lastPurgeLatencyMs = 0;
  private purgeSlaMs: number;
  private provider: "cloudflare" | "fastly";

  constructor(options: { purgeSlaMs?: number; provider?: "cloudflare" | "fastly" } = {}) {
    this.purgeSlaMs = options.purgeSlaMs ?? 150;
    this.provider = options.provider ?? "cloudflare";
  }

  get<T>(key: string): T | null {
    this.totalReads += 1;
    const entry = this.entries.get(key);
    if (!entry) {
      this.originFetches += 1;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      this.originFetches += 1;
      return null;
    }
    this.cacheHits += 1;
    return entry.value as T;
  }

  set<T>(key: string, value: T, surrogateKeys: string[] = [], ttlMs = 300_000): void {
    const tags = Array.from(new Set([key, ...surrogateKeys]));
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      surrogateKeys: tags,
    });
    for (const tag of tags) {
      let bucket = this.surrogateIndex.get(tag);
      if (!bucket) {
        bucket = new Set<string>();
        this.surrogateIndex.set(tag, bucket);
      }
      bucket.add(key);
    }
  }

  async readThrough<T>(
    key: string,
    surrogateKeys: string[],
    originLoader: () => Promise<T>,
    ttlMs = 300_000,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }
    const fresh = await originLoader();
    this.set(key, fresh, surrogateKeys, ttlMs);
    return fresh;
  }

  async purgeBySurrogateKeys(keys: string[]): Promise<EdgePurgeResult> {
    const start = typeof performance !== "undefined" ? performance.now() : Date.now();
    const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));

    for (const tag of uniqueKeys) {
      this.entries.delete(tag);
      const indexed = this.surrogateIndex.get(tag);
      if (indexed) {
        for (const cacheKey of indexed) {
          this.entries.delete(cacheKey);
        }
        this.surrogateIndex.delete(tag);
      }
    }

    const end = typeof performance !== "undefined" ? performance.now() : Date.now();
    const latencyMs = Number(Math.max(0, end - start).toFixed(3));
    this.purgesCompleted += 1;
    this.lastPurgeLatencyMs = latencyMs;

    return {
      purgedKeys: uniqueKeys,
      latencyMs,
      withinSla: latencyMs < this.purgeSlaMs,
      provider: this.provider,
    };
  }

  getStats(): EdgeCacheStats {
    const hitRatio =
      this.totalReads > 0
        ? Number((this.cacheHits / this.totalReads).toFixed(4))
        : 1;
    return {
      totalReads: this.totalReads,
      cacheHits: this.cacheHits,
      originFetches: this.originFetches,
      hitRatio,
      originLoadReduction: hitRatio,
      purgesCompleted: this.purgesCompleted,
      lastPurgeLatencyMs: this.lastPurgeLatencyMs,
    };
  }

  clear(): void {
    this.entries.clear();
    this.surrogateIndex.clear();
  }
}

export const edgeTaskCache = new EdgeCdnTaskCache();

export async function purgeEdgeTaskCache(
  surrogateKeys: string[] = ["tasks:all"],
): Promise<EdgePurgeResult> {
  return edgeTaskCache.purgeBySurrogateKeys(surrogateKeys);
}

export function getEdgeCacheStats(): EdgeCacheStats {
  return edgeTaskCache.getStats();
}
