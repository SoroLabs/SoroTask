/**
 * stakingVaultMath.ts
 *
 * Pure math for the Staking Vault management interface:
 *  - dynamic base APR derived from vault contract state (reward emission vs. total staked)
 *  - lockup duration multipliers across 30/90/365-day anchors, with smooth interpolation
 *    across the lockup slider range
 *  - projected yield and compounded stake calculations
 *
 * All functions are total: empty stake / zero rewards / missing contract state
 * produce finite numbers (0) instead of NaN or Infinity.
 */

export const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export interface UnstakingVaultRequest {
  id: string;
  amountXlm: number;
  startedAt: number; // epoch ms
  cooldownSeconds: number;
  status: "active" | "ready";
}

export interface StakingVaultContractState {
  rewardRatePerSecond: number;
  totalStaked: number;
  protocolFeeShare: number;
  claimableXlm: number;
  activeUnstakes: UnstakingVaultRequest[];
  fetchedAt: number;
  /** True when the state is the deterministic simulated source. */
  isSimulated: boolean;
}

export interface LockupLevel {
  days: number;
  multiplier: number;
}

/**
 * Anchor points of the lockup multiplier curve. Each entry is a day count and the
 * exact multiplier shown by the 30d / 90d / 365d quick-select buttons.
 */
export const LOCKUP_LEVELS: LockupLevel[] = [
  { days: 30, multiplier: 1.0 },
  { days: 90, multiplier: 2.0 },
  { days: 365, multiplier: 4.0 },
];

export function createDefaultVaultState(): StakingVaultContractState {
  return {
    rewardRatePerSecond: 0.295,
    totalStaked: 12_400_000,
    protocolFeeShare: 0.2,
    claimableXlm: 31.5,
    activeUnstakes: [
      {
        id: "UNST-001",
        amountXlm: 250,
        startedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
        cooldownSeconds: 7 * 24 * 60 * 60,
        status: "active",
      },
      {
        id: "UNST-002",
        amountXlm: 120,
        startedAt: Date.now() - 45 * 24 * 60 * 60 * 1000,
        cooldownSeconds: 30 * 24 * 60 * 60,
        status: "ready",
      },
    ],
    fetchedAt: Date.now(),
    isSimulated: true,
  };
}

function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Lockup multiplier for a given duration in days.
 * Anchors: 30 days -> 1.0x, 90 days -> 2.0x, 365 days -> 4.0x.
 * Smoothly interpolated between anchors; clamped outside the [30, 365] range.
 */
export function calculateLockupMultiplier(lockupDays: number): number {
  const days = Number.isFinite(lockupDays) ? lockupDays : 0;
  const first = LOCKUP_LEVELS[0];
  const last = LOCKUP_LEVELS[LOCKUP_LEVELS.length - 1];

  if (days <= first.days) return first.multiplier;
  if (days >= last.days) return last.multiplier;

  for (let i = 0; i < LOCKUP_LEVELS.length - 1; i += 1) {
    const a = LOCKUP_LEVELS[i];
    const b = LOCKUP_LEVELS[i + 1];
    if (days <= b.days) {
      const t = (days - a.days) / (b.days - a.days);
      return a.multiplier + (b.multiplier - a.multiplier) * smoothstep(t);
    }
  }

  return last.multiplier;
}

/**
 * Base APR from vault contract state:
 *   (rewardRatePerSecond * SECONDS_PER_YEAR / totalStaked) * (1 - protocolFeeShare) * 100
 */
export function calculateBaseAprFromState(
  state: StakingVaultContractState | null,
): number {
  if (!state) return 0;
  const { rewardRatePerSecond, totalStaked, protocolFeeShare } = state;

  if (!Number.isFinite(rewardRatePerSecond) || rewardRatePerSecond <= 0)
    return 0;
  if (!Number.isFinite(totalStaked) || totalStaked <= 0) return 0;

  const feeShare = Math.min(
    1,
    Math.max(0, Number.isFinite(protocolFeeShare) ? protocolFeeShare : 0),
  );

  return (
    ((rewardRatePerSecond * SECONDS_PER_YEAR) / totalStaked) *
    (1 - feeShare) *
    100
  );
}

/**
 * Dynamic APR: base APR (from contract state) scaled by the lockup multiplier.
 */
export function calculateDynamicApr(
  state: StakingVaultContractState | null,
  lockupDays: number,
): number {
  return (
    calculateBaseAprFromState(state) * calculateLockupMultiplier(lockupDays)
  );
}

/**
 * Projected reward for `periodDays` of a `staked` balance at `apr` (percent).
 */
export function calculateProjectedYield({
  staked,
  apr,
  periodDays,
}: {
  staked: number;
  apr: number;
  periodDays: number;
}): number {
  const s = Number.isFinite(staked) ? staked : 0;
  const r = Number.isFinite(apr) ? apr : 0;
  const d = Number.isFinite(periodDays) ? periodDays : 0;
  const clampedDays = Math.min(Math.max(d, 0), 365);
  return s * (r / 100) * (clampedDays / 365);
}

/**
 * Projected stake after a 1-click compound: current stake + claimable rewards.
 */
export function calculateCompoundProjection({
  staked,
  claimableXlm,
}: {
  staked: number;
  claimableXlm: number;
}): number {
  const s = Number.isFinite(staked) ? staked : 0;
  const c = Number.isFinite(claimableXlm) ? claimableXlm : 0;
  return s + Math.max(0, c);
}

/**
 * Safe XLM formatting: never produces NaN or "Infinity".
 */
export function formatStakingNumber(
  value: number,
  maxFractionDigits = 2,
): string {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString("en-US", {
    minimumFractionDigits: maxFractionDigits,
    maximumFractionDigits: maxFractionDigits,
  });
}
