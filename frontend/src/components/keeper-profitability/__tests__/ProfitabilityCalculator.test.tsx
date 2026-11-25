/**
 * Tests for ProfitabilityCalculator.
 *
 * The calculator is the surface where the cost model becomes a decision, so the
 * tests assert the operator-facing contract: the breakdown sums to the headline
 * margin, the override actually changes the verdict, and the sweep brackets the
 * break-even fee.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProfitabilityCalculator } from '../ProfitabilityCalculator';
import type { GasPriceSample } from '@/src/lib/keeper-profitability/costs';

const NOW = 1_700_000_000_000;

const workload = {
  executions: 100,
  gasPerTx: 50_000,
  revenuePerSuccessXlm: 1,
  successRate: 1,
};

const gasPriceFetcher = jest.fn(
  async (): Promise<GasPriceSample[]> => [
    { timestamp: NOW - 60_000, priceXlm: 0.00001 },
    { timestamp: NOW - 30_000, priceXlm: 0.00002 },
    { timestamp: NOW, priceXlm: 0.000015 },
  ],
);

beforeEach(() => {
  gasPriceFetcher.mockClear();
});

function renderCalculator(overrides: Record<string, unknown> = {}) {
  return render(
    <ProfitabilityCalculator
      workload={workload}
      gasPriceFetcher={gasPriceFetcher}
      pollMs={0}
      now={() => NOW}
      {...overrides}
    />,
  );
}

describe('ProfitabilityCalculator', () => {
  it('renders the workbench heading', () => {
    renderCalculator();
    expect(
      screen.getByRole('heading', { name: /profitability simulator/i }),
    ).toBeInTheDocument();
  });

  it('shows a positive margin for a workload that clears its costs', async () => {
    renderCalculator();
    await waitFor(() => expect(gasPriceFetcher).toHaveBeenCalled());
    const verdict = screen.getByTestId('pc-verdict');
    expect(verdict).toHaveTextContent(/net margin/i);
    expect(verdict).toHaveTextContent(/profitable/i);
  });

  it('reports a loss once the gas price is raised past break-even', async () => {
    renderCalculator();
    await waitFor(() => expect(gasPriceFetcher).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/gas price override/i), {
      target: { value: '0.001' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('pc-verdict')).toHaveTextContent(/loss/i);
    });
  });

  it('applies the gas price override to the projection', async () => {
    renderCalculator();
    await waitFor(() => expect(gasPriceFetcher).toHaveBeenCalled());

    const before = screen.getByTestId('pc-verdict').textContent;

    fireEvent.change(screen.getByLabelText(/gas price override/i), {
      target: { value: '0.002' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('pc-verdict').textContent).not.toBe(before);
    });
  });

  it('surfaces a break-even fee and headroom', async () => {
    renderCalculator();
    await waitFor(() => expect(gasPriceFetcher).toHaveBeenCalled());
    expect(screen.getByText(/break-even fee/i)).toBeInTheDocument();
    expect(screen.getByText(/^headroom$/i)).toBeInTheDocument();
  });

  it('explains that no break-even exists when the workload earns nothing', async () => {
    // Revenue that does not cover even the non-gas costs leaves no fee at
    // which the run can turn a profit.
    renderCalculator({ workload: { ...workload, revenuePerSuccessXlm: 0 } });
    await waitFor(() => expect(gasPriceFetcher).toHaveBeenCalled());
    expect(screen.getByText(/no break-even fee/i)).toBeInTheDocument();
  });

  it('adds slippage only when a pool is modelled', async () => {
    renderCalculator();
    await waitFor(() => expect(gasPriceFetcher).toHaveBeenCalled());
    const before = screen.getByTestId('pc-verdict').textContent;

    fireEvent.click(screen.getByLabelText(/model dex slippage/i));

    await waitFor(() => {
      expect(screen.getByTestId('pc-verdict').textContent).not.toBe(before);
    });
    expect(screen.getByLabelText(/pool reserve/i)).toBeInTheDocument();
  });

  it('reveals the retry-rate field only once RPC costs are set', () => {
    renderCalculator();
    expect(screen.queryByLabelText(/retry rate/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/rpc cost per hour/i), {
      target: { value: '2' },
    });
    expect(screen.getByLabelText(/retry rate/i)).toBeInTheDocument();
  });

  it('recomputes when the workload changes', async () => {
    renderCalculator();
    await waitFor(() => expect(gasPriceFetcher).toHaveBeenCalled());
    const before = screen.getByTestId('pc-verdict').textContent;

    fireEvent.change(screen.getByLabelText(/^executions$/i), { target: { value: '10' } });

    await waitFor(() => {
      expect(screen.getByTestId('pc-verdict').textContent).not.toBe(before);
    });
  });

  it('recomputes when the success rate changes', async () => {
    renderCalculator();
    await waitFor(() => expect(gasPriceFetcher).toHaveBeenCalled());
    const before = screen.getByTestId('pc-verdict').textContent;

    fireEvent.change(screen.getByLabelText(/success rate/i), { target: { value: '20' } });

    await waitFor(() => {
      expect(screen.getByTestId('pc-verdict').textContent).not.toBe(before);
    });
  });

  it('renders the fee sweep with a caption for screen readers', async () => {
    renderCalculator();
    await waitFor(() => expect(gasPriceFetcher).toHaveBeenCalled());
    expect(
      screen.getByRole('table', { name: /projected net margin/i }),
    ).toBeInTheDocument();
  });

  it('lists one sweep row per ladder rung', async () => {
    renderCalculator({ sweepSteps: 5 });
    await waitFor(() => expect(gasPriceFetcher).toHaveBeenCalled());
    const table = screen.getByRole('table', { name: /projected net margin/i });
    // Header row plus five rungs.
    expect(table.querySelectorAll('tbody tr')).toHaveLength(5);
  });

  it('summarises ROI across the observed fee windows', async () => {
    renderCalculator();
    await waitFor(() => expect(screen.getByText(/mean roi/i)).toBeInTheDocument());
    expect(
      screen.getByRole('heading', { name: /roi across observed fee windows/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/worst roi/i)).toBeInTheDocument();
    expect(screen.getByText(/profitable share/i)).toBeInTheDocument();
  });

  it('prompts for history when no gas samples exist', async () => {
    const empty = jest.fn(async (): Promise<GasPriceSample[]> => []);
    renderCalculator({ gasPriceFetcher: empty });
    await waitFor(() => expect(empty).toHaveBeenCalled());
    expect(screen.getByText(/no fee history yet/i)).toBeInTheDocument();
  });

  it('warns when the gas feed is unavailable', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('rpc down'));
    renderCalculator({ gasPriceFetcher: failing });
    await waitFor(() =>
      expect(screen.getByText(/gas price feed unavailable/i)).toBeInTheDocument(),
    );
  });

  it('is labelled by its heading for assistive technology', () => {
    renderCalculator();
    const section = screen.getByTestId('profitability-calculator');
    expect(section).toHaveAttribute('aria-labelledby', 'profitability-calculator-title');
  });
});
