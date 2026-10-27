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
  ZkCircuitId,
} from "./types";

// In-browser WASM proving (Issue #1250)
export {
  BrowserZkProver,
  combineCircuitInputs,
  getCircuitArtifacts,
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
