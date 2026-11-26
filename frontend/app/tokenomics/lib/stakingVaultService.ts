/**
 * stakingVaultService.ts
 *
 * Reads / simulates Staking Vault contract state for the tokenomics page.
 * The vault contract is not yet deployed on a SoroLabs network, so live reads
 * fall back to the deterministic simulated state in createDefaultVaultState()
 * and the interface stays compatible with a live `fetchStakingVaultState`
 * once the vault is deployed.
 */

import {
  createDefaultVaultState,
  type StakingVaultContractState,
} from "./stakingVaultMath";

const VAULT_STATE_ENDPOINT = "/api/v1/staking/vault/state";
const SIMULATE_STAKE_ENDPOINT = "/api/v1/staking/vault/simulate-stake";
const SIMULATE_COMPOUND_ENDPOINT = "/api/v1/staking/vault/simulate-compound";

export async function fetchStakingVaultState(): Promise<StakingVaultContractState> {
  try {
    const response = await fetch(VAULT_STATE_ENDPOINT);
    if (response.ok) {
      const state = (await response.json()) as StakingVaultContractState;
      if (state && Number.isFinite(state.totalStaked)) {
        return { ...state, isSimulated: false };
      }
    }
  } catch {
    // Live state unavailable; fall back to simulated state below.
  }
  return createDefaultVaultState();
}

export async function simulateStake(
  state: StakingVaultContractState,
  amountXlm: number,
): Promise<StakingVaultContractState> {
  try {
    const response = await fetch(SIMULATE_STAKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, amountXlm }),
    });
    if (response.ok) {
      return (await response.json()) as StakingVaultContractState;
    }
  } catch {
    // Fall through to local simulation.
  }
  return {
    ...state,
    totalStaked: Math.max(0, (state.totalStaked ?? 0) + Math.max(0, amountXlm)),
    fetchedAt: Date.now(),
  };
}

export async function simulateCompound(
  state: StakingVaultContractState,
): Promise<StakingVaultContractState> {
  try {
    const response = await fetch(SIMULATE_COMPOUND_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (response.ok) {
      return (await response.json()) as StakingVaultContractState;
    }
  } catch {
    // Fall through to local simulation.
  }
  return {
    ...state,
    totalStaked: Math.max(
      0,
      (state.totalStaked ?? 0) + Math.max(0, state.claimableXlm ?? 0),
    ),
    claimableXlm: 0,
    fetchedAt: Date.now(),
  };
}

let txCounter = 0;

export function generateVaultTxHash(prefix = "VLTX"): string {
  txCounter += 1;
  return `${prefix}-${Date.now().toString(16)}-${txCounter.toString(16).padStart(4, "0")}`;
}
