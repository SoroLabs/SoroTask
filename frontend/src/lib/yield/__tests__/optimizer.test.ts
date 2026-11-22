import {
  breakEvenFeePerExecution,
  CANDIDATE_INTERVALS,
  computeNetApy,
  findOptimalInterval,
} from "../optimizer";
import type { YieldConfig } from "../calculator";

/**
 * Optimal rebalance interval solver (Issue #1249).
 *
 * The property that matters is not "it picks a frequency" but "it picks a
 * worse-looking frequency when fees make the obvious one lose money". These
 * pin that behaviour at the fee levels where the answer actually flips.
 */

function config(overrides: Partial<YieldConfig> = {}): YieldConfig {
  return {
    principal: 10_000,
    apr: 12,
    frequency: "monthly",
    durationYears: 1,
    gasFeePerTx: 0.1,
    keeperFeePerTx: 0.5,
    multiplier: 1,
    ...overrides,
  };
}

describe("computeNetApy", () => {
  it("annualises geometrically, not arithmetically", () => {
    // 21% over two years is 10% a year compounded, not 10.5%.
    expect(computeNetApy(100, 121, 2)).toBeCloseTo(10, 4);
  });

  it("is zero for a zero principal or duration", () => {
    expect(computeNetApy(0, 100, 1)).toBe(0);
    expect(computeNetApy(100, 110, 0)).toBe(0);
  });

  it("reports a total loss as -100%", () => {
    expect(computeNetApy(100, 0, 1)).toBe(-100);
  });
});

describe("findOptimalInterval", () => {
  it("evaluates every candidate interval", () => {
    const result = findOptimalInterval(config());
    expect(result.outcomes).toHaveLength(CANDIDATE_INTERVALS.length);
  });

  it("orders outcomes by net final balance, best first", () => {
    const result = findOptimalInterval(config());
    const nets = result.outcomes.map((o) => o.netFinal);
    expect([...nets].sort((a, b) => b - a)).toEqual(nets);
    expect(result.optimal).toBe(result.outcomes[0]);
  });

  it("prefers frequent compounding when fees are negligible", () => {
    // With no fee to pay, more compounding is strictly better, so the solver
    // should land on the most frequent schedule.
    const result = findOptimalInterval(
      config({ gasFeePerTx: 0, keeperFeePerTx: 0 }),
    );
    expect(result.optimal?.frequency).toBe("daily");
  });

  it("avoids frequent compounding when fees are high", () => {
    // This is the failure the issue describes: 365 executions at a meaningful
    // fee cost far more than the extra interest they generate.
    const result = findOptimalInterval(
      config({ gasFeePerTx: 5, keeperFeePerTx: 20 }),
    );
    expect(result.optimal?.frequency).not.toBe("daily");
    const daily = result.outcomes.find((o) => o.frequency === "daily");
    expect(daily!.netFinal).toBeLessThan(result.optimal!.netFinal);
  });

  it("reports what switching from the current schedule is worth", () => {
    const result = findOptimalInterval(
      config({ frequency: "annually", gasFeePerTx: 0, keeperFeePerTx: 0 }),
    );
    expect(result.current?.frequency).toBe("annually");
    expect(result.improvementOverCurrent).toBeGreaterThan(0);
    expect(result.improvementOverCurrent).toBeCloseTo(
      result.optimal!.netFinal - result.current!.netFinal,
      6,
    );
  });

  it("reports zero improvement when the current schedule is already optimal", () => {
    const result = findOptimalInterval(
      config({ frequency: "daily", gasFeePerTx: 0, keeperFeePerTx: 0 }),
    );
    expect(result.optimal?.frequency).toBe("daily");
    expect(result.improvementOverCurrent).toBe(0);
  });

  it("flags when no schedule beats holding", () => {
    // A forecaster that always names a best frequency hides the case where
    // automating the position is simply not worth doing.
    const result = findOptimalInterval(
      config({ principal: 100, apr: 1, gasFeePerTx: 50, keeperFeePerTx: 50 }),
    );
    expect(result.allIntervalsUnprofitable).toBe(true);
  });

  it("does not flag unprofitable when a schedule does beat holding", () => {
    const result = findOptimalInterval(config({ gasFeePerTx: 0, keeperFeePerTx: 0 }));
    expect(result.allIntervalsUnprofitable).toBe(false);
  });

  it("reports the interval in days alongside the label", () => {
    const result = findOptimalInterval(config());
    const monthly = result.outcomes.find((o) => o.frequency === "monthly");
    expect(monthly?.intervalDays).toBeCloseTo(30.42, 1);

    const daily = result.outcomes.find((o) => o.frequency === "daily");
    expect(daily?.intervalDays).toBe(1);
  });

  it("marks an outcome depleted when fees consume the position", () => {
    const result = findOptimalInterval(
      config({ principal: 10, apr: 1, gasFeePerTx: 5, keeperFeePerTx: 5 }),
    );
    const daily = result.outcomes.find((o) => o.frequency === "daily");
    expect(daily?.depleted).toBe(true);
  });

  it("handles a zero principal without dividing by zero", () => {
    const result = findOptimalInterval(config({ principal: 0 }));
    expect(result.outcomes.every((o) => Number.isFinite(o.netApy))).toBe(true);
  });
});

describe("breakEvenFeePerExecution", () => {
  it("is the per-execution interest a schedule generates", () => {
    // 10,000 at 12% compounded annually earns 1200 over one execution.
    const fee = breakEvenFeePerExecution(
      config({ durationYears: 1 }),
      "annually",
    );
    expect(fee).toBeCloseTo(1200, 0);
  });

  it("is lower for more frequent schedules", () => {
    // The same interest spread over 365 executions leaves far less headroom
    // per execution, which is why frequent compounding is fee-sensitive.
    const annually = breakEvenFeePerExecution(config(), "annually");
    const daily = breakEvenFeePerExecution(config(), "daily");
    expect(daily).toBeLessThan(annually);
  });

  it("is zero for a zero principal", () => {
    expect(breakEvenFeePerExecution(config({ principal: 0 }), "monthly")).toBe(0);
  });
});
