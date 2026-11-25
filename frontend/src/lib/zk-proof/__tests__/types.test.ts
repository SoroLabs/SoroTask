import type {
  ZkTask,
  ZkProofPayload,
  DiagnosticError,
  PipelineLogEntry,
  ZkProofPipelineState,
} from "../types";

describe("ZKP Types", () => {
  it("ZkTask shape is valid", () => {
    const task: ZkTask = {
      id: 1,
      contractAddress: "CAFE1234",
      functionName: "harvest_yield",
      interval: 3600,
      gasBalance: 10,
      status: "active",
    };
    expect(task.id).toBe(1);
    expect(task.status).toBe("active");
  });

  it("ZkTask supports paused status", () => {
    const task: ZkTask = {
      id: 2,
      contractAddress: "BEEF5678",
      functionName: "claim_yield",
      interval: 600,
      gasBalance: 5,
      status: "paused",
    };
    expect(task.status).toBe("paused");
  });

  it("ZkProofPayload shape is valid", () => {
    const proof: ZkProofPayload = {
      proofId: "zk-abc123",
      status: "success",
      pi_a: ["0x1", "0x2"],
      pi_b: [["0x3", "0x4"], ["0x5", "0x6"]],
      pi_c: ["0x7", "0x8"],
      publicSignals: ["0x9"],
    };
    expect(proof.proofId).toBe("zk-abc123");
    expect(proof.pi_a).toHaveLength(2);
    expect(proof.pi_b).toHaveLength(2);
    expect(proof.pi_c).toHaveLength(2);
    expect(proof.publicSignals).toHaveLength(1);
  });

  it("ZkProofPayload supports failed status", () => {
    const proof: ZkProofPayload = {
      proofId: "zk-fail-1",
      status: "failed",
      pi_a: [],
      pi_b: [],
      pi_c: [],
      publicSignals: [],
    };
    expect(proof.status).toBe("failed");
  });

  it("DiagnosticError shape is valid", () => {
    const err: DiagnosticError = {
      id: "err-0001",
      msg: "Test error",
      time: "2024-01-01T00:00:00.000Z",
      phase: "generation",
      remediation: "Fix inputs",
    };
    expect(err.phase).toBe("generation");
    expect(err.remediation).toBe("Fix inputs");
  });

  it("DiagnosticError supports all phases", () => {
    const phases: Array<DiagnosticError["phase"]> = [
      "generation",
      "verification",
      "network",
    ];
    for (const phase of phases) {
      const err: DiagnosticError = {
        id: `err-${phase}`,
        msg: `${phase} error`,
        time: "2024-01-01T00:00:00.000Z",
        phase,
        remediation: "Fix it",
      };
      expect(err.phase).toBe(phase);
    }
  });

  it("PipelineLogEntry shape is valid", () => {
    const entry: PipelineLogEntry = {
      stage: "initializing",
      message: "Starting pipeline",
      timestamp: 1700000000000,
    };
    expect(entry.stage).toBe("initializing");
    expect(entry.metadata).toBeUndefined();
  });

  it("PipelineLogEntry supports metadata", () => {
    const entry: PipelineLogEntry = {
      stage: "proof_complete",
      message: "Done",
      timestamp: 1700000000000,
      metadata: { proofId: "zk-1" },
    };
    expect(entry.metadata?.proofId).toBe("zk-1");
  });

  it("ZkProofPipelineState shape is valid", () => {
    const state: ZkProofPipelineState = {
      status: "success",
      proof: null,
      logs: [],
      errors: [],
      currentStage: "verified",
      progress: 100,
    };
    expect(state.status).toBe("success");
    expect(state.progress).toBe(100);
  });

  it("ZkProofPipelineState supports all statuses", () => {
    const statuses: ZkProofPipelineState["status"][] = [
      "idle",
      "generating",
      "verifying",
      "success",
      "failed",
    ];
    for (const status of statuses) {
      const state: ZkProofPipelineState = {
        status,
        proof: null,
        logs: [],
        errors: [],
        currentStage: "idle",
        progress: 0,
      };
      expect(state.status).toBe(status);
    }
  });
});
