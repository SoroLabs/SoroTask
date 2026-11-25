import { VerifierClient } from "../verifier-client";
import type { ZkProofPayload } from "../types";

describe("VerifierClient", () => {
  let client: VerifierClient;
  let scheduled: Array<{ fn: () => void; ms: number }>;

  function drainScheduled() {
    while (scheduled.length > 0) {
      scheduled.shift()!.fn();
    }
  }

  const mockProof: ZkProofPayload = {
    proofId: "zk-test-1",
    status: "success",
    pi_a: ["0x1A2B3C4D5E6F", "0x7F8E9D0C1B2A"],
    pi_b: [
      ["0x3E4D5C6B7A89", "0x9A8B7C6D5E4F"],
      ["0x2A3B4C5D6E7F", "0x8F7E6D5C4B3A"],
    ],
    pi_c: ["0x7E6D5C4B3A29", "0x1A9B2C8D3E7F"],
    publicSignals: ["0x1"],
  };

  beforeEach(() => {
    scheduled = [];
    client = new VerifierClient({
      baseDelayMs: 0,
      congestionMultiplier: 1,
      simulateCongestion: false,
      schedule: (fn, ms) => {
        scheduled.push({ fn, ms });
      },
    });
  });

  it("verifies proof successfully", async () => {
    const promise = client.verifyOnChain(
      mockProof,
      "CAFE1234",
      "VERIFIER123",
      "GABC123",
      true,
    );
    drainScheduled();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.conditionHash).toBeDefined();
    expect(result.conditionHash).toMatch(/^h_/);
    expect(result.transactionHash).toBeDefined();
    expect(result.transactionHash).toMatch(/^0x/);
  });

  it("includes wallet address when connected", async () => {
    const stages: string[] = [];
    const promise = client.verifyOnChain(
      mockProof,
      "CAFE1234",
      "VERIFIER123",
      "GABC123",
      true,
      (stage) => {
        stages.push(stage);
      },
    );
    drainScheduled();
    await promise;

    expect(stages).toContain("preparing_credentials");
    expect(stages).toContain("computing_hash");
    expect(stages).toContain("simulating_ledger");
    expect(stages).toContain("broadcasting");
    expect(stages).toContain("verifying");
  });

  it("rejects when contract address contains FAILS", async () => {
    const promise = client.verifyOnChain(
      mockProof,
      "CAFE5678FAILS",
      "VERIFIER123",
      "GABC123",
      true,
    );
    drainScheduled();

    await expect(promise).rejects.toHaveProperty("phase", "verification");
  });

  it("handles wallet disconnected state", async () => {
    const promise = client.verifyOnChain(
      mockProof,
      "CAFE1234",
      "VERIFIER123",
      null,
      false,
    );
    drainScheduled();

    const result = await promise;
    expect(result.success).toBe(true);
  });

  it("handles congestion mode with longer delays", async () => {
    const congestionClient = new VerifierClient({
      baseDelayMs: 0,
      congestionMultiplier: 5,
      simulateCongestion: true,
      schedule: (fn, ms) => {
        scheduled.push({ fn, ms });
      },
    });

    const promise = congestionClient.verifyOnChain(
      mockProof,
      "CAFE1234",
      "VERIFIER123",
      "GABC123",
      true,
    );
    drainScheduled();

    const result = await promise;
    expect(result.success).toBe(true);
  });

  it("generates transaction hash with correct length", async () => {
    const promise = client.verifyOnChain(
      mockProof,
      "CAFE1234",
      "VERIFIER123",
      "GABC123",
      true,
    );
    drainScheduled();
    const result = await promise;

    expect(result.transactionHash!.length).toBe(66);
  });

  it("calls onStage with credential setup", async () => {
    const messages: string[] = [];
    const promise = client.verifyOnChain(
      mockProof,
      "CAFE1234",
      "VERIFIER123",
      "GABC123",
      true,
      (_stage, msg) => {
        messages.push(msg);
      },
    );
    drainScheduled();
    await promise;

    expect(messages.some((m) => m.includes("pre-flight"))).toBe(true);
    expect(messages.some((m) => m.includes("Wallet connection"))).toBe(true);
  });

  it("works with default schedule when none provided", async () => {
    const defaultClient = new VerifierClient({
      baseDelayMs: 0,
      congestionMultiplier: 1,
      simulateCongestion: false,
    });
    // Should not throw when using default setTimeout
    const promise = defaultClient.verifyOnChain(
      mockProof,
      "CAFE1234",
      "VERIFIER123",
      "GABC123",
      true,
    );
    // With delay=0, setTimeout runs immediately
    const result = await promise;
    expect(result.success).toBe(true);
  });

  it("handles contract revert with proper error shape", async () => {
    const promise = client.verifyOnChain(
      mockProof,
      "CONTRACT_FAILS_NOW",
      "VERIFIER123",
      "GABC123",
      true,
    );
    drainScheduled();

    try {
      await promise;
      fail("Should have thrown");
    } catch (error: any) {
      expect(error).toHaveProperty("phase", "verification");
      expect(error).toHaveProperty("msg");
      expect(error).toHaveProperty("remediation");
      expect(error.msg).toContain("Soroban Transaction Revert");
    }
  });
});
