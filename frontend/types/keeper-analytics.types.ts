export interface PerformanceMetric {
  date: string;
  earnedXlm: number;
  gasSpentXlm: number;
  netProfitXlm: number;
  executions: number;
}

export interface StatusDistribution {
  name: string;
  value: number;
  color: string;
}

export interface AnalyticsSummary {
  totalEarnedXlm: number;
  totalGasSpentXlm: number;
  netProfitXlm: number;
  profitMarginPercent: number;
  totalExecutions: number;
  successRatePercent: number;
}