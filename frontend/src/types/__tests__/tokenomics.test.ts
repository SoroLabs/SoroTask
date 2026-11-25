import { INITIAL_ALLOCATIONS, calculateVestingAtMonth } from "../tokenomics";

describe("Tokenomics Vesting Simulator", () => {
  it("calculates TGE Month 0 circulating supply correctly", () => {
    const atTGE = calculateVestingAtMonth(INITIAL_ALLOCATIONS, 0);
    // Public sale (100M) is 100% unlocked at TGE
    expect(atTGE.unlockedTokens).toBe(100_000_000);
    expect(atTGE.circulatingPercentage).toBe(10);
  });

  it("calculates Year 1 Month 12 circulating supply after core cliff", () => {
    const atYear1 = calculateVestingAtMonth(INITIAL_ALLOCATIONS, 12);
    expect(atYear1.unlockedTokens).toBeGreaterThan(100_000_000);
    expect(atYear1.lockedTokens).toBeLessThan(900_000_000);
  });

  it("reaches 100% unlocked tokens at Month 48", () => {
    const atEnd = calculateVestingAtMonth(INITIAL_ALLOCATIONS, 48);
    expect(atEnd.unlockedTokens).toBe(1_000_000_000);
    expect(atEnd.lockedTokens).toBe(0);
    expect(atEnd.circulatingPercentage).toBe(100);
  });
});
