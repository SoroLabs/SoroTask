/**
 * Public surface for the Keeper Profitability Scatter Plot feature.
 */

export {
  KeeperProfitabilityChart,
  default,
} from './KeeperProfitabilityChart';
export type { KeeperProfitabilityChartProps } from './KeeperProfitabilityChart';
export { ScatterPlot } from './ScatterPlot';
export { ProfitabilityLegend } from './ProfitabilityLegend';
export { ConnectionStatusBanner } from './ConnectionStatusBanner';
export { getTierStyle, getStatusStyle, TIER_ORDER } from './profitabilityStyles';

export {
  useKeeperProfitability,
} from '@/src/hooks/useKeeperProfitability';
export type {
  UseKeeperProfitabilityOptions,
  UseKeeperProfitabilityResult,
} from '@/src/hooks/useKeeperProfitability';
export {
  createResilientSource,
} from '@/src/lib/keeper-profitability/resilientSource';
export {
  computePoint,
  computePoints,
  summarize,
  projectPoints,
  trendLine,
} from '@/src/lib/keeper-profitability/profitability';
export * from '@/src/lib/keeper-profitability/types';
