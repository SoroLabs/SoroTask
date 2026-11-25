import {
  AnalyticsSandboxErrorTracker,
  SandboxInput,
  runAnalyticsSimulation,
  sanitizeSandboxInput,
  validateSandboxInput,
} from "../simulation";

const validInput: SandboxInput = {
  taskId: "task-42",
  targetContract: "c4f6b8d2a9e1",
  functionName: "execute_task",
  argsJson: "[\"task-42\"]",
  gasBalanceXlm: 2,
  intervalSeconds: 900,
  forkLedger: 10_000,
  forkRpcUrl: "https://rpc-testnet.stellar.org",
  keeperCount: 5,
  failureRatePercent: 3,
};

describe("analytics sandbox simulation", () => {
  it("sanitizes input and normalizes JSON arguments", () => {
    const sanitized = sanitizeSandboxInput(validInput);

    expect(sanitized.targetContract).toBe("C4F6B8D2A9E1");
    expect(sanitized.args).toEqual(["task-42"]);
    expect(sanitized.argsJson).toBe("[\"task-42\"]");
  });

  it("validates unsafe RPC endpoints and malformed task input", () => {
    const sanitized = sanitizeSandboxInput({
      ...validInput,
      taskId: "",
      targetContract: "bad",
      functionName: "1bad",
      intervalSeconds: 10,
      forkLedger: 0,
      forkRpcUrl: "http://example.com",
      keeperCount: 0,
    });

    expect(validateSandboxInput(sanitized)).toEqual(
      expect.arrayContaining([
        "Task id is required.",
        "Target contract must be an uppercase contract id between 8 and 64 characters.",
        "Function name must start with a letter or underscore and stay under 64 characters.",
        "Interval must be at least 60 seconds.",
        "Fork ledger must be a positive number.",
        "Fork RPC URL must use HTTPS, except localhost test endpoints.",
        "Keeper count must be between 1 and 100.",
      ]),
    );
  });

  it("allows empty argument input and localhost fork endpoints", () => {
    const sanitized = sanitizeSandboxInput({
      ...validInput,
      argsJson: " ",
      forkRpcUrl: "http://localhost:8000/soroban",
    });

    expect(sanitized.args).toEqual([]);
    expect(validateSandboxInput(sanitized)).toEqual([]);
  });

  it("returns a deterministic local projection", async () => {
    const result = await runAnalyticsSimulation({
      input: validInput,
      now: () => new Date("2026-06-02T10:00:00.000Z"),
    });

    expect(result.status).toBe("success");
    expect(result.mode).toBe("local-fallback");
    expect(result.projectedAt).toBe("2026-06-02T10:00:00.000Z");
    expect(result.costs.totalXlm).toBeGreaterThan(0);
    expect(result.stateChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "tasks.task-42.gas_balance_xlm" }),
      ]),
    );
  });

  it("blocks invalid input and tracks critical errors", async () => {
    const tracker = new AnalyticsSandboxErrorTracker();
    const result = await runAnalyticsSimulation({
      input: { ...validInput, gasBalanceXlm: 0 },
      tracker,
    });

    expect(result.status).toBe("blocked");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      severity: "critical",
      message: "Gas balance must be greater than 0 XLM.",
    });
  });

  it("uses remote results when the transport succeeds", async () => {
    const result = await runAnalyticsSimulation({
      input: validInput,
      transport: {
        simulate: jest.fn().mockResolvedValue({
          confidence: 99,
          costs: {
            networkFeeXlm: 0.1,
            rentFeeXlm: 0.2,
            keeperFeeXlm: 0.3,
            totalXlm: 0.6,
          },
          warnings: [],
        }),
      },
    });

    expect(result.mode).toBe("remote");
    expect(result.confidence).toBe(99);
    expect(result.costs.totalXlm).toBe(0.6);
  });

  it("derives warning status from remote warnings", async () => {
    const result = await runAnalyticsSimulation({
      input: validInput,
      transport: {
        simulate: jest.fn().mockResolvedValue({
          warnings: ["Remote fork detected a rent bump."],
        }),
      },
    });

    expect(result.mode).toBe("remote");
    expect(result.status).toBe("warning");
    expect(result.confidence).toBe(96);
  });

  it("falls back and records warning errors when remote transport fails", async () => {
    const result = await runAnalyticsSimulation({
      input: validInput,
      transport: {
        simulate: jest.fn().mockRejectedValue(new Error("fork unavailable")),
      },
    });

    expect(result.mode).toBe("local-fallback");
    expect(result.status).toBe("warning");
    expect(result.warnings).toEqual(
      expect.arrayContaining(["Remote fork simulation failed; local fallback projection was used."]),
    );
    expect(result.errors[0]).toMatchObject({ severity: "warning", detail: "fork unavailable" });
  });

  it("projects warning states for risky keeper and gas settings", async () => {
    const result = await runAnalyticsSimulation({
      input: {
        ...validInput,
        gasBalanceXlm: 0.02,
        intervalSeconds: 120,
        keeperCount: 100,
        failureRatePercent: 50,
      },
    });

    expect(result.status).toBe("warning");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "Keeper failure rate is high enough to affect execution reliability.",
        "Projected gas balance leaves fewer than three future executions funded.",
        "Short intervals can amplify fees and rate-limit exposure.",
      ]),
    );
  });

  it("records non-error remote failures without losing fallback output", async () => {
    const result = await runAnalyticsSimulation({
      input: validInput,
      transport: {
        simulate: jest.fn().mockRejectedValue("offline"),
      },
    });

    expect(result.errors[0]).toMatchObject({ detail: "offline" });
    expect(result.stateChanges.length).toBeGreaterThan(0);
  });
});
