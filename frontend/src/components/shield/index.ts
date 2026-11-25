/**
 * Public surface for the Rate Limiting & Anti-DDoS Frontend Shield.
 */

export { ShieldDashboard, default } from './ShieldDashboard';
export type { ShieldDashboardProps } from './ShieldDashboard';
export { ThreatLevelGauge } from './ThreatLevelGauge';
export { ShieldMetrics } from './ShieldMetrics';
export { TopOffendersTable } from './TopOffendersTable';
export { AnomalyList } from './AnomalyList';
export { getThreatMeta } from './threatMeta';

export { useShield } from '@/src/hooks/useShield';
export type { UseShieldOptions, UseShieldResult } from '@/src/hooks/useShield';
export { ShieldEngine, normalizeConfig } from '@/src/lib/shield/engine';
export { createShieldBridge, workersSupported } from '@/src/lib/shield/bridge';
export * from '@/src/lib/shield/types';
