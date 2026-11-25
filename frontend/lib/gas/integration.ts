/**
 * Gas Fee Engine Integration with Keeper Service
 * 
 * Integration layer that connects the gas fee estimation engine
 * with the existing keeper service for seamless data flow.
 */

import { getGasFeeEngine } from './service';
import { keeperService } from '../keeper/service';
import type { Keeper } from '@/types/keeper';
import type { GasFeeForecast, MultiTaskForecast } from '@/types/gas';

/**
 * Integration configuration
 */
interface IntegrationConfig {
  autoSync: boolean;
  syncInterval: number; // milliseconds
  enableRealtimeUpdates: boolean;
}

/**
 * Gas Fee Engine Integration
 * 
 * Manages the integration between gas fee engine and keeper service
 */
export class GasFeeIntegration {
  private config: IntegrationConfig;
  private syncIntervalId: ReturnType<typeof setInterval> | null = null;
  private gasEngine = getGasFeeEngine();

  constructor(config: Partial<IntegrationConfig> = {}) {
    this.config = {
      autoSync: config.autoSync ?? true,
      syncInterval: config.syncInterval ?? 60000, // 1 minute
      enableRealtimeUpdates: config.enableRealtimeUpdates ?? true,
    };
  }

  /**
   * Initialize the integration
   */
  async initialize(): Promise<void> {
    try {
      // Initialize gas fee engine
      await this.gasEngine.initialize();

      // Start auto-sync if enabled
      if (this.config.autoSync) {
        this.startAutoSync();
      }

      console.log('[Gas Fee Integration] Initialized successfully');
    } catch (error) {
      console.error('[Gas Fee Integration] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Start automatic synchronization
   */
  private startAutoSync(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
    }

    this.syncIntervalId = setInterval(() => {
      this.syncKeeperData().catch(console.error);
    }, this.config.syncInterval);

    console.log(
      `[Gas Fee Integration] Auto-sync started (interval: ${this.config.syncInterval}ms)`
    );
  }

  /**
   * Stop automatic synchronization
   */
  stopAutoSync(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
      console.log('[Gas Fee Integration] Auto-sync stopped');
    }
  }

  /**
   * Sync data from keeper service
   */
  private async syncKeeperData(): Promise<void> {
    try {
      // Fetch keeper metrics including gas data
      const keeperStats = await keeperService.fetchKeeperStats();
      
      // Update gas engine state
      const state = this.gasEngine.getState();
      console.log('[Gas Fee Integration] Synced keeper data:', {
        trackedTasks: state.trackedTasks,
        totalSamples: state.totalHistoricalSamples,
      });
    } catch (error) {
      console.error('[Gas Fee Integration] Sync failed:', error);
    }
  }

  /**
   * Get gas fee forecast for a specific task
   */
  async getTaskGasForecast(taskId: string, gasBalance: number): Promise<GasFeeForecast> {
    try {
      return await this.gasEngine.forecastTaskGas(taskId, gasBalance);
    } catch (error) {
      console.error('[Gas Fee Integration] Failed to get task forecast:', error);
      throw error;
    }
  }

  /**
   * Get gas fee forecasts for multiple tasks
   */
  async getMultiTaskForecasts(
    tasks: Array<{ taskId: string; gasBalance: number }>
  ): Promise<MultiTaskForecast> {
    try {
      return await this.gasEngine.forecastMultipleTasks(tasks);
    } catch (error) {
      console.error('[Gas Fee Integration] Failed to get multi-task forecasts:', error);
      throw error;
    }
  }

  /**
   * Record gas fee from task execution
   */
  recordExecutionGas(taskId: string, feePaid: number, blockHeight?: number): void {
    try {
      this.gasEngine.recordGasFee(taskId, feePaid, blockHeight);
      console.log('[Gas Fee Integration] Recorded execution gas:', { taskId, feePaid });
    } catch (error) {
      console.error('[Gas Fee Integration] Failed to record gas fee:', error);
    }
  }

  /**
   * Get comprehensive gas analysis for a task
   */
  async analyzeTaskGas(taskId: string): Promise<Awaited<ReturnType<typeof this.gasEngine.analyzeGasFees>>> {
    try {
      return await this.gasEngine.analyzeGasFees(taskId);
    } catch (error) {
      console.error('[Gas Fee Integration] Failed to analyze task gas:', error);
      throw error;
    }
  }

  /**
   * Sync gas data from keeper executions
   */
  async syncExecutionGas(keeperId: string): Promise<void> {
    try {
      const executions = await keeperService.fetchKeeperExecutions(keeperId, 100);
      
      executions.forEach((execution) => {
        if (execution.gasUsed && execution.taskId) {
          this.recordExecutionGas(
            execution.taskId,
            execution.gasUsed
          );
        }
      });

      console.log(
        `[Gas Fee Integration] Synced ${executions.length} executions for keeper ${keeperId}`
      );
    } catch (error) {
      console.error('[Gas Fee Integration] Failed to sync execution gas:', error);
    }
  }

  /**
   * Get integration status
   */
  getStatus() {
    return {
      isInitialized: this.gasEngine.getState().isInitialized,
      isAutoSyncEnabled: this.syncIntervalId !== null,
      syncInterval: this.config.syncInterval,
      engineState: this.gasEngine.getState(),
    };
  }

  /**
   * Cleanup and destroy integration
   */
  destroy(): void {
    this.stopAutoSync();
    this.gasEngine.reset();
    console.log('[Gas Fee Integration] Destroyed');
  }
}

/**
 * Singleton instance
 */
let integrationInstance: GasFeeIntegration | null = null;

/**
 * Get or create the gas fee integration instance
 */
export function getGasFeeIntegration(
  config?: Partial<IntegrationConfig>
): GasFeeIntegration {
  if (!integrationInstance) {
    integrationInstance = new GasFeeIntegration(config);
  }
  return integrationInstance;
}

/**
 * Reset the integration instance (useful for testing)
 */
export function resetGasFeeIntegration(): void {
  if (integrationInstance) {
    integrationInstance.destroy();
    integrationInstance = null;
  }
}
