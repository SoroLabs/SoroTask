import { calculateKeeperProfitability } from "../useKeeperProfitability";

describe("Keeper Profitability Calculator", () => {
  it("computes net profit and positive ROI for high-yield task", () => {
    const res = calculateKeeperProfitability({
      bountyRewardXLM: 10.0,
      gasLimit: 500_000,
      baseFeeStroops: 100,
    });

    expect(res.isProfitable).toBe(true);
    expect(res.netProfitXLM).toBeGreaterThan(9.5);
    expect(res.roiPercentage).toBeGreaterThan(100);
  });

  it("identifies negative ROI when gas cost exceeds bounty reward", () => {
    const res = calculateKeeperProfitability({
      bountyRewardXLM: 0.001,
      gasLimit: 50_000_000,
      baseFeeStroops: 1_000,
      infraOverheadXLM: 0.1,
    });

    expect(res.isProfitable).toBe(false);
    expect(res.netProfitXLM).toBeLessThan(0);
  });
});
