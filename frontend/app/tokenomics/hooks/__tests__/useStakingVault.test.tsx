import { act, renderHook, waitFor } from "@testing-library/react";
import { useStakingVault, type StakingVaultState } from "../useStakingVault";
import {
  calculateBaseAprFromState,
  calculateDynamicApr,
  createDefaultVaultState,
} from "@/app/tokenomics/lib/stakingVaultMath";

jest.mock("@/app/context/WalletContext", () => ({
  useWalletOptional: jest.fn(),
}));

jest.mock("@/app/tokenomics/lib/stakingVaultService", () => ({
  fetchStakingVaultState: jest.fn(),
  generateVaultTxHash: jest.fn((prefix = "VLTX") => `${prefix}-1`),
  simulateStake: jest.fn(),
  simulateCompound: jest.fn(),
}));

import { useWalletOptional } from "@/app/context/WalletContext";
import {
  fetchStakingVaultState,
  simulateCompound,
  simulateStake,
} from "@/app/tokenomics/lib/stakingVaultService";

const mockUseWalletOptional = useWalletOptional as jest.Mock;
const mockFetchState = fetchStakingVaultState as jest.Mock;
const mockSimulateStake = simulateStake as jest.Mock;
const mockSimulateCompound = simulateCompound as jest.Mock;

const CONNECTED_ADDRESS =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("useStakingVault", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseWalletOptional.mockReturnValue({
      session: { address: CONNECTED_ADDRESS },
    });
  });

  it("exposes dynamic APR from contract state, with the lockup multiplier applied", async () => {
    const state = { ...createDefaultVaultState(), isSimulated: false };
    mockFetchState.mockResolvedValue(state);

    const { result } = renderHook(() => useStakingVault());

    await waitFor(() =>
      expect(result.current.contractState.totalStaked).toBeGreaterThan(0),
    );

    expect(result.current.isConnected).toBe(true);
    expect(result.current.walletAddress).toBe(CONNECTED_ADDRESS);
    expect(result.current.baseApr).toBeCloseTo(
      calculateBaseAprFromState(state),
      8,
    );
    expect(result.current.dynamicApr).toBeCloseTo(
      calculateDynamicApr(state, result.current.lockupDays),
      8,
    );
    expect(result.current.multiplier).toBeCloseTo(1.0, 8);
    expect(Number.isFinite(result.current.dynamicApr)).toBe(true);
  });

  it("updates the dynamic APR when the lockup changes (30/90/365 multipliers)", async () => {
    const state = createDefaultVaultState();
    mockFetchState.mockResolvedValue(state);

    const { result } = renderHook(() => useStakingVault());
    await waitFor(() =>
      expect(result.current.contractState.totalStaked).toBeGreaterThan(0),
    );

    const baseApr = result.current.baseApr;

    act(() => result.current.setLockupDays(90));
    expect(result.current.multiplier).toBeCloseTo(2.0, 8);
    expect(result.current.dynamicApr).toBeCloseTo(baseApr * 2.0, 8);

    act(() => result.current.setLockupDays(365));
    expect(result.current.multiplier).toBeCloseTo(4.0, 8);
    expect(result.current.dynamicApr).toBeCloseTo(baseApr * 4.0, 8);
  });

  it("clamps the lockup duration to the 1–365 range", async () => {
    mockFetchState.mockResolvedValue(createDefaultVaultState());

    const { result } = renderHook(() => useStakingVault());
    await waitFor(() =>
      expect(result.current.contractState.totalStaked).toBeGreaterThan(0),
    );

    act(() => result.current.setLockupDays(500));
    expect(result.current.lockupDays).toBe(365);

    act(() => result.current.setLockupDays(0));
    expect(result.current.lockupDays).toBe(1);
  });

  it("stake() updates the stake balance and records the tx hash", async () => {
    mockFetchState.mockResolvedValue(createDefaultVaultState());
    const state = createDefaultVaultState();
    mockSimulateStake.mockResolvedValue({
      ...state,
      totalStaked: state.totalStaked + 500,
    });

    const { result } = renderHook(() => useStakingVault());
    await waitFor(() => expect(result.current.stakedXlm).toBeGreaterThan(0));

    await act(async () => {
      await result.current.stake(500);
    });

    expect(mockSimulateStake).toHaveBeenCalledWith(expect.anything(), 500);
    expect(result.current.isStaking).toBe(false);
    expect(result.current.stakeError).toBeNull();
    expect(result.current.lastTxHash).toBe("STAKE-1");
    expect(result.current.stakedXlm).toBeGreaterThanOrEqual(state.totalStaked);
  });

  it("compoundStake() re-stakes claimable rewards and records the tx hash", async () => {
    mockFetchState.mockResolvedValue(createDefaultVaultState());
    mockSimulateCompound.mockResolvedValue({
      ...createDefaultVaultState(),
      claimableXlm: 0,
    });

    const { result } = renderHook(() => useStakingVault());
    await waitFor(() => expect(result.current.claimableXlm).toBeGreaterThan(0));

    const compoundBefore = result.current.compoundProjection;
    expect(compoundBefore).toBeGreaterThanOrEqual(result.current.stakedXlm);

    await act(async () => {
      await result.current.compoundStake();
    });

    expect(mockSimulateCompound).toHaveBeenCalled();
    expect(result.current.compoundError).toBeNull();
    expect(result.current.isCompounding).toBe(false);
    expect(result.current.lastTxHash).toBe("COMPOUND-1");
  });

  it("surfaces stake and compound errors instead of throwing", async () => {
    mockFetchState.mockResolvedValue(createDefaultVaultState());
    mockSimulateStake.mockRejectedValue(new Error("stake failed"));
    mockSimulateCompound.mockRejectedValue(new Error("compound failed"));

    const { result } = renderHook(() => useStakingVault());
    await waitFor(() =>
      expect(result.current.contractState.totalStaked).toBeGreaterThan(0),
    );

    await act(async () => {
      await result.current.stake(10);
    });
    expect(result.current.stakeError).toBe("stake failed");
    expect(result.current.isStaking).toBe(false);

    await act(async () => {
      await result.current.compoundStake();
    });
    expect(result.current.compoundError).toBe("compound failed");
    expect(result.current.isCompounding).toBe(false);
  });

  it("returns a StakingVaultState shape without NaN or Infinity", async () => {
    mockFetchState.mockResolvedValue(createDefaultVaultState());

    const { result } = renderHook(() => useStakingVault());
    await waitFor(() =>
      expect(result.current.contractState.totalStaked).toBeGreaterThan(0),
    );

    const snapshot: StakingVaultState = result.current;
    const numbers = [
      snapshot.baseApr,
      snapshot.dynamicApr,
      snapshot.multiplier,
      snapshot.projectedYieldXlm,
      snapshot.compoundProjection,
      snapshot.stakedXlm,
      snapshot.claimableXlm,
    ];
    for (const value of numbers) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
