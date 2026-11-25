/**
 * Keeper Components - Storybook Stories
 * 
 * Visual documentation and interactive examples for keeper UI components
 */

import type { Meta, StoryObj } from '@storybook/react';
import {
  KeeperHealthIndicator,
  KeeperHealthScore,
  KeeperStatusBadge,
  KeeperUptimeDisplay,
} from './KeeperHealthIndicator';
import { KeeperTable } from './KeeperTable';
import { KeeperStatsCard, KeeperQuickStats } from './KeeperStatsCard';
import { KeeperDetailModal } from './KeeperDetailModal';
import { Keeper, KeeperStatistics } from '@/types/keeper';

// Mock data
const mockKeeper: Keeper = {
  id: 'keeper-1',
  address: 'GA7QSTF47FSUJJQQ5L5TR4DIBBS5IOJ4BB4A7JLBG2W34HCHIE',
  status: 'active',
  healthScore: 95,
  executionCount: 1250,
  successRate: 99.5,
  failureRate: 0.5,
  averageGasUsed: 5000,
  region: 'us-east',
  lastHeartbeat: new Date(Date.now() - 5 * 60000).toISOString(),
  uptimePercentage: 99.9,
  totalTasks: 2000,
  failedTasks: 10,
  configuration: {
    maxConcurrentTasks: 10,
    gasLimit: 50000,
    gasPrice: '1000',
    networkTimeout: 30000,
    retryPolicy: {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 32000,
      backoffMultiplier: 2,
    },
    alertThresholds: {
      errorRateThreshold: 5,
      responseTimeThreshold: 5000,
      lowUptimeThreshold: 95,
      gasLimitWarning: 80,
    },
    enableHeartbeat: true,
    heartbeatInterval: 30,
  },
  metrics: {
    uptime: 99.9,
    responseTime: 150,
    p95ResponseTime: 250,
    p99ResponseTime: 350,
    errorRate: 0.5,
    throughput: 100,
    averageGasPerTask: 5000,
    totalGasUsed: 500000,
    lastUpdate: new Date().toISOString(),
  },
  recentExecutions: [
    {
      id: 'exec-1',
      taskId: 'task-1',
      keeperId: 'keeper-1',
      status: 'success',
      startTime: new Date(Date.now() - 10 * 60000).toISOString(),
      endTime: new Date(Date.now() - 9 * 60000).toISOString(),
      duration: 5000,
      gasUsed: 5000,
      result: {},
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockStatistics: KeeperStatistics = {
  totalKeepers: 100,
  activeKeepers: 95,
  inactiveKeepers: 3,
  unhealthyKeepers: 2,
  averageHealthScore: 94.2,
  averageSuccessRate: 99.1,
  totalExecutions: 50000,
  totalFailedExecutions: 450,
  regionDistribution: {
    'us-east': 30,
    'us-west': 25,
    'eu-central': 25,
    'ap-southeast': 15,
    other: 5,
  } as Record<any, number>,
  statusDistribution: {
    active: 95,
    inactive: 3,
    paused: 1,
    error: 1,
    unhealthy: 0,
  } as Record<any, number>,
};

// Health Indicator Stories
const healthIndicatorMeta: Meta<typeof KeeperHealthIndicator> = {
  title: 'Keeper/Health Indicator',
  component: KeeperHealthIndicator,
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: { type: 'select' },
      options: ['sm', 'md', 'lg'],
    },
    showLabel: {
      control: { type: 'boolean' },
    },
  },
};

export default healthIndicatorMeta;
type HealthIndicatorStory = StoryObj<typeof KeeperHealthIndicator>;

export const Active: HealthIndicatorStory = {
  args: {
    keeper: mockKeeper,
    size: 'md',
    showLabel: true,
  },
};

export const Inactive: HealthIndicatorStory = {
  args: {
    keeper: { ...mockKeeper, status: 'inactive' },
    size: 'md',
    showLabel: true,
  },
};

export const Paused: HealthIndicatorStory = {
  args: {
    keeper: { ...mockKeeper, status: 'paused' },
    size: 'md',
    showLabel: true,
  },
};

export const Error: HealthIndicatorStory = {
  args: {
    keeper: { ...mockKeeper, status: 'error' },
    size: 'md',
    showLabel: true,
  },
};

export const Unhealthy: HealthIndicatorStory = {
  args: {
    keeper: { ...mockKeeper, status: 'unhealthy' },
    size: 'md',
    showLabel: true,
  },
};

export const WithoutLabel: HealthIndicatorStory = {
  args: {
    keeper: mockKeeper,
    size: 'md',
    showLabel: false,
  },
};

export const SmallSize: HealthIndicatorStory = {
  args: {
    keeper: mockKeeper,
    size: 'sm',
    showLabel: true,
  },
};

export const LargeSize: HealthIndicatorStory = {
  args: {
    keeper: mockKeeper,
    size: 'lg',
    showLabel: true,
  },
};

// Health Score Stories
const healthScoreMeta: Meta<typeof KeeperHealthScore> = {
  title: 'Keeper/Health Score',
  component: KeeperHealthScore,
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: { type: 'select' },
      options: ['sm', 'md', 'lg'],
    },
  },
};

export { healthScoreMeta };

type HealthScoreStory = StoryObj<typeof KeeperHealthScore>;

export const HealthScoreExcellent: HealthScoreStory = {
  render: () => <KeeperHealthScore score={95} size="md" />,
};

export const HealthScoreGood: HealthScoreStory = {
  render: () => <KeeperHealthScore score={75} size="md" />,
};

export const HealthScoreWarning: HealthScoreStory = {
  render: () => <KeeperHealthScore score={55} size="md" />,
};

export const HealthScoreCritical: HealthScoreStory = {
  render: () => <KeeperHealthScore score={25} size="md" />,
};

// Status Badge Stories
const statusBadgeMeta: Meta<typeof KeeperStatusBadge> = {
  title: 'Keeper/Status Badge',
  component: KeeperStatusBadge,
  tags: ['autodocs'],
};

export { statusBadgeMeta };

type StatusBadgeStory = StoryObj<typeof KeeperStatusBadge>;

export const StatusActive: StatusBadgeStory = {
  args: { status: 'active' },
};

export const StatusInactive: StatusBadgeStory = {
  args: { status: 'inactive' },
};

export const StatusPaused: StatusBadgeStory = {
  args: { status: 'paused' },
};

export const StatusError: StatusBadgeStory = {
  args: { status: 'error' },
};

export const StatusUnhealthy: StatusBadgeStory = {
  args: { status: 'unhealthy' },
};

// Uptime Display Stories
const uptimeMeta: Meta<typeof KeeperUptimeDisplay> = {
  title: 'Keeper/Uptime Display',
  component: KeeperUptimeDisplay,
  tags: ['autodocs'],
};

export { uptimeMeta };

type UptimeStory = StoryObj<typeof KeeperUptimeDisplay>;

export const UptimeExcellent: UptimeStory = {
  args: { uptime: 99.99, size: 'md' },
};

export const UptimeGood: UptimeStory = {
  args: { uptime: 95.5, size: 'md' },
};

export const UptimeWarning: UptimeStory = {
  args: { uptime: 92.3, size: 'md' },
};

export const UptimeCritical: UptimeStory = {
  args: { uptime: 85.0, size: 'md' },
};

// Table Stories
const tableMeta: Meta<typeof KeeperTable> = {
  title: 'Keeper/Table',
  component: KeeperTable,
  tags: ['autodocs'],
};

export { tableMeta };

type TableStory = StoryObj<typeof KeeperTable>;

export const TableWithKeepers: TableStory = {
  args: {
    keepers: [mockKeeper, { ...mockKeeper, id: 'keeper-2', healthScore: 75 }],
    isLoading: false,
    sortConfig: { field: 'healthScore', order: 'desc' },
  },
};

export const TableLoading: TableStory = {
  args: {
    keepers: [],
    isLoading: true,
  },
};

export const TableEmpty: TableStory = {
  args: {
    keepers: [],
    isLoading: false,
  },
};

export const TableWithError: TableStory = {
  args: {
    keepers: [],
    isLoading: false,
    error: 'Failed to load keepers. Please try again.',
  },
};

// Stats Card Stories
const statsCardMeta: Meta<typeof KeeperStatsCard> = {
  title: 'Keeper/Stats Card',
  component: KeeperStatsCard,
  tags: ['autodocs'],
};

export { statsCardMeta };

type StatsCardStory = StoryObj<typeof KeeperStatsCard>;

export const StatsCardWithData: StatsCardStory = {
  args: {
    statistics: mockStatistics,
    isLoading: false,
  },
};

export const StatsCardLoading: StatsCardStory = {
  args: {
    statistics: null,
    isLoading: true,
  },
};

export const StatsCardEmpty: StatsCardStory = {
  args: {
    statistics: null,
    isLoading: false,
  },
};

// Quick Stats Stories
const quickStatsMeta: Meta<typeof KeeperQuickStats> = {
  title: 'Keeper/Quick Stats',
  component: KeeperQuickStats,
  tags: ['autodocs'],
};

export { quickStatsMeta };

type QuickStatsStory = StoryObj<typeof KeeperQuickStats>;

export const QuickStatsDefault: QuickStatsStory = {
  args: {
    keepers: [mockKeeper],
  },
};

// Detail Modal Stories
const detailModalMeta: Meta<typeof KeeperDetailModal> = {
  title: 'Keeper/Detail Modal',
  component: KeeperDetailModal,
  tags: ['autodocs'],
};

export { detailModalMeta };

type DetailModalStory = StoryObj<typeof KeeperDetailModal>;

export const DetailModalOpen: DetailModalStory = {
  args: {
    keeper: mockKeeper,
    isOpen: true,
    isLoading: false,
    recentExecutions: mockKeeper.recentExecutions,
  },
};

export const DetailModalLoading: DetailModalStory = {
  args: {
    keeper: mockKeeper,
    isOpen: true,
    isLoading: true,
    recentExecutions: [],
  },
};

export const DetailModalClosed: DetailModalStory = {
  args: {
    keeper: mockKeeper,
    isOpen: false,
  },
};

// Responsive Stories
export const ResponsiveMobileTable: TableStory = {
  args: {
    keepers: [mockKeeper, { ...mockKeeper, id: 'keeper-2' }],
    isLoading: false,
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
};

export const ResponsiveTabletTable: TableStory = {
  args: {
    keepers: [mockKeeper, { ...mockKeeper, id: 'keeper-2' }],
    isLoading: false,
  },
  parameters: {
    viewport: {
      defaultViewport: 'tablet',
    },
  },
};
