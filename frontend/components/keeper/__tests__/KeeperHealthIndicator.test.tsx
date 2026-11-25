/**
 * Keeper Health Indicator Tests
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  KeeperHealthIndicator,
  KeeperHealthScore,
  KeeperStatusBadge,
  KeeperUptimeDisplay,
} from '../KeeperHealthIndicator';
import { Keeper } from '@/types/keeper';

const mockKeeper: Keeper = {
  id: 'keeper-1',
  address: 'GA123456789',
  status: 'active',
  healthScore: 95,
  executionCount: 100,
  successRate: 99.5,
  failureRate: 0.5,
  averageGasUsed: 5000,
  region: 'us-east',
  lastHeartbeat: new Date().toISOString(),
  uptimePercentage: 99.9,
  totalTasks: 150,
  failedTasks: 2,
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
  recentExecutions: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('KeeperHealthIndicator', () => {
  it('should render health indicator for active keeper', () => {
    render(<KeeperHealthIndicator keeper={mockKeeper} showLabel={true} />);

    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('should render health indicator with label', () => {
    render(<KeeperHealthIndicator keeper={mockKeeper} showLabel={true} />);

    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('should render without label', () => {
    const { container } = render(
      <KeeperHealthIndicator keeper={mockKeeper} showLabel={false} />
    );

    expect(container.querySelector('div')).toBeInTheDocument();
  });

  it('should render different sizes', () => {
    const { container: smallContainer } = render(
      <KeeperHealthIndicator keeper={mockKeeper} size="sm" />
    );
    const { container: mediumContainer } = render(
      <KeeperHealthIndicator keeper={mockKeeper} size="md" />
    );
    const { container: largeContainer } = render(
      <KeeperHealthIndicator keeper={mockKeeper} size="lg" />
    );

    expect(smallContainer).toBeInTheDocument();
    expect(mediumContainer).toBeInTheDocument();
    expect(largeContainer).toBeInTheDocument();
  });

  it('should render different status colors', () => {
    const statuses = ['active', 'inactive', 'paused', 'error', 'unhealthy'] as const;

    statuses.forEach((status) => {
      const keeper = { ...mockKeeper, status };
      const { rerender } = render(
        <KeeperHealthIndicator keeper={keeper} showLabel={true} />
      );

      const label = screen.getByText(
        status.charAt(0).toUpperCase() + status.slice(1)
      );
      expect(label).toBeInTheDocument();

      rerender(<KeeperHealthIndicator keeper={mockKeeper} showLabel={true} />);
    });
  });
});

describe('KeeperHealthScore', () => {
  it('should render health score', () => {
    render(<KeeperHealthScore score={95} />);

    expect(screen.getByText(/95%/)).toBeInTheDocument();
  });

  it('should render different score ranges with correct colors', () => {
    const scores = [
      { score: 90, shouldContainClass: 'emerald' },
      { score: 70, shouldContainClass: 'blue' },
      { score: 50, shouldContainClass: 'yellow' },
      { score: 20, shouldContainClass: 'red' },
    ];

    scores.forEach(({ score }) => {
      render(<KeeperHealthScore score={score} />);
      expect(screen.getByText(`${score}%`)).toBeInTheDocument();
    });
  });

  it('should render different sizes', () => {
    const { container: smallContainer } = render(
      <KeeperHealthScore score={95} size="sm" />
    );
    const { container: mediumContainer } = render(
      <KeeperHealthScore score={95} size="md" />
    );
    const { container: largeContainer } = render(
      <KeeperHealthScore score={95} size="lg" />
    );

    expect(smallContainer).toBeInTheDocument();
    expect(mediumContainer).toBeInTheDocument();
    expect(largeContainer).toBeInTheDocument();
  });
});

describe('KeeperStatusBadge', () => {
  it('should render status badge', () => {
    render(<KeeperStatusBadge status="active" />);

    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('should render all status types', () => {
    const statuses = ['active', 'inactive', 'paused', 'error', 'unhealthy'] as const;

    statuses.forEach((status) => {
      const { unmount } = render(<KeeperStatusBadge status={status} />);

      const text = status.charAt(0).toUpperCase() + status.slice(1);
      expect(screen.getByText(text)).toBeInTheDocument();

      unmount();
    });
  });
});

describe('KeeperUptimeDisplay', () => {
  it('should render uptime percentage', () => {
    render(<KeeperUptimeDisplay uptime={99.9} />);

    expect(screen.getByText(/99.90%/)).toBeInTheDocument();
  });

  it('should render different uptime values with correct formatting', () => {
    render(<KeeperUptimeDisplay uptime={95.5} />);

    expect(screen.getByText(/95.50%/)).toBeInTheDocument();
  });

  it('should render different sizes', () => {
    const { container: smallContainer } = render(
      <KeeperUptimeDisplay uptime={99.9} size="sm" />
    );
    const { container: mediumContainer } = render(
      <KeeperUptimeDisplay uptime={99.9} size="md" />
    );

    expect(smallContainer).toBeInTheDocument();
    expect(mediumContainer).toBeInTheDocument();
  });
});
