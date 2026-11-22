import { create } from "zustand";
import { calculateYieldForecast, YieldConfig, YieldProjectionPoint } from "../lib/yield/calculator";
import {
  breakEvenFeePerExecution,
  findOptimalInterval,
  type OptimizationResult,
} from "../lib/yield/optimizer";

interface YieldStoreState {
  // Inputs
  principal: number;
  apr: number;
  frequency: "daily" | "weekly" | "monthly" | "annually";
  durationYears: number;
  gasFeePerTx: number;
  keeperFeePerTx: number;
  multiplier: number;

  // Outputs
  projections: YieldProjectionPoint[];
  finalSimple: number;
  finalCompound: number;
  finalNetCompound: number;
  totalFeesPaid: number;
  depleted: boolean;
  warnings: string[];

  // Optimization (Issue #1249)
  /** Every candidate interval evaluated, best net outcome first. */
  optimization: OptimizationResult | null;
  /** Fee per execution at which the current schedule stops being worth it. */
  breakEvenFee: number;

  // Actions
  setInputs: (inputs: Partial<YieldConfig>) => void;
  runForecast: () => void;
  /** Adopt the interval the optimizer identified as best. */
  applyOptimalInterval: () => void;
  reset: () => void;
}

const defaultInputs: YieldConfig = {
  principal: 1000,
  apr: 15,
  frequency: "monthly",
  durationYears: 2,
  gasFeePerTx: 0.1,
  keeperFeePerTx: 0.5,
  multiplier: 1.0,
};

export const useYieldStore = create<YieldStoreState>((set, get) => ({
  ...defaultInputs,
  projections: [],
  finalSimple: 0,
  finalCompound: 0,
  finalNetCompound: 0,
  totalFeesPaid: 0,
  depleted: false,
  warnings: [],
  optimization: null,
  breakEvenFee: 0,

  setInputs: (newInputs) => {
    set((state) => ({ ...state, ...newInputs }));
    get().runForecast();
  },

  runForecast: () => {
    const {
      principal,
      apr,
      frequency,
      durationYears,
      gasFeePerTx,
      keeperFeePerTx,
      multiplier,
    } = get();

    const config = {
      principal,
      apr,
      frequency,
      durationYears,
      gasFeePerTx,
      keeperFeePerTx,
      multiplier,
    };

    const result = calculateYieldForecast(config);

    // Run in the same pass as the forecast: the optimizer evaluates the same
    // four candidates the user could pick, so computing it separately would
    // let the two disagree after an input change.
    const optimization = findOptimalInterval(config);

    set({
      projections: result.projections,
      finalSimple: result.finalSimple,
      finalCompound: result.finalCompound,
      finalNetCompound: result.finalNetCompound,
      totalFeesPaid: result.totalFeesPaid,
      depleted: result.depleted,
      warnings: result.warnings,
      optimization,
      breakEvenFee: breakEvenFeePerExecution(config, frequency),
    });
  },

  applyOptimalInterval: () => {
    const optimal = get().optimization?.optimal;
    if (!optimal) return;
    get().setInputs({ frequency: optimal.frequency });
  },

  reset: () => {
    set({
      ...defaultInputs,
      projections: [],
      finalSimple: 0,
      finalCompound: 0,
      finalNetCompound: 0,
      totalFeesPaid: 0,
      depleted: false,
      warnings: [],
      optimization: null,
      breakEvenFee: 0,
    });
    get().runForecast();
  },
}));
