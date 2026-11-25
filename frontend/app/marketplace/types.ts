/**
 * Types for the Keeper Marketplace UI with Bidding System (#412)
 */

// ---------------------------------------------------------------------------
// Keeper profile
// ---------------------------------------------------------------------------

export type KeeperTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface Keeper {
  id: string;
  address: string;
  label?: string;
  tier: KeeperTier;
  /** Percentage 0–100 */
  reliabilityScore: number;
  /** Total tasks executed historically */
  totalExecutions: number;
  /** Percentage of executions that succeeded */
  successRate: number;
  /** Median execution latency in milliseconds */
  medianLatencyMs: number;
  /** Current minimum bid accepted by this keeper (in XLM) */
  minBidXlm: number;
  /** Whether this keeper is currently online and accepting tasks */
  isOnline: boolean;
  /** ISO timestamp of last recorded activity */
  lastActiveAt: string;
}

// ---------------------------------------------------------------------------
// Bid
// ---------------------------------------------------------------------------

export type BidStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

export interface KeeperBid {
  id: string;
  keeperId: string;
  /** Task id this bid is for */
  taskId: string;
  /** Offered amount in XLM */
  amountXlm: number;
  status: BidStatus;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Marketplace state
// ---------------------------------------------------------------------------

export type SortField = 'reliabilityScore' | 'successRate' | 'medianLatencyMs' | 'minBidXlm';
export type SortDirection = 'asc' | 'desc';

export interface MarketplaceFilters {
  onlineOnly: boolean;
  minReliability: number; // 0–100
  maxBidXlm: number | null;
  tier: KeeperTier | 'all';
}

export interface MarketplaceState {
  keepers: Keeper[];
  bids: KeeperBid[];
  filters: MarketplaceFilters;
  sortField: SortField;
  sortDirection: SortDirection;
  isLoading: boolean;
  error: string | null;
}

export const DEFAULT_FILTERS: MarketplaceFilters = {
  onlineOnly: false,
  minReliability: 0,
  maxBidXlm: null,
  tier: 'all',
};
