/**
 * Tests for the shield dashboard and its presentation pieces. Uses the
 * main-thread fallback bridge so no real Web Worker is needed.
 */

import { render, screen, act } from '@testing-library/react';
import { ShieldDashboard } from '../ShieldDashboard';
import { ThreatLevelGauge } from '../ThreatLevelGauge';
import { ShieldMetrics } from '../ShieldMetrics';
import { TopOffendersTable } from '../TopOffendersTable';
import { AnomalyList } from '../AnomalyList';
import { getThreatMeta } from '../threatMeta';
import type { ShieldSnapshot } from '@/src/lib/shield/types';

const baseSnapshot: ShieldSnapshot = {
  timestamp: 1,
  threatLevel: 'normal',
  requestsPerSecond: 12,
  totalRequests: 100,
  allowed: 80,
  throttled: 10,
  blocked: 10,
  activeClients: 5,
  topOffenders: [{ clientId: 'whale', requests: 40, blocked: 3, share: 0.4 }],
  anomalies: [],
};

describe('getThreatMeta', () => {
  it('returns metadata for each level', () => {
    expect(getThreatMeta('normal').label).toBe('Normal');
    expect(getThreatMeta('elevated').label).toBe('Elevated');
    expect(getThreatMeta('high').label).toBe('High');
    expect(getThreatMeta('critical').fill).toBe(1);
  });

  it('falls back to normal for unknown levels', () => {
    // @ts-expect-error testing defensive fallback
    expect(getThreatMeta('mystery').label).toBe('Normal');
  });
});

describe('ThreatLevelGauge', () => {
  it('renders the level label and rps', () => {
    render(<ThreatLevelGauge level="critical" requestsPerSecond={321} />);
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText(/321 req\/s/)).toBeInTheDocument();
  });
});

describe('ShieldMetrics', () => {
  it('renders the headline counters and block rate', () => {
    render(<ShieldMetrics snapshot={baseSnapshot} />);
    expect(screen.getByText('Allowed')).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
    expect(screen.getByText('10.0%')).toBeInTheDocument(); // block rate
  });

  it('handles a zero-traffic snapshot without dividing by zero', () => {
    render(<ShieldMetrics snapshot={{ ...baseSnapshot, totalRequests: 0, blocked: 0 }} />);
    expect(screen.getByText('0.0%')).toBeInTheDocument();
  });
});

describe('TopOffendersTable', () => {
  it('renders offender rows', () => {
    render(<TopOffendersTable offenders={baseSnapshot.topOffenders} />);
    expect(screen.getByText('whale')).toBeInTheDocument();
    expect(screen.getByText('40.0%')).toBeInTheDocument();
  });

  it('shows an empty state with no offenders', () => {
    render(<TopOffendersTable offenders={[]} />);
    expect(screen.getByText(/No client activity/)).toBeInTheDocument();
  });
});

describe('AnomalyList', () => {
  it('shows a healthy state when empty', () => {
    render(<AnomalyList anomalies={[]} />);
    expect(screen.getByText(/Traffic looks healthy/)).toBeInTheDocument();
  });

  it('renders anomaly entries', () => {
    render(
      <AnomalyList
        anomalies={[
          { type: 'volumetric', message: 'flood detected', severity: 0.9 },
          { type: 'concentration', clientId: 'x', message: 'x dominates', severity: 0.5 },
        ]}
      />,
    );
    expect(screen.getByText('Volumetric flood')).toBeInTheDocument();
    expect(screen.getByText('flood detected')).toBeInTheDocument();
    expect(screen.getByText('Source concentration')).toBeInTheDocument();
  });
});

describe('ShieldDashboard', () => {
  const noWorker = () => null;

  it('renders the awaiting state before any telemetry', () => {
    render(<ShieldDashboard workerFactory={noWorker} />);
    expect(screen.getByText(/Awaiting traffic telemetry/)).toBeInTheDocument();
    expect(screen.getByText('Fallback mode')).toBeInTheDocument();
  });

  it('renders a snapshot when telemetry is supplied', () => {
    render(
      <ShieldDashboard
        workerFactory={noWorker}
        events={[
          { clientId: 'a', timestamp: 0 },
          { clientId: 'b', timestamp: 1 },
        ]}
      />,
    );
    expect(screen.getByTestId('shield-dashboard')).toBeInTheDocument();
    expect(screen.getByText('Anti-DDoS Shield')).toBeInTheDocument();
    // Snapshot section rendered with metrics.
    expect(screen.getByText('Allowed')).toBeInTheDocument();
  });

  it('surfaces recovered worker errors in the header', () => {
    class ErrorWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(message: { type: string }) {
        if (message.type === 'ingest') {
          this.onmessage?.({
            data: { type: 'error', message: 'worker boom' },
          } as MessageEvent);
        }
      }
      terminate() {}
    }
    render(
      <ShieldDashboard
        workerFactory={() => new ErrorWorker() as unknown as Worker}
        events={[{ clientId: 'a', timestamp: 0 }]}
      />,
    );
    expect(screen.getByText(/recovered ×1/)).toBeInTheDocument();
  });

  it('reset button clears the snapshot', () => {
    render(
      <ShieldDashboard
        workerFactory={noWorker}
        events={[{ clientId: 'a', timestamp: 0 }]}
      />,
    );
    const button = screen.getByRole('button', { name: 'Reset' });
    act(() => button.click());
    expect(screen.getByText(/Awaiting traffic telemetry/)).toBeInTheDocument();
  });
});
