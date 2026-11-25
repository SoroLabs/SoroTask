/**
 * Gas Fee Optimization Algorithm
 * 
 * Advanced optimization algorithms for finding optimal execution windows
 * based on historical gas price patterns and trends.
 */

import {
  GasFeeDataPoint,
  GasFeeStatistics,
  GasFeeForecast,
  ExecutionWindow,
  GasPriceTrend,
  OptimizationRecommendation,
  GasFeeEngineConfig,
} from '@/types/gas';

/**
 * Optimization result with confidence scoring
 */
export interface OptimizationResult {
  windows: ExecutionWindow[];
  bestWindow: ExecutionWindow | null;
  totalSavings: number;
  averageSavingsPercentage: number;
  confidence: number;
}

/**
 * Pattern detection result
 */
export interface PatternDetection {
  hasPattern: boolean;
  patternType: 'daily' | 'weekly' | 'none';
  peakHours: number[];
  lowHours: number[];
  confidence: number;
}

/**
 * Gas Fee Optimizer
 * 
 * Advanced optimization engine for execution window selection
 */
export class GasFeeOptimizer {
  private config: GasFeeEngineConfig;

  constructor(config: GasFeeEngineConfig) {
    this.config = config;
  }

  /**
   * Detect temporal patterns in gas fee data
   */
  detectPatterns(data: GasFeeDataPoint[]): PatternDetection {
    if (data.length < 24) {
      return {
        hasPattern: false,
        patternType: 'none',
        peakHours: [],
        lowHours: [],
        confidence: 0,
      };
    }

    // Group by hour of day
    const hourlyData = new Map<number, number[]>();
    
    data.forEach(point => {
      const hour = new Date(point.timestamp).getHours();
      if (!hourlyData.has(hour)) {
        hourlyData.set(hour, []);
      }
      hourlyData.get(hour)!.push(point.fee);
    });

    // Calculate average fee per hour
    const hourlyAverages = Array.from(hourlyData.entries()).map(([hour, fees]) => ({
      hour,
      average: fees.reduce((sum, fee) => sum + fee, 0) / fees.length,
    }));

    // Find peak and low hours
    const sortedByFee = [...hourlyAverages].sort((a, b) => b.average - a.average);
    const threshold = sortedByFee[0].average * 0.8;

    const minFee = sortedByFee[sortedByFee.length - 1].average;
    const maxFee = sortedByFee[0].average;
    const midFee = (maxFee + minFee) / 2;

    const peakHours = sortedByFee
      .filter(h => h.average >= threshold)
      .map(h => h.hour);

    const lowHours = sortedByFee
      .filter(h => h.average <= midFee)
      .map(h => h.hour);

    // Determine pattern type
    const hasPattern = peakHours.length > 0 && lowHours.length > 0;
    const confidence = Math.min(1, data.length / 100);

    return {
      hasPattern,
      patternType: hasPattern ? 'daily' : 'none',
      peakHours,
      lowHours,
      confidence,
    };
  }

  /**
   * Generate optimized execution windows with pattern awareness
   */
  generateOptimizedWindows(
    forecast: GasFeeForecast,
    priceTrend: GasPriceTrend,
    historicalData: GasFeeDataPoint[]
  ): OptimizationResult {
    const patterns = this.detectPatterns(historicalData);
    const windows = this.generateWindows(forecast, priceTrend, patterns);
    
    const bestWindow = this.findBestWindow(windows);
    const totalSavings = this.calculateTotalSavings(windows, forecast);
    const averageSavingsPercentage = this.calculateAverageSavingsPercentage(
      windows,
      forecast
    );

    return {
      windows,
      bestWindow,
      totalSavings,
      averageSavingsPercentage,
      confidence: this.calculateOverallConfidence(windows, patterns),
    };
  }

  /**
   * Generate execution windows considering patterns
   */
  private generateWindows(
    forecast: GasFeeForecast,
    priceTrend: GasPriceTrend,
    patterns: PatternDetection
  ): ExecutionWindow[] {
    const windows: ExecutionWindow[] = [];
    const now = Date.now();
    const horizonMs = this.config.optimizationHorizonHours * 60 * 60 * 1000;
    
    // Generate hourly windows
    for (let i = 0; i < this.config.optimizationHorizonHours; i++) {
      const windowStart = now + i * 60 * 60 * 1000;
      const windowEnd = windowStart + 60 * 60 * 1000;
      const hour = new Date(windowStart).getHours();

      // Base cost from forecast
      const baseCost = forecast.estimatedCost || 0;
      
      // Apply trend adjustment
      const trendFactor = priceTrend.trend * (i / this.config.optimizationHorizonHours);
      
      // Apply pattern adjustment if detected
      let patternFactor = 0;
      if (patterns.hasPattern) {
        if (patterns.lowHours.includes(hour)) {
          patternFactor = -0.15 * patterns.confidence; // 15% reduction during low hours
        } else if (patterns.peakHours.includes(hour)) {
          patternFactor = 0.1 * patterns.confidence; // 10% increase during peak hours
        }
      }

      const averageGasPrice = baseCost * (1 + trendFactor + patternFactor);
      
      // Calculate confidence score
      const baseConfidence = Math.max(
        0,
        1 - (i / this.config.optimizationHorizonHours) * 0.5
      );
      const forecastConfidence = forecast.confidence === 'high' ? 1 : 0.5;
      const patternConfidence = patterns.confidence;
      
      const confidenceScore = baseConfidence * forecastConfidence * (1 + patternConfidence * 0.3);

      windows.push({
        windowStart,
        windowEnd,
        tasksInWindow: 1,
        totalEstimatedCost: Math.max(0, averageGasPrice),
        underfundedCount: forecast.isUnderfunded ? 1 : 0,
        averageGasPrice: Math.max(0, averageGasPrice),
        confidenceScore: Math.min(1, confidenceScore),
      });
    }

    return windows;
  }

  /**
   * Find the best execution window
   */
  private findBestWindow(windows: ExecutionWindow[]): ExecutionWindow | null {
    const eligibleWindows = windows.filter(w => w.confidenceScore >= 0.5);
    
    if (eligibleWindows.length === 0) {
      return null;
    }

    // Sort by cost (ascending) and confidence (descending)
    return eligibleWindows.sort((a, b) => {
      const costDiff = a.averageGasPrice - b.averageGasPrice;
      if (Math.abs(costDiff) < 10) {
        // If costs are similar, prefer higher confidence
        return b.confidenceScore - a.confidenceScore;
      }
      return costDiff;
    })[0];
  }

  /**
   * Calculate total potential savings
   */
  private calculateTotalSavings(
    windows: ExecutionWindow[],
    forecast: GasFeeForecast
  ): number {
    const baseCost = forecast.estimatedCost || 0;
    if (baseCost === 0) return 0;

    const savings = windows
      .filter(w => w.averageGasPrice < baseCost)
      .reduce((sum, w) => sum + (baseCost - w.averageGasPrice), 0);

    return Math.round(savings);
  }

  /**
   * Calculate average savings percentage
   */
  private calculateAverageSavingsPercentage(
    windows: ExecutionWindow[],
    forecast: GasFeeForecast
  ): number {
    const baseCost = forecast.estimatedCost || 0;
    if (baseCost === 0) return 0;

    const savingsWindows = windows.filter(w => w.averageGasPrice < baseCost);
    
    if (savingsWindows.length === 0) return 0;

    const avgSavings = savingsWindows.reduce(
      (sum, w) => sum + (baseCost - w.averageGasPrice),
      0
    ) / savingsWindows.length;

    return Math.round((avgSavings / baseCost) * 10000) / 100;
  }

  /**
   * Calculate overall confidence score
   */
  private calculateOverallConfidence(
    windows: ExecutionWindow[],
    patterns: PatternDetection
  ): number {
    if (windows.length === 0) return 0;

    const avgWindowConfidence =
      windows.reduce((sum, w) => sum + w.confidenceScore, 0) / windows.length;

    // Combine window confidence with pattern confidence
    return Math.min(1, avgWindowConfidence * (1 + patterns.confidence * 0.2));
  }

  /**
   * Generate optimization recommendations with detailed analysis
   */
  generateRecommendations(
    taskId: string,
    forecast: GasFeeForecast,
    priceTrend: GasPriceTrend,
    historicalData: GasFeeDataPoint[],
    optimizationResult: OptimizationResult
  ): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];

    // Best window recommendation
    if (optimizationResult.bestWindow) {
      const estimatedSavings = (forecast.estimatedCost || 0) - optimizationResult.bestWindow.averageGasPrice;
      const savingsPercentage = (estimatedSavings / (forecast.estimatedCost || 1)) * 100;

      if (estimatedSavings >= this.config.minSavingsThreshold) {
        recommendations.push({
          taskId,
          currentExecutionTime: Date.now(),
          recommendedExecutionTime: optimizationResult.bestWindow.windowStart,
          estimatedSavings: Math.round(estimatedSavings),
          savingsPercentage: Math.round(savingsPercentage * 100) / 100,
          confidence: optimizationResult.bestWindow.confidenceScore,
          reason: this.buildRecommendationReason(
            'timing',
            estimatedSavings,
            savingsPercentage,
            optimizationResult.bestWindow.windowStart
          ),
          riskLevel: this.assessRiskLevel(
            optimizationResult.bestWindow.confidenceScore,
            priceTrend.trend
          ),
        });
      }
    }

    // Underfunded task recommendation
    if (forecast.isUnderfunded && forecast.recommendedBalance) {
      recommendations.push({
        taskId,
        currentExecutionTime: Date.now(),
        recommendedExecutionTime: Date.now(),
        estimatedSavings: 0,
        savingsPercentage: 0,
        recommendedBalance: forecast.recommendedBalance,
        confidence: forecast.confidence === 'high' ? 0.9 : 0.5,
        reason: `Task is underfunded. Current balance insufficient for reliable execution. Recommended: ${forecast.recommendedBalance} stroops`,
        riskLevel: 'high',
      });
    }

    // High gas price warning
    if (priceTrend.multiplier > 1.3) {
      recommendations.push({
        taskId,
        currentExecutionTime: Date.now(),
        recommendedExecutionTime: Date.now() + 2 * 60 * 60 * 1000, // 2 hours later
        estimatedSavings: 0,
        savingsPercentage: 0,
        confidence: 0.6,
        reason: `Gas prices are currently elevated (${(priceTrend.multiplier * 100).toFixed(0)}% of normal). Consider delaying execution if not time-critical.`,
        riskLevel: 'medium',
      });
    }

    return recommendations;
  }

  /**
   * Build recommendation reason text
   */
  private buildRecommendationReason(
    type: 'timing' | 'funding' | 'warning',
    savings: number,
    percentage: number,
    recommendedTime: number
  ): string {
    if (type === 'timing') {
      const hoursUntil = Math.round((recommendedTime - Date.now()) / (60 * 60 * 1000));
      return `Execute in ${hoursUntil} hours to save ${percentage.toFixed(1)}% on gas fees (${savings} stroops)`;
    }
    return 'Optimization recommendation';
  }

  /**
   * Assess risk level for a recommendation
   */
  private assessRiskLevel(confidence: number, trend: number): 'low' | 'medium' | 'high' {
    if (confidence >= 0.8 && Math.abs(trend) < 0.2) {
      return 'low';
    } else if (confidence >= 0.5) {
      return 'medium';
    }
    return 'high';
  }

  /**
   * Calculate optimal batch execution schedule
   */
  optimizeBatchExecution(
    tasks: Array<{ taskId: string; forecast: GasFeeForecast; deadline?: number }>
  ): Array<{
    taskId: string;
    scheduledTime: number;
    estimatedCost: number;
  }> {
    const schedule: Array<{
      taskId: string;
      scheduledTime: number;
      estimatedCost: number;
    }> = [];

    // Sort tasks by deadline (if available) and flexibility
    const sortedTasks = [...tasks].sort((a, b) => {
      if (a.deadline && b.deadline) {
        return a.deadline - b.deadline;
      }
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return 0;
    });

    const now = Date.now();
    let currentTime = now;

    sortedTasks.forEach(task => {
      const forecast = task.forecast;
      const deadline = task.deadline || now + 24 * 60 * 60 * 1000;

      // Find best window before deadline
      const horizon = Math.min(
        this.config.optimizationHorizonHours,
        (deadline - now) / (60 * 60 * 1000)
      );

      // Simple heuristic: schedule at regular intervals
      const scheduledTime = Math.min(currentTime, deadline - 60 * 60 * 1000);
      
      schedule.push({
        taskId: task.taskId,
        scheduledTime,
        estimatedCost: forecast.estimatedCost || 0,
      });

      currentTime += 30 * 60 * 1000; // 30 minutes between tasks
    });

    return schedule;
  }
}
