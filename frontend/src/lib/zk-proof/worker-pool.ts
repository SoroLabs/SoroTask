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

interface WorkerTask {
  resolve: (proof: ZkProofPayload) => void;
  reject: (error: Error) => void;
  payload: {
    taskCondition: string;
    secretData: string;
  };
  retries: number;
}

export class WorkerPool {
  private workers: PoolWorker[] = [];
  private queue: WorkerTask[] = [];
  private config: WorkerPoolConfig;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => void;

  constructor(config: WorkerPoolConfig) {
    this.config = config;
    this.now = config.now ?? (() => Date.now());
    this.schedule =
      config.schedule ??
      ((fn, ms) => {
        if (typeof window !== "undefined") window.setTimeout(fn, ms);
        else setTimeout(fn, ms);
      });
    this.initialize();
  }

  initialize(): void {
    this.workers = [];
    for (let i = 0; i < this.config.workerCount; i++) {
      this.workers.push({ id: i, status: "idle", taskId: null });
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

  async execute(
    taskCondition: string,
    secretData: string,
    simulateFailure: boolean,
    simulateCongestion: boolean,
    onStage?: (stage: string, message: string) => void,
  ): Promise<ZkProofPayload> {
    const worker = this.getAvailableWorker();
    if (!worker) {
      return new Promise((resolve, reject) => {
        this.queue.push({
          resolve,
          reject,
          payload: { taskCondition, secretData },
          retries: 0,
        });
      });
    }

    worker.status = "busy";
    worker.taskId = `task-${this.now()}`;

    try {
      const result = await this.runProofComputation(
        worker,
        taskCondition,
        secretData,
        simulateFailure,
        simulateCongestion,
        onStage,
      );
      worker.status = "idle";
      worker.taskId = null;
      this.processQueue();
      return result;
    } catch (error) {
      worker.status = "idle";
      worker.taskId = null;
      this.processQueue();
      throw error;
    }
  }

  private async runProofComputation(
    worker: PoolWorker,
    taskCondition: string,
    secretData: string,
    simulateFailure: boolean,
    simulateCongestion: boolean,
    onStage?: (stage: string, message: string) => void,
  ): Promise<ZkProofPayload> {
    const delay = simulateCongestion
      ? this.config.baseDelayMs * this.config.congestionMultiplier
      : this.config.baseDelayMs;

    return new Promise((resolve, reject) => {
      let cancelled = false;

      const stage1 = () => {
        if (cancelled) return;
        onStage?.("ingesting_data", "Ingesting private task conditions and secret client credentials...");
        this.schedule(stage2, delay / 3);
      };

      const stage2 = () => {
        if (cancelled) return;
        onStage?.("building_constraints", "Building R1CS arithmetic constraint gates...");
        if (simulateFailure) {
          cancelled = true;
          reject(new Error("Constraint validation mismatch: Coefficient multiplier check failed at wire #12"));
          return;
        }
        this.schedule(stage3, delay / 3);
      };

      const stage3 = () => {
        if (cancelled) return;
        onStage?.("computing_coefficients", "Computing cryptographical coefficients (pi_a, pi_b, pi_c)...");
        onStage?.("synthesizing_signals", "Synthesizing public signal mapping...");
        const proof: ZkProofPayload = {
          proofId: this.generateProofId(),
          status: "success",
          pi_a: ["0x1A2B3C4D5E6F", "0x7F8E9D0C1B2A"],
          pi_b: [
            ["0x3E4D5C6B7A89", "0x9A8B7C6D5E4F"],
            ["0x2A3B4C5D6E7F", "0x8F7E6D5C4B3A"],
          ],
          pi_c: ["0x7E6D5C4B3A29", "0x1A9B2C8D3E7F"],
          publicSignals: ["0x1"],
        };
        resolve(proof);
      };

      onStage?.("allocating_worker", `Allocating idle computing worker #${worker.id} from pool [ZKProofService]`);
      this.schedule(stage1, delay / 3);
    });
  }

  private processQueue(): void {
    const available = this.getAvailableWorker();
    if (!available || this.queue.length === 0) return;

    const task = this.queue.shift()!;
    this.execute(
      task.payload.taskCondition,
      task.payload.secretData,
      false,
      false,
    )
      .then((proof) => task.resolve(proof))
      .catch((error) => {
        if (task.retries < this.config.maxRetries) {
          task.retries++;
          this.queue.unshift(task);
          this.schedule(() => this.processQueue(), this.config.baseDelayMs * Math.pow(2, task.retries));
        } else {
          task.reject(error);
        }
      });
  }

  private generateProofId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `zk-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`;
  }

  shutdown(): void {
    this.workers = [];
    this.queue = [];
  }
}
