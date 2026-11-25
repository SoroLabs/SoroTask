export interface YieldConfig {
  principal: number;
  apr: number; // as a percentage (e.g. 12 for 12%)
  frequency: "daily" | "weekly" | "monthly" | "annually";
  durationYears: number;
  gasFeePerTx: number; // XLM or USD gas cost per compound action
  keeperFeePerTx: number; // fee paid to keeper per action
  multiplier: number; // Congestion multiplier (e.g. 1.0)
}

export interface YieldProjectionPoint {
  period: number; // fraction of year or period number
  label: string;
  simpleVal: number;
  compoundVal: number;
  netCompoundVal: number;
}

export interface YieldForecastResult {
  projections: YieldProjectionPoint[];
  finalSimple: number;
  finalCompound: number;
  finalNetCompound: number;
  totalFeesPaid: number;
  depleted: boolean;
  warnings: string[];
}

const FREQUENCY_MAP = {
  daily: 365,
  weekly: 52,
  monthly: 12,
  annually: 1,
};

/**
 * Calculates interest projections based on configuration inputs.
 * Accounts for compounding frequency and fee deductions per action.
 */
export function calculateYieldForecast(config: YieldConfig): YieldForecastResult {
  const warnings: string[] = [];
  const principal = Math.max(0, config.principal);
  const aprDec = Math.max(0, config.apr) / 100;
  const duration = Math.max(0.1, config.durationYears);
  const freq = FREQUENCY_MAP[config.frequency] || 1;
  const gasFee = Math.max(0, config.gasFeePerTx);
  const keeperFee = Math.max(0, config.keeperFeePerTx);
  const multiplier = Math.max(0.5, config.multiplier);

  const compoundCost = (gasFee * multiplier) + keeperFee;
  const totalPeriods = Math.ceil(freq * duration);

  const projections: YieldProjectionPoint[] = [];
  
  let currentCompound = principal;
  let currentNetCompound = principal;
  let totalFeesPaid = 0;
  let depleted = false;

  const ratePerPeriod = aprDec / freq;

  // Add initial period 0 point
  projections.push({
    period: 0,
    label: "Start",
    simpleVal: principal,
    compoundVal: principal,
    netCompoundVal: principal,
  });

  for (let i = 1; i <= totalPeriods; i++) {
    // 1. Simple Interest growth (no compounding, no intermediate actions/fees)
    const simpleVal = principal + principal * aprDec * (i / freq);

    // 2. Standard Compounding (no fees)
    currentCompound = currentCompound * (1 + ratePerPeriod);

    // 3. Net Compounding (subtracting execution costs at each step)
    if (!depleted) {
      const grossYield = currentNetCompound * ratePerPeriod;
      const stepNet = currentNetCompound + grossYield - compoundCost;
      
      if (stepNet <= 0) {
        currentNetCompound = 0;
        depleted = true;
        warnings.push(`Principal depleted by compounding fees at step ${i} of ${totalPeriods}`);
      } else {
        currentNetCompound = stepNet;
      }
      totalFeesPaid += compoundCost;
    } else {
      currentNetCompound = 0;
    }

    // Capture milestones (reduce chart plot points for long forecasts to keep SVG lightweight)
    const shouldAddPoint = 
      totalPeriods <= 24 || 
      i === totalPeriods || 
      i % Math.ceil(totalPeriods / 12) === 0;

    if (shouldAddPoint) {
      const yearFraction = i / freq;
      let label = `${i} ${config.frequency.replace("ly", "s")}`;
      if (yearFraction >= 1) {
        label = `Yr ${yearFraction.toFixed(1)}`;
      }

      projections.push({
        period: yearFraction,
        label,
        simpleVal: parseFloat(simpleVal.toFixed(2)),
        compoundVal: parseFloat(currentCompound.toFixed(2)),
        netCompoundVal: parseFloat(currentNetCompound.toFixed(2)),
      });
    }
  }

  // Double check if Net Compounding underperformed simple yield due to fees
  if (currentNetCompound < simpleValAtEnd(principal, aprDec, duration) && currentNetCompound > 0) {
    warnings.push("High gas or keeper fees are eroding compounding yield. Simple interest yields higher net returns.");
  }

  return {
    projections,
    finalSimple: parseFloat(simpleValAtEnd(principal, aprDec, duration).toFixed(2)),
    finalCompound: parseFloat(currentCompound.toFixed(2)),
    finalNetCompound: parseFloat(currentNetCompound.toFixed(2)),
    totalFeesPaid: parseFloat(totalFeesPaid.toFixed(2)),
    depleted,
    warnings,
  };
}

function simpleValAtEnd(principal: number, aprDec: number, years: number): number {
  return principal + principal * aprDec * years;
}
