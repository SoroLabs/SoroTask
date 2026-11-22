import type {
  ZkProofPayload,
  ZkProofPipelineState,
  PipelineStage,
  DiagnosticError,
  ZkVerificationResult,
} from "./types";

export class ZkProofPipeline {
  private state: ZkProofPipelineState;
  private listeners: Set<() => void>;

  constructor() {
    this.state = this.initialState();
    this.listeners = new Set();
  }

  private initialState(): ZkProofPipelineState {
    return {
      status: "idle",
      proof: null,
      logs: [],
      errors: [],
      currentStage: "idle",
      progress: 0,
    };
  }

  getState(): ZkProofPipelineState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  addLog(stage: PipelineStage, message: string, metadata?: Record<string, unknown>): void {
    this.state.logs = [
      ...this.state.logs,
      {
        stage,
        message,
        timestamp: Date.now(),
        metadata,
      },
    ];
    this.state.currentStage = stage;
    this.updateProgress(stage);
    this.notify();
  }

  addError(error: DiagnosticError): void {
    this.state.errors = [error, ...this.state.errors];
    this.state.status = "failed";
    this.notify();
  }

  setProof(proof: ZkProofPayload): void {
    this.state.proof = proof;
    this.notify();
  }

  setStatus(
    status: "idle" | "generating" | "verifying" | "success" | "failed",
  ): void {
    this.state.status = status;
    this.notify();
  }

  setProgress(progress: number): void {
    this.state.progress = Math.max(0, Math.min(Math.round(progress), 100));
    this.notify();
  }

  setVerificationResult(result: ZkVerificationResult): void {
    this.state.status = result.success ? "success" : "failed";
    this.notify();
  }

  reset(): void {
    this.state = this.initialState();
    this.notify();
  }

  private updateProgress(stage: PipelineStage): void {
    const stageOrder: PipelineStage[] = [
      "idle",
      "initializing",
      "allocating_worker",
      "ingesting_data",
      "building_constraints",
      "computing_witness",
      "computing_coefficients",
      "synthesizing_signals",
      "locally_verifying",
      "proof_complete",
      "preparing_credentials",
      "computing_hash",
      "simulating_ledger",
      "broadcasting",
      "verifying_onchain",
      "verified",
      "failed",
    ];

    const index = stageOrder.indexOf(stage);
    if (index >= 0) {
      this.state.progress = Math.min(
        Math.round((index / (stageOrder.length - 1)) * 100),
        100,
      );
    }
  }
}
