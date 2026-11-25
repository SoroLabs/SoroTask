import { WorkerPool } from "./worker-pool";
import { VerifierClient } from "./verifier-client";
import { ErrorTracker } from "./error-tracker";
import { ZkProofPipeline } from "./pipeline";
import type {
  ZkTask,
  ZkProofPayload,
  ZkProofGenerationOptions,
  ZkVerificationResult,
  ZkEngineConfig,
} from "./types";

export interface ProverEngineOptions {
  config: ZkEngineConfig;
  onStateChange?: () => void;
}

export class ProverEngine {
  readonly pipeline: ZkProofPipeline;
  readonly errorTracker: ErrorTracker;
  private workerPool: WorkerPool;
  private verifierClient: VerifierClient;
  private config: ZkEngineConfig;
  private tasks: ZkTask[] = [];

  constructor(options: ProverEngineOptions) {
    this.config = options.config;
    this.pipeline = new ZkProofPipeline();
    this.errorTracker = new ErrorTracker({
      maxErrors: 100,
      onError: (error) => {
        this.pipeline.addError(error);
      },
    });
    this.workerPool = new WorkerPool({
      workerCount: this.config.workerCount,
      baseDelayMs: this.config.baseDelayMs,
      maxRetries: this.config.maxRetries,
      congestionMultiplier: this.config.congestionMultiplier,
      now: this.config.now,
      schedule: this.config.schedule,
    });
    this.verifierClient = new VerifierClient({
      baseDelayMs: this.config.baseDelayMs,
      congestionMultiplier: this.config.congestionMultiplier,
      simulateCongestion: false,
      now: this.config.now,
      schedule: this.config.schedule,
    });

    if (options.onStateChange) {
      this.pipeline.subscribe(options.onStateChange);
    }
  }

  setTasks(tasks: ZkTask[]): void {
    this.tasks = tasks;
  }

  getTasks(): ZkTask[] {
    return this.tasks;
  }

  async generateProof(options: ZkProofGenerationOptions): Promise<ZkProofPayload> {
    this.pipeline.reset();
    this.pipeline.setStatus("generating");
    this.pipeline.addLog("initializing", "Initializing off-chain proof generation pipeline...");

    try {
      const proof = await this.workerPool.execute(
        options.taskCondition,
        options.secretData,
        options.simulateFailure,
        options.simulateCongestion,
        (stage, message) => {
          this.pipeline.addLog(stage as any, message);
        },
      );

      this.pipeline.setProof(proof);
      this.pipeline.addLog("proof_complete", "ZK Proof computed successfully. Off-chain pipeline secure.");
      this.pipeline.setStatus("idle");
      return proof;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pipeline.addLog("failed", `Computational failure detected inside proof computation!`);
      this.errorTracker.track(message, "generation", this.getRemediation(message));
      this.pipeline.setStatus("failed");
      throw error;
    }
  }

  async verifyProof(
    proof: ZkProofPayload,
    contractAddress: string,
    verifierAddress: string,
    walletAddress: string | null,
    walletConnected: boolean,
  ): Promise<ZkVerificationResult> {
    this.pipeline.setStatus("verifying");
    this.pipeline.addLog("initializing", "Preparing on-chain verification pipeline...");

    try {
      const result = await this.verifierClient.verifyOnChain(
        proof,
        contractAddress,
        verifierAddress,
        walletAddress,
        walletConnected,
        (stage, message) => {
          this.pipeline.addLog(stage as any, message);
        },
      );

      this.pipeline.setVerificationResult(result);
      this.pipeline.addLog("verified", "Zero-Knowledge verification finalized. Task secured.");
      return result;
    } catch (error) {
      if (this.isDiagnosticError(error)) {
        this.pipeline.addError(error);
        this.pipeline.addLog("failed", "On-chain verifier rejected the proof validity!");
      } else {
        const message = error instanceof Error ? error.message : String(error);
        this.errorTracker.track(
          message,
          "network",
          "Check network connectivity and RPC endpoint availability.",
        );
        this.pipeline.addLog("failed", "On-chain verification failed due to a network error.");
      }
      this.pipeline.setStatus("failed");
      throw error;
    }
  }

  getWorkerPoolStats(): { idle: number; busy: number; total: number; queued: number } {
    return {
      idle: this.workerPool.getIdleWorkerCount(),
      busy: this.workerPool.getBusyWorkerCount(),
      total: this.workerPool.getTotalWorkerCount(),
      queued: 0,
    };
  }

  shutdown(): void {
    this.workerPool.shutdown();
    this.pipeline.reset();
    this.errorTracker.clear();
  }

  private getRemediation(message: string): string {
    if (message.includes("Constraint validation mismatch")) {
      return "Ensure client inputs satisfy task condition threshold rules (e.g. actualLiquidity > minLiquidity).";
    }
    return "Check proof generation parameters and retry with valid inputs.";
  }

  private isDiagnosticError(error: unknown): error is import("./types").DiagnosticError {
    return (
      typeof error === "object" &&
      error !== null &&
      "id" in error &&
      "phase" in error &&
      "remediation" in error
    );
  }
}
