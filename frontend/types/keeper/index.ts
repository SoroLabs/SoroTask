/**
 * Keeper Data Types and Interfaces
 * 
 * This module defines all TypeScript types and interfaces used in the Keeper Control Panel.
 * Ensures type safety across the entire keeper management system.
 */

// Keeper Status Types
export type KeeperStatus = 'active' | 'inactive' | 'error' | 'paused' | 'unhealthy';
export type KeeperRegion = 'us-east' | 'us-west' | 'eu-central' | 'ap-southeast' | 'other';

/**
 * Main Keeper Interface
 * Represents a single Keeper node in the SoroTask ecosystem
 */
export interface Keeper {
  id: string;
  address: string;
  status: KeeperStatus;
  healthScore: number; // 0-100
  executionCount: number;
  successRate: number; // 0-100
  failureRate: number; // 0-100
  averageGasUsed: number;
  region?: KeeperRegion;
  lastHeartbeat: Date | string;
  uptimePercentage: number; // 0-100
  totalTasks: number;
  failedTasks: number;
  configuration: KeeperConfig;
  metrics: KeeperMetrics;
  recentExecutions: Execution[];
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Keeper Configuration
 * Defines how a Keeper is configured and its operational parameters
 */
export interface KeeperConfig {
  maxConcurrentTasks: number;
  gasLimit: number;
  gasPrice: string;
  networkTimeout: number; // milliseconds
  retryPolicy: RetryPolicy;
  alertThresholds: AlertThresholds;
  enableHeartbeat: boolean;
  heartbeatInterval: number; // seconds
}

/**
 * Retry Policy Configuration
 */
export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/**
 * Alert Thresholds
 */
export interface AlertThresholds {
  errorRateThreshold: number; // percentage
  responseTimeThreshold: number; // milliseconds
  lowUptimeThreshold: number; // percentage
  gasLimitWarning: number; // percentage of max
}

/**
 * Keeper Metrics
 * Real-time performance metrics for a Keeper
 */
export interface KeeperMetrics {
  uptime: number; // percentage
  responseTime: number; // average response time in ms
  p95ResponseTime: number; // 95th percentile response time
  p99ResponseTime: number; // 99th percentile response time
  errorRate: number; // percentage
  throughput: number; // tasks per hour
  averageGasPerTask: number;
  totalGasUsed: number;
  lastUpdate: Date | string;
}

/**
 * Task Execution Record
 */
export interface Execution {
  id: string;
  taskId: string;
  keeperId: string;
  status: 'success' | 'failed' | 'pending' | 'retrying';
  startTime: Date | string;
  endTime?: Date | string;
  duration?: number; // milliseconds
  gasUsed: number;
  errorMessage?: string;
  errorCode?: string;
  result?: unknown;
}

/**
 * Keeper Filters
 * Used for filtering and searching keepers
 */
export interface KeeperFilters {
  status?: KeeperStatus[];
  region?: KeeperRegion[];
  minHealthScore?: number;
  maxHealthScore?: number;
  minSuccessRate?: number;
  maxSuccessRate?: number;
  searchQuery?: string;
  dateRange?: {
    from: Date | string;
    to: Date | string;
  };
}

/**
 * Keeper Sort Configuration
 */
export interface KeeperSortConfig {
  field: keyof Keeper;
  order: 'asc' | 'desc';
}

/**
 * Pagination State
 */
export interface PaginationState {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  totalPages: number;
}

/**
 * API Response for Keeper List
 */
export interface KeeperListResponse {
  data: Keeper[];
  pagination: PaginationState;
  meta: {
    cached: boolean;
    timestamp: string;
    cached_at?: string;
  };
}

/**
 * API Response for Keeper Details
 */
export interface KeeperDetailResponse {
  data: Keeper;
  meta: {
    cached: boolean;
    timestamp: string;
  };
}

/**
 * Keeper Update Payload
 */
export interface KeeperUpdatePayload {
  configuration?: Partial<KeeperConfig>;
  alertThresholds?: Partial<AlertThresholds>;
}

/**
 * Error Types
 */
export enum KeeperErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  API_ERROR = 'API_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  UNAUTHORIZED_ERROR = 'UNAUTHORIZED_ERROR',
  NOT_FOUND_ERROR = 'NOT_FOUND_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Keeper Error Interface
 */
export interface KeeperError {
  type: KeeperErrorType;
  message: string;
  timestamp: Date;
  retriable: boolean;
  retryAfter?: number;
  originalError?: Error;
  statusCode?: number;
  context?: Record<string, unknown>;
}

/**
 * API Request Configuration
 */
export interface KeeperAPIRequest {
  page?: number;
  limit?: number;
  status?: KeeperStatus[];
  region?: KeeperRegion[];
  sortBy?: keyof Keeper;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

/**
 * Action Response
 */
export interface ActionResponse {
  success: boolean;
  message: string;
  data?: unknown;
  error?: KeeperError;
}

/**
 * Keeper Statistics
 */
export interface KeeperStatistics {
  totalKeepers: number;
  activeKeepers: number;
  inactiveKeepers: number;
  unhealthyKeepers: number;
  averageHealthScore: number;
  averageSuccessRate: number;
  totalExecutions: number;
  totalFailedExecutions: number;
  regionDistribution: Record<KeeperRegion, number>;
  statusDistribution: Record<KeeperStatus, number>;
}

/**
 * Real-time Update Message
 * Used for WebSocket updates
 */
export interface KeeperUpdateMessage {
  type: 'keeper-status' | 'keeper-metrics' | 'keeper-execution' | 'keeper-error';
  keeperId: string;
  data: Partial<Keeper> | Partial<KeeperMetrics> | Execution | KeeperError;
  timestamp: string;
}

/**
 * Selection State
 */
export interface SelectionState {
  selectedIds: Set<string>;
  isAllSelected: boolean;
  selectionCount: number;
}

/**
 * Type Guards
 */
export function isKeeperError(error: unknown): error is KeeperError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    'message' in error &&
    'timestamp' in error
  );
}

export function isKeeper(value: unknown): value is Keeper {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'address' in value &&
    'status' in value &&
    'healthScore' in value
  );
}

export function isKeeperListResponse(value: unknown): value is KeeperListResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'pagination' in value &&
    Array.isArray((value as Record<string, unknown>).data)
  );
}
