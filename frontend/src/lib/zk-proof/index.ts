export { ProverEngine } from "./prover-engine";
export { WorkerPool } from "./worker-pool";
export { VerifierClient } from "./verifier-client";
export { ErrorTracker } from "./error-tracker";
export { ZkProofPipeline } from "./pipeline";

export type {
  ZkTask,
  ZkProofPayload,
  ZkProofGenerationOptions,
  ZkProofPhase,
  DiagnosticError,
  PipelineStage,
  PipelineLogEntry,
  ZkProofPipelineState,
  ZkEngineConfig,
  ZkVerificationResult,
} from "./types";

// In-browser WASM proving and Soroban serialisation (Issue #1250)
export {
  BASE_PROVING_MEMORY_MB,
  checkMemoryBudget,
  DEFAULT_PROVE_TIMEOUT_MS,
  estimateProvingMemoryMb,
  MB_PER_MILLION_CONSTRAINTS,
  ProverMemoryError,
  ProverUnavailableError,
  proveInBrowser,
  type BrowserProveOptions,
  type BrowserProveResult,
  type MemoryBudget,
} from "./browser-prover";

export {
  encodeG1,
  encodeG2,
  encodeProofForSoroban,
  FIELD_ELEMENT_BYTES,
  fieldElementToBytes,
  ProofEncodingError,
  toHex,
  type SorobanProofBytes,
} from "./soroban-encoding";
