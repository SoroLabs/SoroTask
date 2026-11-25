/**
 * Tests for the useKeeperProfitability hook. Polling is disabled (pollMs: 0)
 * and timing is deterministic via injected seams.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { useKeeperProfitability } from '../useKeeperProfitability';
import type { KeeperEconomicsRecord } from '@/src/lib/keeper-profitability/types';

const records: KeeperEconomicsRecord[] = [
  { keeperId: 'a', executions: 10, successfulExecutions: 9, cost: 5, revenue: 20 },
];

const seams = { sleep: async () => undefined, random: () => 0.5, now: () => 1_000 };

describe('useKeeperProfitability', () => {
  it('loads live data on mount', async () => {
    const fetcher = jest.fn().mockResolvedValue(records);
    const { result } = renderHook(() =>
      useKeeperProfitability({ fetcher, pollMs: 0, ...seams }),
    );

    await waitFor(() => expect(result.current.result?.status).toBe('live'));
    expect(result.current.result?.points).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });

  it('exposes a stale status when the source degrades', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(records)
      .mockRejectedValue(new Error('down'));
    const { result } = renderHook(() =>
      useKeeperProfitability({ fetcher, pollMs: 0, config: { maxRetries: 0 }, ...seams }),
    );

    await waitFor(() => expect(result.current.result?.status).toBe('live'));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.result?.status).toBe('stale');
    expect(result.current.result?.fromCache).toBe(true);
  });

  it('returns an empty offline result when disabled', () => {
    const fetcher = jest.fn();
    const { result } = renderHook(() =>
      useKeeperProfitability({ fetcher, enabled: false, pollMs: 0, ...seams }),
    );
    expect(result.current.result?.status).toBe('offline');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('manual refresh re-fetches', async () => {
    const fetcher = jest.fn().mockResolvedValue(records);
    const { result } = renderHook(() =>
      useKeeperProfitability({ fetcher, pollMs: 0, ...seams }),
    );
    await waitFor(() => expect(result.current.result?.status).toBe('live'));
    await act(async () => {
      await result.current.refresh();
    });
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
