export interface SankeyNode {
  id: string;
  name: string;
  color?: string;
  // Calculated properties
  value?: number;
  depth?: number;
  x?: number;
  y?: number;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
  color?: string;
  isFeedback?: boolean;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export interface ParsedSankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
  feedbackLinks: SankeyLink[];
  warnings: string[];
}

export interface TokenAllocation {
  id: string;
  category: string;
  percentage: number;
  amountMillion: number;
  color: string;
  cliffMonths: number;
  vestingMonths: number;
}

export interface VestingMilestone {
  month: number;
  label: string;
  communityUnlockedPct: number;
  teamUnlockedPct: number;
  stakersPoolPct: number;
  keepersPoolPct: number;
  circulatingSupplyMillion: number;
}

/** Fixed hard cap for the TASK token, expressed in whole tokens. */
export const TOTAL_TOKEN_SUPPLY = 1_000_000_000;

/** Token amounts are stored in millions to keep the allocation table readable. */
export const INITIAL_ALLOCATIONS: TokenAllocation[] = [
  {
    id: "public-sale",
    category: "Public Sale",
    percentage: 10,
    amountMillion: 100,
    color: "#0EA5E9",
    cliffMonths: 0,
    vestingMonths: 0,
  },
  {
    id: "community-treasury",
    category: "Community Treasury",
    percentage: 30,
    amountMillion: 300,
    color: "#3B82F6",
    cliffMonths: 0,
    vestingMonths: 36,
  },
  {
    id: "staking",
    category: "Staking Emissions",
    percentage: 25,
    amountMillion: 250,
    color: "#10B981",
    cliffMonths: 0,
    vestingMonths: 48,
  },
  {
    id: "team",
    category: "Team & Founders",
    percentage: 20,
    amountMillion: 200,
    color: "#8B5CF6",
    cliffMonths: 6,
    vestingMonths: 36,
  },
  {
    id: "keepers",
    category: "Keeper Rewards Pool",
    percentage: 10,
    amountMillion: 100,
    color: "#F59E0B",
    cliffMonths: 0,
    vestingMonths: 48,
  },
  {
    id: "ecosystem",
    category: "Ecosystem Growth",
    percentage: 5,
    amountMillion: 50,
    color: "#EC4899",
    cliffMonths: 0,
    vestingMonths: 24,
  },
];

export interface VestingCalculation {
  month: number;
  unlockedTokens: number;
  lockedTokens: number;
  circulatingPercentage: number;
}

/**
 * Calculates the circulating supply at a given month after TGE.
 *
 * Each allocation unlocks linearly after its cliff; allocations without a
 * vesting duration (e.g. the public sale) are fully liquid at TGE.
 */
export function calculateVestingAtMonth(
  allocations: readonly TokenAllocation[],
  month: number,
): VestingCalculation {
  const clampedMonth = Math.max(0, month);
  const totalMillion = allocations.reduce(
    (sum, allocation) => sum + allocation.amountMillion,
    0,
  );

  const unlockedMillion = allocations.reduce((sum, allocation) => {
    if (clampedMonth < allocation.cliffMonths) {
      return sum;
    }
    if (allocation.vestingMonths <= 0) {
      return sum + allocation.amountMillion;
    }
    const elapsed = clampedMonth - allocation.cliffMonths;
    const ratio = Math.min(1, elapsed / allocation.vestingMonths);
    return sum + allocation.amountMillion * ratio;
  }, 0);

  const unlockedTokens = Math.round(unlockedMillion * 1_000_000);
  const totalTokens = Math.round(totalMillion * 1_000_000);
  const lockedTokens = Math.max(0, totalTokens - unlockedTokens);
  const circulatingPercentage =
    totalTokens === 0
      ? 0
      : Number(((unlockedTokens / totalTokens) * 100).toFixed(2));

  return {
    month: clampedMonth,
    unlockedTokens,
    lockedTokens,
    circulatingPercentage,
  };
}
