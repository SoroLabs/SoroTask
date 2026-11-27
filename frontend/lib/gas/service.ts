/**
 * Gas Fee Estimation Service
 * 
 * Core service for gas fee analysis, forecasting, and optimization.
 * Integrates with keeper backend for historical data and provides
 * frontend-specific optimization capabilities.
 */

import {
  GasFeeDataPoint,
  GasFeeStatistics,
  GasFeeForecast,
  MultiTaskForecast,
  ExecutionWindow,
  GasPriceTrend,
  OptimizationRecommendation,
  GasFeeAnalysis,
  GasFeeEngineConfig,
  GasFeeEngineState,
  GasFeeError,
  GasRunwayProjection,
  GasRunwayScenario,
  BatchDepositPlan,
  GasRunwayAlert,
} from '@/types/gas';

export type {
  GasRunwayProjection,
  GasRunwayScenario,
  BatchDepositPlan,
  GasRunwayAlert,
};
import {
  createGasFeeError,
  calculateRetryAfter,
  logGasFeeError,
  validateGasFeeData,
  sanitizeGasFeeData,
  shouldRetry,
  getGasFeeErrorMessage,
} from './errors';

/**
 * Configuration for API requests
 */
interface FetchOptions extends RequestInit {
  timeout?: number;
  retryCount?: number;
  useCache?: boolean;
  cacheKey?: string;
}

/**
 * In-memory cache for gas fee data
 */
const dataCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Runway alert threshold (10% remaining runway triggers notification)
 */
const RUNWAY_ALERT_THRESHOLD = 0.1;

/**
 * Base URL for API (can be configured per environment)
 */
const getApiBaseUrl = (): string => {
  if (typeof window !== 'undefined' && (window as any).__NEXT_PUBLIC_API_URL) {
    return (window as any).__NEXT_PUBLIC_API_URL;
  }
  // @ts-ignore - process is available in Next.js environment
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) {
    // @ts-ignore
    return process.env.NEXT_PUBLIC_API_URL;
  }
  return '/api';
};

const API_BASE_URL = getApiBaseUrl();

/**
 * Default configuration for gas fee engine
 */
const DEFAULT_CONFIG: GasFeeEngineConfig = {
  safetyBufferMultiplier: 1.5,
  aggregationWindowSeconds: 3600,
  highConfidenceThreshold: 5,
  maxHistoricalSamples: 100,
  optimizationHorizonHours: 24,
  minSavingsThreshold: 100, // 100 stroops minimum savings
  runwayHistoryWindowDays: 30,
  runwayAlertThreshold: RUNWAY_ALERT_THRESHOLD,
  defaultIntervalSeconds: 3600,
  defaultComplexityMultiplier: 1,
};

/**
 * Make a resilient fetch request with retry logic and timeout
 */
async function fetchWithRetry<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const {
    timeout = 10000,
    retryCount = 0,
    useCache = true,
    cacheKey,
    ...fetchOptions
  } = options;

  const url = `${API_BASE_URL}${endpoint}`;
  const key = cacheKey || endpoint;

  // Check cache first
  if (useCache && fetchOptions.method !== 'POST' && fetchOptions.method !== 'PATCH') {
    const cached = dataCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return { ...(cached.data as T), __cached: true } as T;
    }
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...fetchOptions.headers,
      },
    });

    clearTimeout(timeoutId);

    // Handle non-OK responses
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw createGasFeeError(
        new Error(errorData.message || `HTTP ${response.status}`),
        {
          endpoint,
          method: fetchOptions.method,
          responseStatus: response.status,
          responseData: errorData,
          retryCount,
        }
      );
    }

    const data = await response.json();

    // Cache successful responses
    if (useCache && fetchOptions.method !== 'POST' && fetchOptions.method !== 'PATCH') {
      dataCache.set(key, {
        data,
        timestamp: Date.now(),
      });
    }

    return data as T;
  } catch (error) {
    let gasFeeError: GasFeeError;

    // Check if error is already a GasFeeError structure
    if (error && typeof error === 'object' && 'type' in error && 'message' in error) {
      gasFeeError = error as GasFeeError;
    } else {
      gasFeeError = createGasFeeError(error, {
        endpoint,
        method: fetchOptions.method,
        retryCount,
      });
    }

    logGasFeeError(gasFeeError);

    // Implement retry logic
    if (shouldRetry(gasFeeError, retryCount)) {
      const delay = calculateRetryAfter(retryCount);
      await new Promise((resolve) => setTimeout(resolve, delay));

      return fetchWithRetry<T>(endpoint, {
        ...options,
        retryCount: retryCount + 1,
      });
    }

    throw gasFeeError;
  }
}

/**
 * Gas Fee Estimation Engine
 * 
 * Main service class for gas fee analysis and optimization
 */
export class GasFeeEngine {
  private config: GasFeeEngineConfig;
  private state: GasFeeEngineState;
  private historicalData: Map<string, GasFeeDataPoint[]>;
  private priceTrendHistory: GasFeeDataPoint[];

  constructor(config?: Partial<GasFeeEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.historicalData = new Map();
    this.priceTrendHistory = [];
    
    this.state = {
      isInitialized: false,
      isLoading: false,
      error: null,
      lastSyncTime: null,
      trackedTasks: 0,
      totalHistoricalSamples: 0,
      config: this.config,
    };
  }

  /**
   * Initialize the gas fee engine
   */
  async initialize(): Promise<void> {
    this.state.isLoading = true;
    this.state.error = null;

    try {
      // Fetch initial data from keeper backend
      await this.syncHistoricalData();
      
      this.state.isInitialized = true;
      this.state.lastSyncTime = Date.now();
    } catch (error) {
      const gasFeeError = createGasFeeError(error);
      logGasFeeError(gasFeeError);
      this.state.error = getGasFeeErrorMessage(gasFeeError);
      throw gasFeeError;
    } finally {
      this.state.isLoading = false;
    }
  }

  /**
   * Sync historical data from keeper backend
   */
  private async syncHistoricalData(): Promise<void> {
    try {
      const forecastData = await fetchWithRetry<{ 
        trackedTasks: number;
        totalHistoricalSamples: number;
        taskSamples: Array<{ taskId: string; samples: number }>;
      }>('/metrics/forecast', {
        method: 'GET',
        useCache: true,
      });

      this.state.trackedTasks = forecastData.trackedTasks;
      this.state.totalHistoricalSamples = forecastData.totalHistoricalSamples;
    } catch (error) {
      // If backend is unavailable, continue with empty state
      console.warn('Failed to sync historical data:', error);
    }
  }

  /**
   * Calculate statistics from historical gas fee data
   */
  calculateStatistics(data: GasFeeDataPoint[]): GasFeeStatistics | null {
    if (!data || data.length === 0) {
      return null;
    }

    const fees = data.map(d => d.fee).sort((a, b) => a - b);
    const count = fees.length;
    const mean = fees.reduce((sum, fee) => sum + fee, 0) / count;
    const variance = fees.reduce((sum, fee) => sum + (fee - mean) ** 2, 0) / count;
    const stdDev = Math.sqrt(variance);

    const min = fees[0];
    const max = fees[count - 1];
    const median = fees[Math.floor(count / 2)];

    // Percentiles
    const p95Index = Math.floor(count * 0.95);
    const p99Index = Math.floor(count * 0.99);
    const p95 = fees[Math.min(p95Index, count - 1)];
    const p99 = fees[Math.min(p99Index, count - 1)];

    return {
      count,
      mean: Math.round(mean),
      median: Math.round(median),
      stdDev: Math.round(stdDev),
      min,
      max,
      p95,
      p99,
    };
  }

  /**
   * Generate gas fee forecast for a single task
   */
  async forecastTaskGas(taskId: string, gasBalance: number): Promise<GasFeeForecast> {
    try {
      const response = await fetchWithRetry<{
        taskId: string;
        estimatedCost: number | null;
        confidence: 'high' | 'low';
        historicalSamples: number;
        isUnderfunded: boolean;
        recommendedBalance: number | null;
        buffer: number | null;
        stats: GasFeeStatistics | null;
        reason: string;
      }>(`/keeper/gas/forecast/${taskId}`, {
        method: 'POST',
        body: JSON.stringify({ gasBalance }),
        useCache: false,
      });

      return response;
    } catch (error) {
      // Fallback to client-side calculation if backend unavailable
      return this.calculateClientSideForecast(taskId, gasBalance);
    }
  }

  /**
   * Client-side fallback forecast calculation
   */
  private calculateClientSideForecast(taskId: string, gasBalance: number): GasFeeForecast {
    const historicalData = this.historicalData.get(taskId);
    
    if (!historicalData || historicalData.length === 0) {
      return {
        taskId,
        estimatedCost: null,
        confidence: 'low',
        historicalSamples: 0,
        isUnderfunded: false,
        recommendedBalance: null,
        buffer: null,
        stats: null,
        reason: 'no_historical_data',
      };
    }

    const stats = this.calculateStatistics(historicalData);
    if (!stats) {
      return {
        taskId,
        estimatedCost: null,
        confidence: 'low',
        historicalSamples: historicalData.length,
        isUnderfunded: false,
        recommendedBalance: null,
        buffer: null,
        stats: null,
        reason: 'calculation_error',
      };
    }

    const estimatedCost = stats.p95;
    const buffer = Math.round(estimatedCost * (this.config.safetyBufferMultiplier - 1));
    const recommendedBalance = estimatedCost + buffer;
    const confidence = stats.count >= this.config.highConfidenceThreshold ? 'high' : 'low';
    const isUnderfunded = gasBalance < recommendedBalance;

    return {
      taskId,
      estimatedCost,
      confidence,
      historicalSamples: stats.count,
      isUnderfunded,
      recommendedBalance,
      buffer,
      stats,
      reason: confidence === 'high' ? 'based_on_history' : 'limited_samples',
    };
  }

  /**
   * Forecast gas fees for multiple tasks
   */
  async forecastMultipleTasks(
    tasks: Array<{ taskId: string; gasBalance: number }>
  ): Promise<MultiTaskForecast> {
    try {
      const response = await fetchWithRetry<MultiTaskForecast>(
        '/keeper/gas/forecast/batch',
        {
          method: 'POST',
          body: JSON.stringify({ tasks }),
          useCache: false,
        }
      );

      return response;
    } catch (error) {
      // Fallback to individual forecasts
      const forecasts = await Promise.all(
        tasks.map(task => this.forecastTaskGas(task.taskId, task.gasBalance))
      );

      const totalEstimatedCost = forecasts
        .filter(f => f.estimatedCost !== null)
        .reduce((sum, f) => sum + (f.estimatedCost || 0), 0);

      const highConfidenceCount = forecasts.filter(f => f.confidence === 'high').length;
      const lowConfidenceCount = forecasts.filter(f => f.confidence === 'low').length;
      const underfundedCount = forecasts.filter(f => f.isUnderfunded).length;

      let riskLevel: 'low' | 'medium' | 'high' = 'low';
      if (underfundedCount > 0 && highConfidenceCount > 0) {
        riskLevel = 'high';
      } else if (underfundedCount > 0) {
        riskLevel = 'medium';
      }

      return {
        windowSizeSeconds: this.config.aggregationWindowSeconds,
        forecastedTasks: forecasts,
        totalEstimatedCost: Math.round(totalEstimatedCost),
        highConfidenceCount,
        lowConfidenceCount,
        underfundedCount,
        riskLevel,
        summary: `${forecasts.length} tasks forecasted: ${highConfidenceCount} high-confidence, ${lowConfidenceCount} low-confidence. ${underfundedCount} underfunded.`,
      };
    }
  }

  /**
   * Get gas price trend data
   */
  async getGasPriceTrend(): Promise<GasPriceTrend> {
    try {
      const response = await fetchWithRetry<GasPriceTrend>(
        '/metrics/gas-price-trend',
        {
          method: 'GET',
          useCache: true,
          cacheKey: 'gas-price-trend',
        }
      );

      return response;
    } catch (error) {
      // Return default trend data
      return {
        trackedSamples: 0,
        shortTermAverage: 0,
        longTermAverage: 0,
        trend: 0,
        multiplier: 1,
        shortWindowSeconds: 300,
        longWindowSeconds: 1800,
        minMultiplier: 0.85,
        maxMultiplier: 2.0,
      };
    }
  }

  /**
   * Analyze gas fees for a task with optimization recommendations
   */
  async analyzeGasFees(taskId: string): Promise<GasFeeAnalysis> {
    try {
      // Fetch forecast data
      const forecast = await this.forecastTaskGas(taskId, 0);
      const priceTrend = await this.getGasPriceTrend();
      
      // Generate optimization windows
      const optimizationWindows = this.generateOptimizationWindows(forecast, priceTrend);
      
      // Generate recommendations
      const recommendations = this.generateRecommendations(
        taskId,
        forecast,
        priceTrend,
        optimizationWindows
      );

      return {
        taskId,
        historicalData: this.historicalData.get(taskId) || [],
        statistics: forecast.stats || this.calculateStatistics(this.historicalData.get(taskId) || []),
        forecast,
        priceTrend,
        optimizationWindows,
        recommendations,
        lastUpdated: Date.now(),
      };
    } catch (error) {
      const gasFeeError = createGasFeeError(error, { taskId });
      logGasFeeError(gasFeeError);
      throw gasFeeError;
    }
  }

  /**
   * Generate optimization windows based on gas price trends
   */
  private generateOptimizationWindows(
    forecast: GasFeeForecast,
    priceTrend: GasPriceTrend
  ): ExecutionWindow[] {
    const windows: ExecutionWindow[] = [];
    const now = Date.now();
    const horizonMs = this.config.optimizationHorizonHours * 60 * 60 * 1000;
    
    // Generate hourly windows
    for (let i = 0; i < this.config.optimizationHorizonHours; i++) {
      const windowStart = now + i * 60 * 60 * 1000;
      const windowEnd = windowStart + 60 * 60 * 1000;
      
      // Estimate average gas price for this window based on trend
      const trendFactor = priceTrend.trend * (i / this.config.optimizationHorizonHours);
      const averageGasPrice = (forecast.estimatedCost || 0) * (1 + trendFactor);
      
      // Calculate confidence score based on distance from now and data availability
      const confidenceScore = Math.max(
        0,
        1 - (i / this.config.optimizationHorizonHours) * 0.5
      ) * (forecast.confidence === 'high' ? 1 : 0.5);

      windows.push({
        windowStart,
        windowEnd,
        tasksInWindow: 1,
        totalEstimatedCost: averageGasPrice,
        underfundedCount: forecast.isUnderfunded ? 1 : 0,
        averageGasPrice,
        confidenceScore,
      });
    }

    return windows;
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(
    taskId: string,
    forecast: GasFeeForecast,
    priceTrend: GasPriceTrend,
    windows: ExecutionWindow[]
  ): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];
    
    if (!forecast.estimatedCost) {
      return recommendations;
    }

    // Find the best window (lowest cost with acceptable confidence)
    const bestWindow = windows
      .filter(w => w.confidenceScore >= 0.5)
      .sort((a, b) => a.averageGasPrice - b.averageGasPrice)[0];

    if (bestWindow && bestWindow.averageGasPrice < forecast.estimatedCost) {
      const estimatedSavings = forecast.estimatedCost - bestWindow.averageGasPrice;
      const savingsPercentage = (estimatedSavings / forecast.estimatedCost) * 100;

      if (estimatedSavings >= this.config.minSavingsThreshold) {
        recommendations.push({
          taskId,
          currentExecutionTime: Date.now(),
          recommendedExecutionTime: bestWindow.windowStart,
          estimatedSavings: Math.round(estimatedSavings),
          savingsPercentage: Math.round(savingsPercentage * 100) / 100,
          confidence: bestWindow.confidenceScore,
          reason: `Gas prices expected to be ${savingsPercentage.toFixed(1)}% lower in ${Math.round((bestWindow.windowStart - Date.now()) / (60 * 60 * 1000))} hours`,
          riskLevel: bestWindow.confidenceScore >= 0.7 ? 'low' : 'medium',
        });
      }
    }

    // Add recommendation for underfunded tasks
    if (forecast.isUnderfunded && forecast.recommendedBalance) {
      recommendations.push({
        taskId,
        currentExecutionTime: Date.now(),
        recommendedExecutionTime: Date.now(),
        estimatedSavings: 0,
        savingsPercentage: 0,
        recommendedBalance: forecast.recommendedBalance,
        confidence: forecast.confidence === 'high' ? 0.9 : 0.5,
        reason: `Task is underfunded. Recommended balance: ${forecast.recommendedBalance} stroops`,
        riskLevel: 'high',
      });
    }

    return recommendations;
  }

  /**
   * Record gas fee data point
   */
  recordGasFee(taskId: string, fee: number, blockHeight?: number): void {
    if (!validateGasFeeData({ fee, timestamp: Date.now(), blockHeight })) {
      console.warn('Invalid gas fee data received:', { taskId, fee });
      return;
    }

    const sanitized = sanitizeGasFeeData({
      timestamp: Date.now(),
      fee,
      blockHeight,
    });

    if (!this.historicalData.has(taskId)) {
      this.historicalData.set(taskId, []);
    }

    const history = this.historicalData.get(taskId)!;
    history.push(sanitized as GasFeeDataPoint);

    // Keep only the most recent samples
    if (history.length > this.config.maxHistoricalSamples) {
      history.shift();
    }

    // Also add to price trend history
    this.priceTrendHistory.push(sanitized as GasFeeDataPoint);
    if (this.priceTrendHistory.length > 200) {
      this.priceTrendHistory.shift();
    }

    this.state.totalHistoricalSamples++;
    this.state.trackedTasks = this.historicalData.size;
  }

  /**
   * Estimate gas cost per execution based on historical fees and complexity.
   *
   * Uses the 30-day historical window (configurable) to derive a per-execution
   * cost estimate. Contract complexity scales the base cost via a multiplier.
   */
  estimatePerExecutionCost(
    taskId: string,
    complexityMultiplier: number = this.config.defaultComplexityMultiplier
  ): { perExecutionCost: number; confidence: 'high' | 'low'; samples: number } {
    const history = this.historicalData.get(taskId) || [];
    const windowDays = this.config.runwayHistoryWindowDays ?? DEFAULT_CONFIG.runwayHistoryWindowDays;
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const windowed = history.filter((d) => d.timestamp >= cutoff);
    const stats = this.calculateStatistics(windowed);

    if (!stats) {
      return { perExecutionCost: 0, confidence: 'low', samples: 0 };
    }

    const base = stats.p95;
    const perExecutionCost = Math.round(base * complexityMultiplier);
    const confidence = stats.count >= this.config.highConfidenceThreshold ? 'high' : 'low';

    return { perExecutionCost, confidence, samples: stats.count };
  }

  /**
   * Project gas runway for a single task given a balance, interval, and complexity.
   *
   * Returns the number of executions the balance can sustain, the runway in
   * seconds/days, and whether the task is below the alert threshold.
   */
  projectRunway(
    taskId: string,
    gasBalance: number,
    intervalSeconds: number = this.config.defaultIntervalSeconds,
    complexityMultiplier: number = this.config.defaultComplexityMultiplier
  ): GasRunwayProjection {
    const { perExecutionCost, confidence, samples } = this.estimatePerExecutionCost(
      taskId,
      complexityMultiplier
    );

    if (perExecutionCost <= 0) {
      return {
        taskId,
        gasBalance,
        intervalSeconds,
        complexityMultiplier,
        perExecutionCost: 0,
        remainingExecutions: 0,
        runwaySeconds: 0,
        runwayDays: 0,
        isBelowAlertThreshold: true,
        confidence: 'low',
        historicalSamples: samples,
      };
    }

    const remainingExecutions = Math.max(0, Math.floor(gasBalance / perExecutionCost));
    const runwaySeconds = remainingExecutions * intervalSeconds;
    const runwayDays = runwaySeconds / (24 * 60 * 60);
    const isBelowAlertThreshold = runwayDays < this.config.runwayHistoryWindowDays * this.config.runwayAlertThreshold;

    return {
      taskId,
      gasBalance,
      intervalSeconds,
      complexityMultiplier,
      perExecutionCost,
      remainingExecutions,
      runwaySeconds,
      runwayDays: Math.round(runwayDays * 100) / 100,
      isBelowAlertThreshold,
      confidence,
      historicalSamples: samples,
    };
  }

  /**
   * Project runway across multiple scenarios (e.g. 30/90/365 day targets).
   *
   * Each scenario specifies a target runway in days; the projection reports
   * the shortfall (in stroops) required to reach that runway.
   */
  projectRunwayScenarios(
    taskId: string,
    gasBalance: number,
    intervalSeconds: number = this.config.defaultIntervalSeconds,
    complexityMultiplier: number = this.config.defaultComplexityMultiplier,
    targetDays: number[] = [30, 90, 365]
  ): GasRunwayScenario[] {
    const { perExecutionCost } = this.estimatePerExecutionCost(taskId, complexityMultiplier);

    return targetDays.map((days) => {
      const executionsNeeded = Math.ceil((days * 24 * 60 * 60) / intervalSeconds);
      const requiredBalance = executionsNeeded * perExecutionCost;
      const shortfall = Math.max(0, requiredBalance - gasBalance);
      const covered = gasBalance >= requiredBalance;

      return {
        targetDays: days,
        intervalSeconds,
        complexityMultiplier,
        requiredBalance,
        currentBalance: gasBalance,
        shortfall,
        covered,
      };
    });
  }

  /**
   * Build a 1-click batch deposit plan that tops off multiple tasks.
   *
   * Each task is topped up to its recommended balance (or a target runway if
   * provided). Returns the total deposit amount and per-task breakdown.
   */
  async buildBatchDepositPlan(
    tasks: Array<{ taskId: string; gasBalance: number }>,
    targetDays?: number,
    intervalSeconds: number = this.config.defaultIntervalSeconds,
    complexityMultiplier: number = this.config.defaultComplexityMultiplier
  ): Promise<BatchDepositPlan> {
    const items = await Promise.all(
      tasks.map(async (task) => {
        let targetBalance: number;

        if (typeof targetDays === 'number' && targetDays > 0) {
          const { perExecutionCost } = this.estimatePerExecutionCost(
            task.taskId,
            complexityMultiplier
          );
          const executionsNeeded = Math.ceil((targetDays * 24 * 60 * 60) / intervalSeconds);
          targetBalance = executionsNeeded * perExecutionCost;
        } else {
          const forecast = await this.forecastTaskGas(task.taskId, task.gasBalance);
          targetBalance = forecast.recommendedBalance ?? task.gasBalance;
        }

        const depositAmount = Math.max(0, targetBalance - task.gasBalance);

        return {
          taskId: task.taskId,
          currentBalance: task.gasBalance,
          targetBalance,
          depositAmount,
        };
      })
    );

    const totalDeposit = items.reduce((sum, item) => sum + item.depositAmount, 0);
    const tasksNeedingDeposit = items.filter((item) => item.depositAmount > 0).length;

    return {
      items,
      totalDeposit,
      tasksNeedingDeposit,
      generatedAt: Date.now(),
    };
  }

  /**
   * Evaluate runway alerts for a set of tasks.
   *
   * Returns alerts for tasks whose runway has dropped below the configured
   * threshold (default 10%). These alerts are intended to drive email/push
   * notifications.
   */
  evaluateRunwayAlerts(
    tasks: Array<{
      taskId: string;
      gasBalance: number;
      intervalSeconds?: number;
      complexityMultiplier?: number;
    }>
  ): GasRunwayAlert[] {
    const alerts: GasRunwayAlert[] = [];

    for (const task of tasks) {
      const projection = this.projectRunway(
        task.taskId,
        task.gasBalance,
        task.intervalSeconds ?? this.config.defaultIntervalSeconds,
        task.complexityMultiplier ?? this.config.defaultComplexityMultiplier
      );

      if (projection.isBelowAlertThreshold) {
        alerts.push({
          taskId: task.taskId,
          runwayDays: projection.runwayDays,
          thresholdDays: this.config.runwayHistoryWindowDays * this.config.runwayAlertThreshold,
          remainingExecutions: projection.remainingExecutions,
          perExecutionCost: projection.perExecutionCost,
          severity: projection.runwayDays <= 0 ? 'critical' : 'warning',
          triggeredAt: Date.now(),
        });
      }
    }

    return alerts;
  }

  /**
   * Get current engine state
   */
  getState(): GasFeeEngineState {
    return { ...this.state };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    dataCache.clear();
  }

  /**
   * Reset engine state
   */
  reset(): void {
    this.historicalData.clear();
    this.priceTrendHistory = [];
    this.state = {
      isInitialized: false,
      isLoading: false,
      error: null,
      lastSyncTime: null,
      trackedTasks: 0,
      totalHistoricalSamples: 0,
      config: this.config,
    };
  }
}

/**
 * Singleton instance of the gas fee engine
 */
let gasFeeEngineInstance: GasFeeEngine | null = null;

/**
 * Get or create the gas fee engine instance
 */
export function getGasFeeEngine(config?: Partial<GasFeeEngineConfig>): GasFeeEngine {
  if (!gasFeeEngineInstance) {
    gasFeeEngineInstance = new GasFeeEngine(config);
  }
  return gasFeeEngineInstance;
}

/**
 * Reset the gas fee engine instance (useful for testing)
 */
export function resetGasFeeEngine(): void {
  if (gasFeeEngineInstance) {
    gasFeeEngineInstance.reset();
    gasFeeEngineInstance = null;
  }
}