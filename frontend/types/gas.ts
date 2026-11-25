/**
 * Gas Fee Estimation and Optimization Types
 * 
 * Defines data structures for gas fee analysis, forecasting, and optimization
 */

/**
 * Historical gas fee data point
 */
export interface GasFeeDataPoint {
  timestamp: number;
  fee: number; // in stroops
  blockHeight?: number;
}

/**
 * Statistical summary of gas fees
 */
export interface GasFeeStatistics {
  count: number;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  p95: number;
  p99: number;
}

/**
 * Gas fee forecast for a task
 */
export interface GasFeeForecast {
  taskId: string;
  estimatedCost: number | null;
  confidence: 'high' | 'low';
  historicalSamples: number;
  isUnderfunded: boolean;
  recommendedBalance: number | null;
  buffer: number | null;
  stats: GasFeeStatistics | null;
  reason: string;
}

/**
 * Multi-task forecast aggregation
 */
export interface MultiTaskForecast {
  windowSizeSeconds: number;
  forecastedTasks: GasFeeForecast[];
  totalEstimatedCost: number;
  highConfidenceCount: number;
  lowConfidenceCount: number;
  underfundedCount: number;
  riskLevel: 'low' | 'medium' | 'high';
  summary: string;
}

/**
 * Time window for execution optimization
 */
export interface ExecutionWindow {
  windowStart: number;
  windowEnd: number;
  tasksInWindow: number;
  totalEstimatedCost: number;
  underfundedCount: number;
  averageGasPrice: number;
  confidenceScore: number;
}

/**
 * Gas price trend data
 */
export interface GasPriceTrend {
  trackedSamples: number;
  shortTermAverage: number;
  longTermAverage: number;
  trend: number;
  multiplier: number;
  shortWindowSeconds: number;
  longWindowSeconds: number;
  minMultiplier: number;
  maxMultiplier: number;
}

/**
 * Optimization recommendation
 */
export interface OptimizationRecommendation {
  taskId: string;
  currentExecutionTime: number;
  recommendedExecutionTime: number;
  estimatedSavings: number; // in stroops
  savingsPercentage: number;
  confidence: number;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
  recommendedBalance?: number; // Optional: for underfunded tasks
}

/**
 * Gas fee analysis result
 */
export interface GasFeeAnalysis {
  taskId: string;
  historicalData: GasFeeDataPoint[];
  statistics: GasFeeStatistics | null;
  forecast: GasFeeForecast;
  priceTrend: GasPriceTrend;
  optimizationWindows: ExecutionWindow[];
  recommendations: OptimizationRecommendation[];
  lastUpdated: number;
}

/**
 * Gas fee engine configuration
 */
export interface GasFeeEngineConfig {
  safetyBufferMultiplier: number;
  aggregationWindowSeconds: number;
  highConfidenceThreshold: number;
  maxHistoricalSamples: number;
  optimizationHorizonHours: number;
  minSavingsThreshold: number; // minimum savings to recommend change (in stroops)
}

/**
 * Gas fee engine state
 */
export interface GasFeeEngineState {
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
  lastSyncTime: number | null;
  trackedTasks: number;
  totalHistoricalSamples: number;
  config: GasFeeEngineConfig;
}

/**
 * Gas fee error types
 */
export enum GasFeeErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  API_ERROR = 'API_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
  CALCULATION_ERROR = 'CALCULATION_ERROR',
  UNAUTHORIZED_ERROR = 'UNAUTHORIZED_ERROR',
  NOT_FOUND_ERROR = 'NOT_FOUND_ERROR',
}

/**
 * Gas fee error
 */
export interface GasFeeError {
  type: GasFeeErrorType;
  message: string;
  timestamp: Date;
  retriable: boolean;
  originalError?: Error;
  context?: Record<string, unknown>;
  statusCode?: number;
  retryAfter?: number;
}
