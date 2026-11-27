/**
 * useStakingVault.ts
 *
 * React hook exposing the Staking Vault management state for the tokenomics
 * page: contract state, dynamic APR (base APR from vault state scaled by the
 * lockup multiplier), staked/claimable balances, and the unstaking timelock
 * tracker data.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWalletOptional } from "@/app/context/WalletContext";
import {
  calculateBaseAprFromState,
  calculateCompoundProjection,
  calculateDynamicApr,
  calculateLockupMultiplier,
  calculateProjectedYield,
  createDefaultVaultState,
  type StakingVaultContractState,
  type UnstakingVaultRequest,
} from "@/app/tokenomics/lib/stakingVaultMath";
import {
  fetchStakingVaultState,
  generateVaultTxHash,
  simulateCompound,
  simulateStake,
} from "@/app/tokenomics/lib/stakingVaultService";

export const DEFAULT_LOCKUP_DAYS = 30;
const REFRESH_INTERVAL_MS = 30_000;

export interface StakingVaultState {
  /** Whether a wallet is connected and addressable. */
  isConnected: boolean;
  /** Connected wallet address, or null when disconnected. */
  walletAddress: string | null;
  /** Latest vault contract state (simulated fallback until deployed). */
  contractState: StakingVaultContractState;
  /** True when the displayed state comes from the simulated source. */
  isSimulated: boolean;
  /** Total staked balance counted by the vault. */
  stakedXlm: number;
  /** Rewards currently claimable from the vault. */
  claimableXlm: number;
  /** Active unstaking requests with cooldowns for the timelock tracker. */
  activeUnstakes: UnstakingVaultRequest[];
  /** Base APR derived from vault contract state. */
  baseApr: number;
  /** Dynamic APR = base APR * lockup multiplier. */
  dynamicApr: number;
  /** Current lockup multiplier for the selected duration. */
  multiplier: number;
  /** Projected yield for the selected lockup period. */
  projectedYieldXlm: number;
  /** Projected compounded stake (staked + claimable). */
  compoundProjection: number;
  /** Selected lockup duration in days (1–365). */
  lockupDays: number;
  /** Update the selected lockup duration. */
  setLockupDays: (days: number) => void;
  /** Whether a stake transaction is in flight. */
  isStaking: boolean;
  /** Whether a 1-click compound transaction is in flight. */
  isCompounding: boolean;
  /** Stake error message, or null. */
  stakeError: string | null;
  /** Compound error message, or null. */
  compoundError: string | null;
  /** Last transaction hash, or null. */
  lastTxHash: string | null;
  /** Refresh vault state from the service. */
  refresh: () => Promise<void>;
  /** Stake `amountXlm` into the vault. */
  stake: (amountXlm: number) => Promise<void>;
  /** 1-click compound: claim rewards and re-stake them. */
  compoundStake: () => Promise<void>;
}

export function useStakingVault(): StakingVaultState {
  const wallet = useWalletOptional();
  const [contractState, setContractState] =
    useState<StakingVaultContractState | null>(null);
  const [isSimulated, setIsSimulated] = useState(true);
  const [lockupDays, setLockupDaysState] =
    useState<number>(DEFAULT_LOCKUP_DAYS);
  const [isStaking, setIsStaking] = useState(false);
  const [isCompounding, setIsCompounding] = useState(false);
  const [stakeError, setStakeError] = useState<string | null>(null);
  const [compoundError, setCompoundError] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const walletAddress = wallet?.session?.address ?? null;
  const isConnected = Boolean(walletAddress);

  const refresh = useCallback(async () => {
    try {
      const state = await fetchStakingVaultState();
      setContractState(state);
      setIsSimulated(state.isSimulated === true);
    } catch {
      // Keep the previous state; the UI must never break from a fetch failure.
    }
  }, []);

  useEffect(() => {
    // Defer the initial fetch so setState happens outside the effect body.
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  // Refresh live vault state while the vault page is mounted.
  useEffect(() => {
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const stake = useCallback(
    async (amountXlm: number) => {
      setStakeError(null);
      setIsStaking(true);
      try {
        const amount = Number.isFinite(amountXlm) ? Math.max(0, amountXlm) : 0;
        const nextState = await simulateStake(
          contractState ?? createDefaultVaultState(),
          amount,
        );
        setContractState(nextState);
        setLastTxHash(generateVaultTxHash("STAKE"));
      } catch (error) {
        setStakeError(
          error instanceof Error ? error.message : "Stake transaction failed.",
        );
      } finally {
        setIsStaking(false);
      }
    },
    [contractState],
  );

  const compoundStake = useCallback(async () => {
    setCompoundError(null);
    setIsCompounding(true);
    try {
      const nextState = await simulateCompound(
        contractState ?? createDefaultVaultState(),
      );
      setContractState(nextState);
      setLastTxHash(generateVaultTxHash("COMPOUND"));
    } catch (error) {
      setCompoundError(
        error instanceof Error ? error.message : "Compound transaction failed.",
      );
    } finally {
      setIsCompounding(false);
    }
  }, [contractState]);

  const setLockupDays = useCallback((days: number) => {
    setLockupDaysState((prev) => {
      const candidate = Number.isFinite(days)
        ? Math.min(365, Math.max(1, Math.round(days)))
        : prev;
      return candidate;
    });
    setStakeError(null);
  }, []);

  const state = contractState ?? createDefaultVaultState();

  const stakedXlm = useMemo(
    () => (Number.isFinite(state.totalStaked) ? state.totalStaked : 0),
    [state.totalStaked],
  );
  const claimableXlm = useMemo(
    () => (Number.isFinite(state.claimableXlm) ? state.claimableXlm : 0),
    [state.claimableXlm],
  );
  const activeUnstakes = useMemo(
    () =>
      (state.activeUnstakes ?? []).filter(
        (u): u is UnstakingVaultRequest =>
          Boolean(u) &&
          Number.isFinite(u.amountXlm) &&
          Number.isFinite(u.startedAt) &&
          Number.isFinite(u.cooldownSeconds),
      ),
    [state.activeUnstakes],
  );
  const baseApr = useMemo(() => calculateBaseAprFromState(state), [state]);
  const multiplier = useMemo(
    () => calculateLockupMultiplier(lockupDays),
    [lockupDays],
  );
  const dynamicApr = useMemo(
    () => calculateDynamicApr(state, lockupDays),
    [state, lockupDays],
  );
  const projectedYieldXlm = useMemo(
    () =>
      calculateProjectedYield({
        staked: stakedXlm,
        apr: dynamicApr,
        periodDays: lockupDays,
      }),
    [stakedXlm, dynamicApr, lockupDays],
  );
  const compoundProjection = useMemo(
    () => calculateCompoundProjection({ staked: stakedXlm, claimableXlm }),
    [stakedXlm, claimableXlm],
  );

  return {
    isConnected,
    walletAddress,
    contractState: state,
    isSimulated,
    stakedXlm,
    claimableXlm,
    activeUnstakes,
    baseApr,
    dynamicApr,
    multiplier,
    projectedYieldXlm,
    compoundProjection,
    lockupDays,
    setLockupDays,
    isStaking,
    isCompounding,
    stakeError,
    compoundError,
    lastTxHash,
    refresh,
    stake,
    compoundStake,
  };
}
