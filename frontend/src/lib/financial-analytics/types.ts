export interface GasFeeCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeXlm?: number;
  batchSavingsXlm?: number;
  depth?: LiquidityDepthLevel[];
}

export interface LiquidityDepthLevel {
  priceXlm: number;
  cumulativeVolumeXlm: number;
}

export interface YieldHistoryPoint {
  timestamp: string;
  apyPercent: number;
  accruedYieldXlm?: number;
}

export type FinancialSeriesKind = "gas" | "yield";
export type FinancialRecord = GasFeeCandle | YieldHistoryPoint;

export type AnalyticsConnectionStatus =
  | "loading"
  | "connected"
  | "disconnected"
  | "error";
