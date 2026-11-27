import { act, render, screen } from '@testing-library/react';
import StatusPage from './page';
import { useSocket } from '../hooks/useSocket';

jest.mock('../hooks/useSocket', () => ({
  useSocket: jest.fn(),
}));

const mockUseSocket = jest.mocked(useSocket);

describe('StatusPage', () => {
  beforeEach(() => {
    mockUseSocket.mockReset();
  });

  it('shows disconnected telemetry without inventing health data', () => {
    render(<StatusPage />);

    expect(screen.getByRole('heading', { name: 'Keeper System Status' })).toBeInTheDocument();
    expect(screen.getByText('Live updates disconnected')).toBeInTheDocument();
    expect(screen.getByText('Telemetry disconnected')).toBeInTheDocument();
    expect(screen.getByText('Regional data unavailable')).toBeInTheDocument();
    expect(screen.getAllByText('Not reported')).toHaveLength(3);
    expect(screen.getByRole('alert')).toHaveTextContent('Live connection to the keeper is unavailable');
  });

  it('renders live metrics and proactively warns for degraded keeper health', () => {
    let callbacks: Parameters<typeof useSocket>[0] | undefined;
    mockUseSocket.mockImplementation((options) => {
      callbacks = options;
      return { current: null };
    });

    render(<StatusPage />);

    act(() => {
      callbacks?.onConnect?.();
      callbacks?.onMetrics?.({
        tasksCheckedTotal: 42,
        tasksDueTotal: 3,
        tasksExecutedTotal: 12,
        tasksFailedTotal: 2,
        avgFeePaidXlm: 0.001,
        lastCycleDurationMs: 120,
      });
      callbacks?.onHealth?.({
        status: 'stale',
        uptime: 3600,
        lastPollAt: null,
        rpcConnected: false,
        rpcCircuitState: 'OPEN',
        paused: true,
        pauseReason: 'maintenance',
        latestLedgerSequence: 12345,
      });
    });

    expect(screen.getByText('Live updates connected')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Keeper heartbeat is stale');
    expect(screen.getByRole('alert')).toHaveTextContent('Stellar RPC endpoint');
    expect(screen.getByRole('alert')).toHaveTextContent('circuit breaker is open');
    expect(screen.getByRole('alert')).toHaveTextContent('Keeper is paused: maintenance');
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText(/12,?345/)).toBeInTheDocument();
    expect(screen.getByLabelText('System health Degraded, score 0 out of 100')).toBeInTheDocument();
  });

  it('shows a healthy status and records the measured WebSocket latency', () => {
    let callbacks: Parameters<typeof useSocket>[0] | undefined;
    mockUseSocket.mockImplementation((options) => {
      callbacks = options;
      return { current: null };
    });

    render(<StatusPage />);
    act(() => {
      callbacks?.onConnect?.();
      callbacks?.onHealth?.({
        status: 'ok',
        uptime: 3600,
        lastPollAt: new Date().toISOString(),
        rpcConnected: true,
        rpcCircuitState: 'CLOSED',
        paused: false,
        latestLedgerSequence: 12345,
      });
      callbacks?.onLatency?.(34);
    });

    expect(screen.getByLabelText('System health Healthy, score 100 out of 100')).toBeInTheDocument();
    expect(screen.getByText('34 ms')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
