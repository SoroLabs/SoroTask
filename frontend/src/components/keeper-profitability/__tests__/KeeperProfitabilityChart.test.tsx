/**
 * Tests for the Keeper Profitability scatter plot and its presentation pieces.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { KeeperProfitabilityChart } from '../KeeperProfitabilityChart';
import { ScatterPlot } from '../ScatterPlot';
import { ProfitabilityLegend } from '../ProfitabilityLegend';
import { ConnectionStatusBanner } from '../ConnectionStatusBanner';
import { getStatusStyle, getTierStyle } from '../profitabilityStyles';
import { computePoints, summarize } from '@/src/lib/keeper-profitability/profitability';
import type {
  KeeperEconomicsRecord,
  ProfitabilityResult,
} from '@/src/lib/keeper-profitability/types';

const records: KeeperEconomicsRecord[] = [
  { keeperId: 'win', executions: 80, successfulExecutions: 79, cost: 10, revenue: 90 },
  { keeperId: 'lose', executions: 30, successfulExecutions: 10, cost: 60, revenue: 10 },
];
const points = computePoints(records).points;
const seams = { sleep: async () => undefined, random: () => 0.5, now: () => 1_000 };

const result = (over: Partial<ProfitabilityResult> = {}): ProfitabilityResult => ({
  points,
  status: 'live',
  updatedAt: 1_000,
  fromCache: false,
  error: null,
  droppedRecords: 0,
  circuitOpen: false,
  ...over,
});

describe('profitabilityStyles', () => {
  it('returns tier styles and falls back for unknown tiers', () => {
    expect(getTierStyle('profitable').label).toBe('Profitable');
    // @ts-expect-error defensive fallback
    expect(getTierStyle('mystery').label).toBe('Break-even');
  });

  it('returns status styles and falls back for unknown statuses', () => {
    expect(getStatusStyle('stale').label).toBe('Stale');
    // @ts-expect-error defensive fallback
    expect(getStatusStyle('unknown').label).toBe('Offline');
  });
});

describe('ScatterPlot', () => {
  it('renders an empty state with no points', () => {
    render(<ScatterPlot points={[]} />);
    expect(screen.getByTestId('scatter-empty')).toBeInTheDocument();
  });

  it('renders a circle per point and a trend line', () => {
    render(<ScatterPlot points={points} />);
    expect(screen.getByTestId('point-win')).toBeInTheDocument();
    expect(screen.getByTestId('point-lose')).toBeInTheDocument();
    expect(screen.getByTestId('trend-line')).toBeInTheDocument();
  });

  it('omits the trend line when disabled', () => {
    render(<ScatterPlot points={points} showTrend={false} />);
    expect(screen.queryByTestId('trend-line')).not.toBeInTheDocument();
  });

  it('shows a tooltip on hover', () => {
    render(<ScatterPlot points={points} />);
    fireEvent.mouseEnter(screen.getByTestId('point-win'));
    expect(screen.getByTestId('scatter-tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByTestId('point-win'));
    expect(screen.queryByTestId('scatter-tooltip')).not.toBeInTheDocument();
  });

  it('shows a tooltip on keyboard focus and hides it on blur', () => {
    render(<ScatterPlot points={points} />);
    fireEvent.focus(screen.getByTestId('point-lose'));
    expect(screen.getByTestId('scatter-tooltip')).toBeInTheDocument();
    fireEvent.blur(screen.getByTestId('point-lose'));
    expect(screen.queryByTestId('scatter-tooltip')).not.toBeInTheDocument();
  });

  it('clamps the tooltip for points near the right/top edge', () => {
    // A single high-volume point lands at the far right, exercising the
    // tooltip-position clamping branches.
    render(
      <ScatterPlot
        points={computePoints([
          { keeperId: 'edge', executions: 1000, successfulExecutions: 1000, cost: 1, revenue: 999 },
        ]).points}
        width={320}
        height={200}
      />,
    );
    fireEvent.mouseEnter(screen.getByTestId('point-edge'));
    expect(screen.getByTestId('scatter-tooltip')).toBeInTheDocument();
  });
});

describe('ProfitabilityLegend', () => {
  it('renders tier labels with counts', () => {
    render(<ProfitabilityLegend summary={summarize(points)} />);
    expect(screen.getByText('Profitable')).toBeInTheDocument();
    expect(screen.getByText('Loss')).toBeInTheDocument();
  });
});

describe('ConnectionStatusBanner', () => {
  it('renders status and an updated time', () => {
    render(<ConnectionStatusBanner result={result({ status: 'live' })} />);
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it('shows a circuit-open badge and fires retry', () => {
    const onRetry = jest.fn();
    render(
      <ConnectionStatusBanner
        result={result({ status: 'stale', circuitOpen: true, fromCache: true })}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('circuit open')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders "never" when no update timestamp exists', () => {
    render(<ConnectionStatusBanner result={result({ updatedAt: 0 })} />);
    expect(screen.getByText(/never/)).toBeInTheDocument();
  });
});

describe('KeeperProfitabilityChart', () => {
  it('renders live data end to end', async () => {
    const fetcher = jest.fn().mockResolvedValue(records);
    render(<KeeperProfitabilityChart fetcher={fetcher} pollMs={0} {...seams} />);

    expect(screen.getByText('Keeper Profitability')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('scatter-plot')).toBeInTheDocument());
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('shows the offline banner when the source fails with no cache', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('RPC down'));
    render(
      <KeeperProfitabilityChart
        fetcher={fetcher}
        pollMs={0}
        config={{ maxRetries: 0 }}
        {...seams}
      />,
    );
    await waitFor(() => expect(screen.getByText('Offline')).toBeInTheDocument());
    expect(screen.getByTestId('scatter-empty')).toBeInTheDocument();
  });
});
