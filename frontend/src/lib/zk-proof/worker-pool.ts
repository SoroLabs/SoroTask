import type { ZkProofPayload } from "./types";

export interface PoolWorker {
  id: number;
  status: "idle" | "busy";
  taskId: string | null;
}

export interface WorkerPoolConfig {
  workerCount: number;
  baseDelayMs: number;
  maxRetries: number;
  congestionMultiplier: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => void;
}

export interface WorkerTaskPayload {
  taskCondition: string;
  secretData: string;
}

export interface WorkerResult {
  proof: ZkProofPayload;
  verified?: boolean;
}

export type ProofProgressHandler = (stage: string, message: string) => void;

export interface ProverWorkerLike {
  postMessage: (message: unknown) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  addEventListener?: (type: string, listener: (event: any) => void) => void;
  removeEventListener?: (type: string, listener: (event: any) => void) => void;
}

export type WorkerFactory = () => ProverWorkerLike;

interface WorkerTask {
  resolve: (proof: ZkProofPayload) => void;
  reject: (error: Error) => void;
  payload: WorkerTaskPayload;
  retries: number;
  onStage?: ProofProgressHandler;
}

interface WorkerSlot {
  id: number;
  instance: ProverWorkerLike | null;
  current: {
    task: WorkerTask;
    taskId: string;
    settled: boolean;
  } | null;
  cleanup?: () => void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class WorkerPool {
  private workers: PoolWorker[] = [];
  private slots: WorkerSlot[] = [];
  private queue: WorkerTask[] = [];
  private config: WorkerPoolConfig;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => void;
  private readonly workerFactory: WorkerFactory | null;
  private readonly timeoutMs: number;
  private taskCounter = 0;
  private shutdownFlag = false;

  constructor(config: WorkerPoolConfig, factory?: WorkerFactory, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.config = config;
    this.now = config.now ?? (() => Date.now());
    this.schedule =
      config.schedule ??
      ((fn, ms) => {
        if (typeof window !== "undefined") window.setTimeout(fn, ms);
        else setTimeout(fn, ms);
      });
    this.workerFactory = factory ?? null;
    this.timeoutMs = timeoutMs;
    this.initialize();
  }

  initialize(): void {
    this.workers = [];
    this.slots = [];
    for (let i = 0; i < this.config.workerCount; i++) {
      this.workers.push({ id: i, status: "idle", taskId: null });
      this.slots.push({ id: i, instance: null, current: null });
    }
  }

  getAvailableWorker(): PoolWorker | null {
    return this.workers.find((w) => w.status === "idle") ?? null;
  }

  getIdleWorkerCount(): number {
    return this.workers.filter((w) => w.status === "idle").length;
  }

  getBusyWorkerCount(): number {
    return this.workers.filter((w) => w.status === "busy").length;
  }

  getTotalWorkerCount(): number {
    return this.workers.length;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  async execute(
    taskCondition: string,
    secretData: string,
    simulateFailure: boolean,
    simulateCongestion: boolean,
    onStage?: ProofProgressHandler,
  ): Promise<ZkProofPayload> {
    if (this.shutdownFlag) {
      throw new Error("WorkerPool has been shut down");
    }

    const worker = this.getAvailableWorker();
    if (!worker) {
      return new Promise<ZkProofPayload>((resolve, reject) => {
        this.queue.push({
          resolve,
          reject,
          payload: { taskCondition, secretData },
          retries: 0,
          onStage,
        });
      });
    }

    return this.dispatch(worker, {
      resolve: () => undefined,
      reject: () => undefined,
      payload: { taskCondition, secretData },
      retries: 0,
      onStage,
    });
  }

  private dispatch(worker: PoolWorker, task: WorkerTask): Promise<ZkProofPayload> {
    const taskId = `task-${this.taskCounter++}-${this.now()}`;
    worker.status = "busy";
    worker.taskId = taskId;

    const slot = this.slots.find((s) => s.id === worker.id);
    if (!slot) {
      worker.status = "idle";
      worker.taskId = null;
      return Promise.reject(new Error(`Internal error: worker slot ${worker.id} not found`));
    }

    return new Promise<ZkProofPayload>((resolve, reject) => {
      const settledRef = { value: false };
      slot.current = { task, taskId, settled: false };

      const cleanup = () => {
        this.clearTimeoutHandle(timeoutHandle);
        const instance = slot.instance;
        if (instance) {
          instance.onmessage = null;
          instance.onerror = null;
        }
        slot.cleanup = undefined;
      };

      const finalize = () => {
        if (settledRef.value) return;
        settledRef.value = true;
        cleanup();
        slot.current = null;
        worker.status = "idle";
        worker.taskId = null;
        this.processQueue();
      };

      const safeResolve = (proof: ZkProofPayload) => {
        finalize();
        resolve(proof);
      };
      const safeReject = (error: Error) => {
        finalize();
        reject(error);
      };

      const boundMessage = (event: MessageEvent) => {
        const data = event.data as {
          type?: string;
          taskId?: string;
          stage?: string;
          message?: string;
          proof?: ZkProofPayload;
          error?: string;
        };
        if (data.taskId && data.taskId !== taskId) return;
        if (data.type === "progress") {
          task.onStage?.(data.stage ?? "working", data.message ?? "");
          return;
        }
        if (data.type === "result" && data.proof) {
          safeResolve(data.proof);
          return;
        }
        if (data.type === "error") {
          safeReject(new Error(data.error ?? "Unknown prover worker error"));
        }
      };

      const boundError = (event: ErrorEvent) => {
        safeReject(new Error(event.message || "Prover worker crashed"));
      };

      const timeoutHandle = this.scheduleTimeout(() => {
        safeReject(new Error(`Proof generation timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      slot.cleanup = cleanup;

      try {
        const instance = this.getOrCreateWorker(slot);
        instance.onmessage = boundMessage;
        instance.onerror = boundError;
        instance.postMessage({
          type: "prove",
          taskId,
          taskCondition: task.payload.taskCondition,
          secretData: task.payload.secretData,
          simulateFailure: false,
          simulateCongestion: false,
        });
      } catch (err) {
        safeReject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private getOrCreateWorker(slot: WorkerSlot): ProverWorkerLike {
    if (slot.instance) return slot.instance;
    if (!this.workerFactory) {
      throw new Error(
        "WorkerPool requires a workerFactory to generate proofs. Pass a factory that returns a Worker running zkProverWorker.ts.",
      );
    }
    const instance = this.workerFactory();
    slot.instance = instance;
    return instance;
  }

  private scheduleTimeout(fn: () => void, ms: number): unknown {
    if (typeof window !== "undefined") return window.setTimeout(fn, ms);
    return setTimeout(fn, ms);
  }

  private clearTimeoutHandle(handle: unknown): void {
    if (typeof window !== "undefined") window.clearTimeout(handle as number);
    else clearTimeout(handle as any);
  }

  private processQueue(): void {
    if (this.shutdownFlag) return;
    const available = this.getAvailableWorker();
    if (!available || this.queue.length === 0) return;

    const task = this.queue.shift()!;
    this.dispatch(available, task)
      .then((proof) => task.resolve(proof))
      .catch((error) => {
        if (task.retries < this.config.maxRetries) {
          task.retries++;
          this.queue.unshift(task);
          this.schedule(
            () => this.processQueue(),
            this.config.baseDelayMs * Math.pow(2, task.retries),
          );
        } else {
          task.reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
  }

  shutdown(): void {
    this.shutdownFlag = true;
    for (const slot of this.slots) {
      slot.cleanup?.();
      if (slot.instance) {
        try {
          slot.instance.terminate();
        } catch {
          /* ignore termination errors */
        }
        slot.instance = null;
      }
      slot.current = null;
    }
    for (const task of this.queue) {
      task.reject(new Error("WorkerPool shut down before task could run"));
    }
    this.workers = [];
    this.slots = [];
    this.queue = [];
  }
}
