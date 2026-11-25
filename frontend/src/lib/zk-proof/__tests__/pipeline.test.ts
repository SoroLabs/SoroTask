import { ZkProofPipeline } from "../pipeline";
import type { DiagnosticError, ZkProofPayload, ZkVerificationResult } from "../types";

describe("ZkProofPipeline", () => {
  let pipeline: ZkProofPipeline;

  beforeEach(() => {
    pipeline = new ZkProofPipeline();
  });

  it("starts in idle state", () => {
    const state = pipeline.getState();
    expect(state.status).toBe("idle");
    expect(state.proof).toBeNull();
    expect(state.logs).toHaveLength(0);
    expect(state.errors).toHaveLength(0);
    expect(state.currentStage).toBe("idle");
    expect(state.progress).toBe(0);
  });

  it("adds log entries", () => {
    pipeline.addLog("initializing", "Starting pipeline");
    pipeline.addLog("allocating_worker", "Worker #1 allocated");

    const state = pipeline.getState();
    expect(state.logs).toHaveLength(2);
    expect(state.logs[0].stage).toBe("initializing");
    expect(state.logs[0].message).toBe("Starting pipeline");
    expect(state.logs[1].stage).toBe("allocating_worker");
  });

  it("updates current stage when adding logs", () => {
    pipeline.addLog("building_constraints", "Building gates");
    expect(pipeline.getState().currentStage).toBe("building_constraints");
  });

  it("updates progress based on stage", () => {
    pipeline.addLog("initializing", "Starting");
    expect(pipeline.getState().progress).toBeGreaterThan(0);

    pipeline.addLog("failed", "Done");
    expect(pipeline.getState().progress).toBe(100);
  });

  it("sets bounded worker progress values", () => {
    pipeline.setProgress(73.4);
    expect(pipeline.getState().progress).toBe(73);

    pipeline.setProgress(120);
    expect(pipeline.getState().progress).toBe(100);

    pipeline.setProgress(-5);
    expect(pipeline.getState().progress).toBe(0);
  });

  it("adds errors", () => {
    const error: DiagnosticError = {
      id: "err-001",
      msg: "Test error",
      time: new Date().toISOString(),
      phase: "generation",
      remediation: "Fix it",
    };
    pipeline.addError(error);

    const state = pipeline.getState();
    expect(state.errors).toHaveLength(1);
    expect(state.errors[0].msg).toBe("Test error");
    expect(state.status).toBe("failed");
  });

  it("sets proof", () => {
    const proof: ZkProofPayload = {
      proofId: "zk-1",
      status: "success",
      pi_a: ["0x1"],
      pi_b: [["0x2"]],
      pi_c: ["0x3"],
      publicSignals: ["0x4"],
    };
    pipeline.setProof(proof);

    expect(pipeline.getState().proof).toEqual(proof);
  });

  it("sets status", () => {
    pipeline.setStatus("generating");
    expect(pipeline.getState().status).toBe("generating");

    pipeline.setStatus("success");
    expect(pipeline.getState().status).toBe("success");
  });

  it("sets verification result - success", () => {
    const result: ZkVerificationResult = {
      success: true,
      conditionHash: "h_abc123",
    };
    pipeline.setVerificationResult(result);

    expect(pipeline.getState().status).toBe("success");
  });

  it("sets verification result - failure", () => {
    const result: ZkVerificationResult = {
      success: false,
      conditionHash: "",
    };
    pipeline.setVerificationResult(result);

    expect(pipeline.getState().status).toBe("failed");
  });

  it("resets to initial state", () => {
    pipeline.addLog("initializing", "Starting");
    pipeline.setStatus("generating");
    expect(pipeline.getState().status).toBe("generating");

    pipeline.reset();

    const state = pipeline.getState();
    expect(state.status).toBe("idle");
    expect(state.proof).toBeNull();
    expect(state.logs).toHaveLength(0);
    expect(state.errors).toHaveLength(0);
    expect(state.currentStage).toBe("idle");
    expect(state.progress).toBe(0);
  });

  it("notifies subscribers on state changes", () => {
    const listener = jest.fn();
    const unsubscribe = pipeline.subscribe(listener);

    pipeline.addLog("initializing", "Starting");
    expect(listener).toHaveBeenCalledTimes(1);

    pipeline.setStatus("generating");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    pipeline.addLog("building_constraints", "Building");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("tracks multiple log entries with correct ordering", () => {
    const stages = [
      "initializing",
      "allocating_worker",
      "ingesting_data",
      "building_constraints",
      "computing_coefficients",
      "proof_complete",
    ] as const;

    for (const stage of stages) {
      pipeline.addLog(stage, `Stage: ${stage}`);
    }

    expect(pipeline.getState().logs).toHaveLength(stages.length);
    expect(pipeline.getState().progress).toBeGreaterThan(0);
  });

  it("handles failed stage in progress calculation", () => {
    pipeline.addLog("failed", "Something failed");
    expect(pipeline.getState().progress).toBe(100);
  });

  it("preserves error prevention - adds error when already failed", () => {
    pipeline.setStatus("success");
    const error: DiagnosticError = {
      id: "err-002",
      msg: "Late error",
      time: new Date().toISOString(),
      phase: "verification",
      remediation: "Check it",
    };
    pipeline.addError(error);

    const state = pipeline.getState();
    expect(state.errors).toHaveLength(1);
    expect(state.status).toBe("failed");
  });

  it("handles unknown stage gracefully", () => {
    pipeline.addLog("idle", "Reset");
    expect(pipeline.getState().progress).toBe(0);
  });
});
