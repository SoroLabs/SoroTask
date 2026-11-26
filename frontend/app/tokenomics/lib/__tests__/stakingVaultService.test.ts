import {
  fetchStakingVaultState,
  generateVaultTxHash,
  simulateCompound,
  simulateStake,
} from "../stakingVaultService";

describe("fetchStakingVaultState", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the simulated fallback state when the live read fails", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));

    const state = await fetchStakingVaultState();

    expect(state.isSimulated).toBe(true);
    expect(state.totalStaked).toBeGreaterThan(0);
    expect(typeof state.fetchedAt).toBe("number");
    expect(state.activeUnstakes.length).toBeGreaterThanOrEqual(0);
  });

  it("returns the live state when the endpoint succeeds", async () => {
    const liveState = {
      rewardRatePerSecond: 0.5,
      totalStaked: 1_000_000,
      protocolFeeShare: 0.1,
      claimableXlm: 12.3,
      activeUnstakes: [],
      fetchedAt: Date.now(),
      isSimulated: false,
    };
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => liveState,
    } as Response);

    const state = await fetchStakingVaultState();

    expect(state.isSimulated).toBe(false);
    expect(state.totalStaked).toBe(1_000_000);
  });
});

describe("generateVaultTxHash", () => {
  it("generates unique prefixed tx hashes", () => {
    const a = generateVaultTxHash();
    const b = generateVaultTxHash();
    expect(a).not.toBe(b);
    expect(a.startsWith("VLTX-")).toBe(true);
  });
});

describe("simulateStake / simulateCompound", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("accumulates staked balance and keeps values finite", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
    const state = await fetchStakingVaultState();
    const next = await simulateStake(state, 500);
    expect(next.totalStaked).toBeGreaterThanOrEqual(state.totalStaked);
    expect(Number.isFinite(next.totalStaked)).toBe(true);
  });

  it("simulateCompound increases the stake with claimable rewards", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
    const state = { ...(await fetchStakingVaultState()), claimableXlm: 25 };
    const next = await simulateCompound(state);
    expect(next.totalStaked).toBeGreaterThan(state.totalStaked);
    expect(Number.isFinite(next.totalStaked)).toBe(true);
  });
});
