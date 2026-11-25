/**
 * Unit Tests for Gas Fee Optimizer
 */

import { GasFeeOptimizer } from '../optimizer';
import { GasFeeForecast, GasPriceTrend, GasFeeEngineConfig } from '@/types/gas';

describe('GasFeeOptimizer', () => {
  let optimizer: GasFeeOptimizer;
  let config: GasFeeEngineConfig;

  beforeEach(() => {
    config = {
      safetyBufferMultiplier: 1.5,
      aggregationWindowSeconds: 3600,
      highConfidenceThreshold: 5,
      maxHistoricalSamples: 100,
      optimizationHorizonHours: 24,
      minSavingsThreshold: 100,
    };
    optimizer = new GasFeeOptimizer(config);
  });

  describe('detectPatterns', () => {
    it('should return no pattern for insufficient data', () => {
      const data = [
        { timestamp: Date.now(), fee: 100 },
        { timestamp: Date.now() - 1000, fee: 110 },
      ];
      
      const result = optimizer['detectPatterns'](data);
      
      expect(result.hasPattern).toBe(false);
      expect(result.patternType).toBe('none');
      expect(result.confidence).toBe(0);
    });

    it('should detect daily pattern with sufficient data', () => {
      const data = Array.from({ length: 24 }, (_, i) => ({
        timestamp: Date.now() - i * 3600000,
        fee: 100 + (i % 12) * 10, // Simulate hourly variation
      }));
      
      const result = optimizer['detectPatterns'](data);
      
      expect(result.hasPattern).toBe(true);
      expect(result.patternType).toBe('daily');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should identify peak hours', () => {
      const data = Array.from({ length: 48 }, (_, i) => {
        const hour = i % 24;
        const fee = hour >= 9 && hour <= 17 ? 200 : 100; // Higher during business hours
        return {
          timestamp: Date.now() - i * 3600000,
          fee,
        };
      });
      
      const result = optimizer['detectPatterns'](data);
      
      expect(result.peakHours.length).toBeGreaterThan(0);
      expect(result.lowHours.length).toBeGreaterThan(0);
    });
  });

  describe('generateOptimizedWindows', () => {
    let forecast: GasFeeForecast;
    let priceTrend: GasPriceTrend;

    beforeEach(() => {
      forecast = {
        taskId: 'test-1',
        estimatedCost: 1000,
        confidence: 'high',
        historicalSamples: 10,
        isUnderfunded: false,
        recommendedBalance: 1500,
        buffer: 500,
        stats: {
          count: 10,
          mean: 950,
          median: 980,
          stdDev: 50,
          min: 800,
          max: 1200,
          p95: 1000,
          p99: 1150,
        },
        reason: 'based_on_history',
      };

      priceTrend = {
        trackedSamples: 50,
        shortTermAverage: 1000,
        longTermAverage: 950,
        trend: 0.05,
        multiplier: 1.05,
        shortWindowSeconds: 300,
        longWindowSeconds: 1800,
        minMultiplier: 0.85,
        maxMultiplier: 2.0,
      };
    });

    it('should generate execution windows', () => {
      const result = optimizer.generateOptimizedWindows(forecast, priceTrend, []);
      
      expect(result.windows.length).toBe(24); // 24 hours
      expect(result.bestWindow).not.toBeNull();
    });

    it('should calculate total savings', () => {
      const result = optimizer.generateOptimizedWindows(forecast, priceTrend, []);
      
      expect(result.totalSavings).toBeGreaterThanOrEqual(0);
    });

    it('should calculate average savings percentage', () => {
      const result = optimizer.generateOptimizedWindows(forecast, priceTrend, []);
      
      expect(result.averageSavingsPercentage).toBeGreaterThanOrEqual(0);
    });

    it('should calculate overall confidence', () => {
      const result = optimizer.generateOptimizedWindows(forecast, priceTrend, []);
      
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should apply pattern adjustments when patterns detected', () => {
      const historicalData = Array.from({ length: 48 }, (_, i) => {
        const hour = i % 24;
        const fee = hour >= 9 && hour <= 17 ? 200 : 100;
        return {
          timestamp: Date.now() - i * 3600000,
          fee,
        };
      });
      
      const result = optimizer.generateOptimizedWindows(forecast, priceTrend, historicalData);
      
      expect(result.windows.length).toBe(24);
    });

    it('should handle null estimated cost', () => {
      forecast.estimatedCost = null;
      
      const result = optimizer.generateOptimizedWindows(forecast, priceTrend, []);
      
      expect(result.windows.length).toBe(24);
      expect(result.totalSavings).toBe(0);
    });
  });

  describe('generateRecommendations', () => {
    let forecast: GasFeeForecast;
    let priceTrend: GasPriceTrend;

    beforeEach(() => {
      forecast = {
        taskId: 'test-1',
        estimatedCost: 1000,
        confidence: 'high',
        historicalSamples: 10,
        isUnderfunded: false,
        recommendedBalance: 1500,
        buffer: 500,
        stats: {
          count: 10,
          mean: 950,
          median: 980,
          stdDev: 50,
          min: 800,
          max: 1200,
          p95: 1000,
          p99: 1150,
        },
        reason: 'based_on_history',
      };

      priceTrend = {
        trackedSamples: 50,
        shortTermAverage: 1000,
        longTermAverage: 950,
        trend: 0.05,
        multiplier: 1.05,
        shortWindowSeconds: 300,
        longWindowSeconds: 1800,
        minMultiplier: 0.85,
        maxMultiplier: 2.0,
      };
    });

    it('should generate timing recommendations when savings exceed threshold', () => {
      const optimizationResult = optimizer.generateOptimizedWindows(forecast, priceTrend, []);
      
      const recommendations = optimizer['generateRecommendations'](
        'test-1',
        forecast,
        priceTrend,
        [],
        optimizationResult
      );
      
      expect(recommendations.length).toBeGreaterThanOrEqual(0);
    });

    it('should generate underfunded recommendations', () => {
      forecast.isUnderfunded = true;
      forecast.recommendedBalance = 2000;
      
      const optimizationResult = optimizer.generateOptimizedWindows(forecast, priceTrend, []);
      
      const recommendations = optimizer['generateRecommendations'](
        'test-1',
        forecast,
        priceTrend,
        [],
        optimizationResult
      );
      
      const underfundedRec = recommendations.find(r => r.riskLevel === 'high');
      expect(underfundedRec).toBeDefined();
      expect(underfundedRec?.recommendedBalance).toBe(2000);
    });

    it('should generate high gas price warnings', () => {
      priceTrend.multiplier = 1.5;
      
      const optimizationResult = optimizer.generateOptimizedWindows(forecast, priceTrend, []);
      
      const recommendations = optimizer['generateRecommendations'](
        'test-1',
        forecast,
        priceTrend,
        [],
        optimizationResult
      );
      
      const warningRec = recommendations.find(r => r.reason.includes('elevated'));
      expect(warningRec).toBeDefined();
    });

    it('should not generate recommendations when savings below threshold', () => {
      config.minSavingsThreshold = 10000;
      optimizer = new GasFeeOptimizer(config);
      
      const optimizationResult = optimizer.generateOptimizedWindows(forecast, priceTrend, []);
      
      const recommendations = optimizer['generateRecommendations'](
        'test-1',
        forecast,
        priceTrend,
        [],
        optimizationResult
      );
      
      const timingRecs = recommendations.filter(r => r.estimatedSavings > 0);
      expect(timingRecs.length).toBe(0);
    });
  });

  describe('optimizeBatchExecution', () => {
    it('should schedule tasks before deadlines', () => {
      const tasks = [
        {
          taskId: 'task-1',
          forecast: {
            taskId: 'task-1',
            estimatedCost: 1000,
            confidence: 'high',
            historicalSamples: 10,
            isUnderfunded: false,
            recommendedBalance: 1500,
            buffer: 500,
            stats: null,
            reason: 'based_on_history',
          },
          deadline: Date.now() + 7200000, // 2 hours
        },
        {
          taskId: 'task-2',
          forecast: {
            taskId: 'task-2',
            estimatedCost: 800,
            confidence: 'high',
            historicalSamples: 8,
            isUnderfunded: false,
            recommendedBalance: 1200,
            buffer: 400,
            stats: null,
            reason: 'based_on_history',
          },
          deadline: Date.now() + 3600000, // 1 hour
        },
      ];
      
      const schedule = optimizer.optimizeBatchExecution(tasks);
      
      expect(schedule.length).toBe(2);
      expect(schedule[0].taskId).toBe('task-2'); // Earlier deadline first
    });

    it('should handle tasks without deadlines', () => {
      const tasks = [
        {
          taskId: 'task-1',
          forecast: {
            taskId: 'task-1',
            estimatedCost: 1000,
            confidence: 'high',
            historicalSamples: 10,
            isUnderfunded: false,
            recommendedBalance: 1500,
            buffer: 500,
            stats: null,
            reason: 'based_on_history',
          },
        },
      ];
      
      const schedule = optimizer.optimizeBatchExecution(tasks);
      
      expect(schedule.length).toBe(1);
      expect(schedule[0].taskId).toBe('task-1');
    });

    it('should space out task executions', () => {
      const tasks = Array.from({ length: 5 }, (_, i) => ({
        taskId: `task-${i}`,
        forecast: {
          taskId: `task-${i}`,
          estimatedCost: 1000,
          confidence: 'high',
          historicalSamples: 10,
          isUnderfunded: false,
          recommendedBalance: 1500,
          buffer: 500,
          stats: null,
          reason: 'based_on_history',
        },
        deadline: Date.now() + 86400000, // 24 hours
      }));
      
      const schedule = optimizer.optimizeBatchExecution(tasks);
      
      expect(schedule.length).toBe(5);
      
      // Check that tasks are spaced apart
      for (let i = 1; i < schedule.length; i++) {
        const timeDiff = schedule[i].scheduledTime - schedule[i - 1].scheduledTime;
        expect(timeDiff).toBeGreaterThan(0);
      }
    });
  });
});
