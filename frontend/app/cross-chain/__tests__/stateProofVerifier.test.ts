import { MOCK_BRIDGE_EVENTS, MOCK_TASKS } from "../useCrossChainTasks";
import { verifyStateProof } from "../stateProofVerifier";

const now = new Date("2026-06-29T12:00:00.000Z");

const settledEvent = {
  id: "be-settled",
  taskId: "cct-1",
  fromNetwork: "soroban" as const,
  toNetwork: "ethereum" as const,
  eventType: "settled" as const,
  timestamp: "2026-06-29T11:55:00.000Z",
};

const validProof = {
  proofId: "proof-1",
  taskId: "cct-1",
  sourceNetwork: "soroban",
  targetNetwork: "ethereum",
  sourceTxHash: "0xabc1",
  stateRoot: "0x987654",
  bridgeEventId: "be-settled",
  observedAt: "2026-06-29T11:55:30.000Z",
  signer: "GVERIFIER123",
  secret: "do-not-log",
};

describe("verifyStateProof", () => {
  it("accepts a proof that matches a known task and settled bridge event", () => {
    const result = verifyStateProof({
      rawProof: JSON.stringify(validProof),
      tasks: MOCK_TASKS,
      bridgeEvents: [...MOCK_BRIDGE_EVENTS, settledEvent],
      now,
    });

    expect(result.status).toBe("verified");
    expect(result.code).toBe("verified");
    expect(result.audit.taskId).toBe("cct-1");
    expect(result.audit.redactedProof).toMatchObject({
      proofId: "proof-1",
      taskId: "cct-1",
      secret: "[redacted]",
    });
  });

  it("rejects malformed proof JSON without throwing", () => {
    const result = verifyStateProof({
      rawProof: "{not-json",
      tasks: MOCK_TASKS,
      bridgeEvents: MOCK_BRIDGE_EVENTS,
      now,
    });

    expect(result).toMatchObject({
      status: "blocked",
      code: "invalid_json",
      retriable: true,
    });
  });

  it("blocks a proof whose task does not match the selected task", () => {
    const result = verifyStateProof({
      rawProof: JSON.stringify({ ...validProof, taskId: "cct-2" }),
      selectedTaskId: "cct-1",
      tasks: MOCK_TASKS,
      bridgeEvents: [...MOCK_BRIDGE_EVENTS, settledEvent],
      now,
    });

    expect(result).toMatchObject({
      status: "blocked",
      code: "task_mismatch",
      retriable: false,
    });
  });

  it("blocks proofs for networks not configured on the task", () => {
    const result = verifyStateProof({
      rawProof: JSON.stringify({ ...validProof, targetNetwork: "base" }),
      tasks: MOCK_TASKS,
      bridgeEvents: [...MOCK_BRIDGE_EVENTS, settledEvent],
      now,
    });

    expect(result).toMatchObject({
      status: "blocked",
      code: "network_mismatch",
      retriable: false,
    });
  });

  it("marks stale proofs as fallback results", () => {
    const result = verifyStateProof({
      rawProof: JSON.stringify({ ...validProof, observedAt: "2026-06-29T09:30:00.000Z" }),
      tasks: MOCK_TASKS,
      bridgeEvents: [...MOCK_BRIDGE_EVENTS, settledEvent],
      now,
      maxProofAgeMs: 30 * 60 * 1000,
    });

    expect(result).toMatchObject({
      status: "fallback",
      code: "stale_proof",
      retriable: true,
    });
  });
});
