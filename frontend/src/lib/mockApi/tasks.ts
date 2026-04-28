// In-memory mock of the task API.
//
// Real endpoints don't exist yet. This module gives the query-layer
// spike something to fetch against so the patterns can be exercised end
// to end. When the real API client lands, the hook signatures stay the
// same — only the bodies of these functions change.

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

// Knobs the demo route flips to make the patterns visible without
// needing real network failures. Tests inject their own values via
// `__setMockApi(...)`.
export interface MockApiOptions {
  latencyMs: number;
  failureRate: number; // 0..1
}

const DEFAULT_OPTIONS: MockApiOptions = {
  latencyMs: 350,
  failureRate: 0,
};

let store: Map<string, Task> = seed();
let options: MockApiOptions = { ...DEFAULT_OPTIONS };

function seed(): Map<string, Task> {
  const tasks: Task[] = [
    {
      id: "task-1",
      contract: "CABCDEF1234",
      fn: "harvest_yield",
      intervalSec: 3600,
      gas: 10,
      status: "success",
      updatedAt: Date.now(),
    },
    {
      id: "task-2",
      contract: "CXYZ987",
      fn: "rebalance",
      intervalSec: 86400,
      gas: 50,
      status: "pending",
      updatedAt: Date.now(),
    },
    {
      id: "task-3",
      contract: "CFAILS01",
      fn: "claim_rewards",
      intervalSec: 300,
      gas: 5,
      status: "failed",
      updatedAt: Date.now(),
    },
  ];
  return new Map(tasks.map((t) => [t.id, t]));
}

function delay(): Promise<void> {
  if (options.latencyMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, options.latencyMs));
}

function maybeFail(label: string): void {
  if (Math.random() < options.failureRate) {
    throw new Error(`Mock RPC error in ${label}`);
  }
}

export async function listTasks(filters: TaskFilters = {}): Promise<Task[]> {
  await delay();
  maybeFail("listTasks");
  let result = Array.from(store.values());
  if (filters.status) {
    result = result.filter((t) => t.status === filters.status);
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (t) =>
        t.fn.toLowerCase().includes(q) ||
        t.contract.toLowerCase().includes(q),
    );
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export async function getTask(id: string): Promise<Task> {
  await delay();
  maybeFail("getTask");
  const task = store.get(id);
  if (!task) {
    const err = new Error(`Task ${id} not found`);
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
  return task;
}

export async function registerTask(input: RegisterTaskInput): Promise<Task> {
  await delay();
  maybeFail("registerTask");
  const id = `task-${store.size + 1}-${Math.random().toString(36).slice(2, 6)}`;
  const task: Task = {
    id,
    ...input,
    status: "pending",
    updatedAt: Date.now(),
  };
  store.set(id, task);
  return task;
}

export async function updateTask(input: UpdateTaskInput): Promise<Task> {
  await delay();
  maybeFail("updateTask");
  const existing = store.get(input.id);
  if (!existing) {
    const err = new Error(`Task ${input.id} not found`);
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
  const next: Task = {
    ...existing,
    intervalSec: input.intervalSec ?? existing.intervalSec,
    gas: input.gas ?? existing.gas,
    updatedAt: Date.now(),
  };
  store.set(input.id, next);
  return next;
}

export async function deleteTask(id: string): Promise<{ id: string }> {
  await delay();
  maybeFail("deleteTask");
  if (!store.has(id)) {
    const err = new Error(`Task ${id} not found`);
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
  store.delete(id);
  return { id };
}

// Test-only helpers.
export function __setMockApi(opts: Partial<MockApiOptions>): void {
  options = { ...options, ...opts };
}

export function __resetMockApi(): void {
  store = seed();
  options = { ...DEFAULT_OPTIONS };
}

export function __getMockApiOptions(): MockApiOptions {
  return { ...options };
}
