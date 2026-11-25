/**
 * React Hook for Gas Fee Engine
 * 
 * Provides React integration for the gas fee estimation and optimization engine.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  GasFeeAnalysis,
  GasFeeForecast,
  MultiTaskForecast,
  GasPriceTrend,
  GasFeeEngineState,
  GasFeeEngineConfig,
  GasFeeError,
} from '@/types/gas';
import {
  getGasFeeEngine,
  resetGasFeeEngine,
} from '@/lib/gas/service';
import {
  getGasFeeErrorMessage,
} from '@/lib/gas/errors';

/**
 * Hook return type
 */
interface UseGasFeeEngineReturn {
  // State
  state: GasFeeEngineState;
  analysis: GasFeeAnalysis | null;
  forecast: GasFeeForecast | null;
  multiTaskForecast: MultiTaskForecast | null;
  priceTrend: GasPriceTrend | null;
  error: string | null;
  
  // Actions
  initialize: () => Promise<void>;
  analyzeTask: (taskId: string) => Promise<GasFeeAnalysis>;
  forecastTask: (taskId: string, gasBalance: number) => Promise<GasFeeForecast>;
  forecastMultiple: (tasks: Array<{ taskId: string; gasBalance: number }>) => Promise<MultiTaskForecast>;
  getPriceTrend: () => Promise<GasPriceTrend>;
  recordGasFee: (taskId: string, fee: number, blockHeight?: number) => void;
  reset: () => void;
  
  // Computed
  isInitialized: boolean;
  isLoading: boolean;
  hasError: boolean;
}

/**
 * React hook for gas fee engine
 */
export function useGasFeeEngine(config?: Partial<GasFeeEngineConfig>): UseGasFeeEngineReturn {
  const engineRef = useRef(getGasFeeEngine(config));
  const [state, setState] = useState<GasFeeEngineState>(engineRef.current.getState());
  const [analysis, setAnalysis] = useState<GasFeeAnalysis | null>(null);
  const [forecast, setForecast] = useState<GasFeeForecast | null>(null);
  const [multiTaskForecast, setMultiTaskForecast] = useState<MultiTaskForecast | null>(null);
  const [priceTrend, setPriceTrend] = useState<GasPriceTrend | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Update engine config if provided
  useEffect(() => {
    engineRef.current = getGasFeeEngine(config);
    setState(engineRef.current.getState());
  }, [config]);

  /**
   * Initialize the gas fee engine
   */
  const initialize = useCallback(async () => {
    try {
      setError(null);
      await engineRef.current.initialize();
      setState(engineRef.current.getState());
    } catch (err) {
      const gasFeeError = err as GasFeeError;
      setError(getGasFeeErrorMessage(gasFeeError));
      setState(engineRef.current.getState());
      throw err;
    }
  }, []);

  /**
   * Analyze gas fees for a task
   */
  const analyzeTask = useCallback(async (taskId: string): Promise<GasFeeAnalysis> => {
    try {
      setError(null);
      const result = await engineRef.current.analyzeGasFees(taskId);
      setAnalysis(result);
      return result;
    } catch (err) {
      const gasFeeError = err as GasFeeError;
      setError(getGasFeeErrorMessage(gasFeeError));
      throw err;
    }
  }, []);

  /**
   * Forecast gas fees for a single task
   */
  const forecastTask = useCallback(async (
    taskId: string,
    gasBalance: number
  ): Promise<GasFeeForecast> => {
    try {
      setError(null);
      const result = await engineRef.current.forecastTaskGas(taskId, gasBalance);
      setForecast(result);
      return result;
    } catch (err) {
      const gasFeeError = err as GasFeeError;
      setError(getGasFeeErrorMessage(gasFeeError));
      throw err;
    }
  }, []);

  /**
   * Forecast gas fees for multiple tasks
   */
  const forecastMultiple = useCallback(async (
    tasks: Array<{ taskId: string; gasBalance: number }>
  ): Promise<MultiTaskForecast> => {
    try {
      setError(null);
      const result = await engineRef.current.forecastMultipleTasks(tasks);
      setMultiTaskForecast(result);
      return result;
    } catch (err) {
      const gasFeeError = err as GasFeeError;
      setError(getGasFeeErrorMessage(gasFeeError));
      throw err;
    }
  }, []);

  /**
   * Get gas price trend
   */
  const getPriceTrend = useCallback(async (): Promise<GasPriceTrend> => {
    try {
      setError(null);
      const result = await engineRef.current.getGasPriceTrend();
      setPriceTrend(result);
      return result;
    } catch (err) {
      const gasFeeError = err as GasFeeError;
      setError(getGasFeeErrorMessage(gasFeeError));
      throw err;
    }
  }, []);

  /**
   * Record gas fee data point
   */
  const recordGasFee = useCallback((taskId: string, fee: number, blockHeight?: number) => {
    engineRef.current.recordGasFee(taskId, fee, blockHeight);
    setState(engineRef.current.getState());
  }, []);

  /**
   * Reset the engine
   */
  const reset = useCallback(() => {
    engineRef.current.reset();
    resetGasFeeEngine();
    setAnalysis(null);
    setForecast(null);
    setMultiTaskForecast(null);
    setPriceTrend(null);
    setError(null);
    setState(engineRef.current.getState());
  }, []);

  return {
    state,
    analysis,
    forecast,
    multiTaskForecast,
    priceTrend,
    error,
    initialize,
    analyzeTask,
    forecastTask,
    forecastMultiple,
    getPriceTrend,
    recordGasFee,
    reset,
    isInitialized: state.isInitialized,
    isLoading: state.isLoading,
    hasError: error !== null,
  };
}

/**
 * Hook for single task gas fee analysis
 */
export function useTaskGasAnalysis(taskId: string | null, gasBalance?: number) {
  const { forecastTask, forecast, error, isLoading } = useGasFeeEngine();
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    if (taskId && gasBalance !== undefined) {
      setIsAnalyzing(true);
      forecastTask(taskId, gasBalance)
        .finally(() => setIsAnalyzing(false));
    }
  }, [taskId, gasBalance, forecastTask]);

  return {
    forecast,
    error,
    isLoading: isLoading || isAnalyzing,
  };
}

/**
 * Hook for gas price trend monitoring
 */
export function useGasPriceTrend(refreshInterval: number = 60000) {
  const { getPriceTrend, priceTrend, error, isLoading } = useGasFeeEngine();

  useEffect(() => {
    const loadTrend = () => {
      getPriceTrend().catch(console.error);
    };

    loadTrend();
    const interval = setInterval(loadTrend, refreshInterval);

    return () => clearInterval(interval);
  }, [getPriceTrend, refreshInterval]);

  return {
    priceTrend,
    error,
    isLoading,
    refresh: getPriceTrend,
  };
}
