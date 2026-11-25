export interface ZkTask {
  id: number;
  contractAddress: string;
  functionName: string;
  interval: number;
  gasBalance: number;
  status: "active" | "paused";
}

export interface ZkProofPayload {
  proofId: string;
  status: "success" | "failed";
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  publicSignals: string[];
  proof?: Record<string, unknown>;
  durationMs?: number;
}

export type ZkCircuitId = "range" | "membership";

export interface ZkProofGenerationOptions {
  taskCondition: string;
  secretData: string;
  verifierAddress: string;
  simulateCongestion: boolean;
  simulateFailure: boolean;
  circuitId?: ZkCircuitId;
}

export type ZkProofPhase = "generation" | "verification" | "network";

export interface DiagnosticError {
  id: string;
  msg: string;
  time: string;
  phase: ZkProofPhase;
  remediation: string;
}

export type PipelineStage =
  | "idle"
  | "initializing"
  | "allocating_worker"
  | "ingesting_data"
  | "building_constraints"
  | "computing_witness"
  | "computing_coefficients"
  | "synthesizing_signals"
  | "locally_verifying"
  | "proof_complete"
  | "preparing_credentials"
  | "computing_hash"
  | "simulating_ledger"
  | "broadcasting"
  | "verifying_onchain"
  | "verified"
  | "failed";

export interface PipelineLogEntry {
  stage: PipelineStage;
  message: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ZkProofPipelineState {
  status: "idle" | "generating" | "verifying" | "success" | "failed";
  proof: ZkProofPayload | null;
  logs: PipelineLogEntry[];
  errors: DiagnosticError[];
  currentStage: PipelineStage;
  progress: number;
}

export interface ZkEngineConfig {
  workerCount: number;
  maxRetries: number;
  baseDelayMs: number;
  congestionMultiplier: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => void;
}

export interface ZkVerificationResult {
  success: boolean;
  conditionHash: string;
  transactionHash?: string;
  error?: DiagnosticError;
}
