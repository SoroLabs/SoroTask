import {
  calculateBaseAprFromState,
  calculateCompoundProjection,
  calculateDynamicApr,
  calculateLockupMultiplier,
  calculateProjectedYield,
  createDefaultVaultState,
  formatStakingNumber,
  type StakingVaultContractState,
} from "../stakingVaultMath";

describe("calculateLockupMultiplier", () => {
  it("exposes exact multipliers at the 30/90/365 anchors", () => {
    expect(calculateLockupMultiplier(30)).toBeCloseTo(1.0, 10);
    expect(calculateLockupMultiplier(90)).toBeCloseTo(2.0, 10);
    expect(calculateLockupMultiplier(365)).toBeCloseTo(4.0, 10);
  });

  it("interpolates smoothly between anchors", () => {
    const at45 = calculateLockupMultiplier(45);
    const at135 = calculateLockupMultiplier(135);
    const at230 = calculateLockupMultiplier(230);

    expect(at45).toBeGreaterThan(1.0);
    expect(at45).toBeLessThan(2.0);
    expect(at135).toBeGreaterThan(2.0);
    expect(at135).toBeLessThan(4.0);
    expect(at230).toBeGreaterThan(at135);
  });

  it("clamps outside the slider range without NaN or Infinity", () => {
    expect(calculateLockupMultiplier(1)).toBeCloseTo(1.0, 10);
    expect(calculateLockupMultiplier(500)).toBeCloseTo(4.0, 10);
    for (let days = 0; days <= 1000; days += 1) {
      expect(Number.isFinite(calculateLockupMultiplier(days))).toBe(true);
    }
  });
});

describe("calculateBaseAprFromState", () => {
  it("returns 0 for missing state and for zero reward rate", () => {
    expect(calculateBaseAprFromState(null)).toBe(0);
    expect(
      calculateBaseAprFromState({
        ...createDefaultVaultState(),
        rewardRatePerSecond: 0,
      }),
    ).toBe(0);
  });

  it("derives base APR from reward rate and total staked (protocol fee applied)", () => {
    const state: StakingVaultContractState = {
      rewardRatePerSecond: 0.295,
      totalStaked: 12_400_000,
      protocolFeeShare: 0.2,
      claimableXlm: 0,
      activeUnstakes: [],
      fetchedAt: Date.now(),
      isSimulated: false,
    };
    // 0.295 * 31_536_000 / 12_400_000 * (1 - 0.2) * 100 ≈ 60.02%
    expect(calculateBaseAprFromState(state)).toBeCloseTo(60.02, 2);
  });

  it("returns 0 for zero or invalid staked supply", () => {
    expect(
      calculateBaseAprFromState({
        ...createDefaultVaultState(),
        totalStaked: 0,
      }),
    ).toBe(0);
    expect(
      calculateBaseAprFromState({
        ...createDefaultVaultState(),
        totalStaked: NaN,
      }),
    ).toBe(0);
  });
});

describe("calculateDynamicApr", () => {
  it("scales the base APR by the lockup multiplier", () => {
    const state = createDefaultVaultState();
    const baseApr = calculateBaseAprFromState(state);
    expect(calculateDynamicApr(state, 30)).toBeCloseTo(baseApr * 1.0, 8);
    expect(calculateDynamicApr(state, 90)).toBeCloseTo(baseApr * 2.0, 8);
    expect(calculateDynamicApr(state, 365)).toBeCloseTo(baseApr * 4.0, 8);
  });

  it("returns 0 for null state without NaN", () => {
    expect(calculateDynamicApr(null, 90)).toBe(0);
  });
});

describe("calculateProjectedYield", () => {
  it("returns 0 for zero stake or zero APR", () => {
    expect(
      calculateProjectedYield({ staked: 0, apr: 60, periodDays: 30 }),
    ).toBe(0);
    expect(
      calculateProjectedYield({ staked: 1000, apr: 0, periodDays: 30 }),
    ).toBe(0);
    expect(
      calculateProjectedYield({ staked: NaN, apr: NaN, periodDays: NaN }),
    ).toBe(0);
  });

  it("computes staked * (apr / 100) * (periodDays / 365)", () => {
    const projected = calculateProjectedYield({
      staked: 10_000,
      apr: 50,
      periodDays: 365,
    });
    expect(projected).toBeCloseTo(5_000, 8);
  });
});

describe("calculateCompoundProjection", () => {
  it("adds claimable rewards to the current stake", () => {
    expect(
      calculateCompoundProjection({ staked: 1_000, claimableXlm: 50 }),
    ).toBe(1_050);
  });

  it("is safe for zero or missing values", () => {
    expect(calculateCompoundProjection({ staked: 0, claimableXlm: 0 })).toBe(0);
    expect(
      calculateCompoundProjection({ staked: NaN, claimableXlm: NaN }),
    ).toBe(0);
  });
});

describe("formatStakingNumber", () => {
  it("formats finite numbers and defaults to 0.00 for NaN/Infinity", () => {
    expect(formatStakingNumber(12.5)).toBe("12.50");
    expect(formatStakingNumber(Number.NaN)).toBe("0.00");
    expect(formatStakingNumber(Number.POSITIVE_INFINITY)).toBe("0.00");
  });
});
