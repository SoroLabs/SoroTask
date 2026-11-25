import { renderHook, act } from '@testing-library/react';
import { useMarketplace, MOCK_KEEPERS } from '../../marketplace/useMarketplace';
import { SortField } from '../../marketplace/types';

describe('useMarketplace', () => {
  // --- initial state ---

  it('returns all mock keepers by default', () => {
    const { result } = renderHook(() => useMarketplace());
    expect(result.current.keepers).toHaveLength(MOCK_KEEPERS.length);
  });

  it('starts sorted by reliabilityScore descending', () => {
    const { result } = renderHook(() => useMarketplace());
    const scores = result.current.keepers.map((k) => k.reliabilityScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  // --- filtering ---

  it('onlineOnly filter hides offline keepers', () => {
    const { result } = renderHook(() => useMarketplace());
    act(() => result.current.setFilter({ onlineOnly: true }));
    expect(result.current.keepers.every((k) => k.isOnline)).toBe(true);
  });

  it('minReliability filter excludes keepers below threshold', () => {
    const { result } = renderHook(() => useMarketplace());
    act(() => result.current.setFilter({ minReliability: 90 }));
    expect(result.current.keepers.every((k) => k.reliabilityScore >= 90)).toBe(true);
  });

  it('maxBidXlm filter excludes keepers above max', () => {
    const { result } = renderHook(() => useMarketplace());
    act(() => result.current.setFilter({ maxBidXlm: 0.3 }));
    expect(result.current.keepers.every((k) => k.minBidXlm <= 0.3)).toBe(true);
  });

  it('tier filter shows only matching tier', () => {
    const { result } = renderHook(() => useMarketplace());
    act(() => result.current.setFilter({ tier: 'gold' }));
    expect(result.current.keepers.every((k) => k.tier === 'gold')).toBe(true);
  });

  it('combined filters reduce results correctly', () => {
    const { result } = renderHook(() => useMarketplace());
    act(() => result.current.setFilter({ onlineOnly: true, minReliability: 90 }));
    result.current.keepers.forEach((k) => {
      expect(k.isOnline).toBe(true);
      expect(k.reliabilityScore).toBeGreaterThanOrEqual(90);
    });
  });

  it('resetFilters restores all keepers', () => {
    const { result } = renderHook(() => useMarketplace());
    act(() => result.current.setFilter({ onlineOnly: true, tier: 'gold' }));
    act(() => result.current.resetFilters());
    expect(result.current.keepers).toHaveLength(MOCK_KEEPERS.length);
    expect(result.current.filters.onlineOnly).toBe(false);
    expect(result.current.filters.tier).toBe('all');
  });

  // --- sorting ---

  it('setSort changes sort field', () => {
    const { result } = renderHook(() => useMarketplace());
    act(() => result.current.setSort('minBidXlm'));
    expect(result.current.sortField).toBe('minBidXlm');
  });

  it('setSort defaults to desc on new field', () => {
    const { result } = renderHook(() => useMarketplace());
    act(() => result.current.setSort('medianLatencyMs'));
    expect(result.current.sortDirection).toBe('desc');
  });

  it('setSort toggles direction when same field', () => {
    const { result } = renderHook(() => useMarketplace());
    // Start is reliabilityScore desc
    act(() => result.current.setSort('reliabilityScore'));
    expect(result.current.sortDirection).toBe('asc');
    act(() => result.current.setSort('reliabilityScore'));
    expect(result.current.sortDirection).toBe('desc');
  });

  it('sorts ascending when direction is asc', () => {
    const { result } = renderHook(() => useMarketplace());
    act(() => result.current.setSort('reliabilityScore', 'asc'));
    const scores = result.current.keepers.map((k) => k.reliabilityScore);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });

  const sortFields: SortField[] = ['reliabilityScore', 'successRate', 'medianLatencyMs', 'minBidXlm'];
  sortFields.forEach((field) => {
    it(`sorts correctly by ${field} desc`, () => {
      const { result } = renderHook(() => useMarketplace());
      act(() => result.current.setSort(field, 'desc'));
      const values = result.current.keepers.map((k) => k[field]);
      expect(values).toEqual([...values].sort((a, b) => b - a));
    });
  });

  // --- placeBid ---

  it('placeBid adds a pending bid', () => {
    const { result } = renderHook(() => useMarketplace());
    const keeper = MOCK_KEEPERS.find((k) => k.isOnline)!;
    act(() => { result.current.placeBid(keeper.id, 'task-1', keeper.minBidXlm); });
    expect(result.current.bids).toHaveLength(1);
    expect(result.current.bids[0].status).toBe('pending');
    expect(result.current.bids[0].keeperId).toBe(keeper.id);
    expect(result.current.bids[0].amountXlm).toBe(keeper.minBidXlm);
    expect(result.current.bids[0].taskId).toBe('task-1');
  });

  it('placeBid returns the new bid object', () => {
    const { result } = renderHook(() => useMarketplace());
    const keeper = MOCK_KEEPERS.find((k) => k.isOnline)!;
    let bid: ReturnType<typeof result.current.placeBid>;
    act(() => { bid = result.current.placeBid(keeper.id, 'task-x', 1); });
    expect(bid!.id).toMatch(/^bid-/);
  });

  it('placeBid throws when keeper not found', () => {
    const { result } = renderHook(() => useMarketplace());
    expect(() => {
      act(() => { result.current.placeBid('nonexistent', 'task-1', 1); });
    }).toThrow('Keeper not found');
  });

  it('placeBid throws when keeper is offline', () => {
    const { result } = renderHook(() => useMarketplace());
    const offline = MOCK_KEEPERS.find((k) => !k.isOnline)!;
    expect(() => {
      act(() => { result.current.placeBid(offline.id, 'task-1', 1); });
    }).toThrow('offline');
  });

  it('placeBid throws when amount below minBid', () => {
    const { result } = renderHook(() => useMarketplace());
    const keeper = MOCK_KEEPERS.find((k) => k.isOnline)!;
    expect(() => {
      act(() => { result.current.placeBid(keeper.id, 'task-1', 0.0001); });
    }).toThrow(/at least/);
  });

  it('placeBid throws for non-positive amount', () => {
    const { result } = renderHook(() => useMarketplace());
    const keeper = MOCK_KEEPERS.find((k) => k.isOnline)!;
    expect(() => {
      act(() => { result.current.placeBid(keeper.id, 'task-1', 0); });
    }).toThrow('positive');
  });

  // --- cancelBid ---

  it('cancelBid sets bid status to cancelled', () => {
    const { result } = renderHook(() => useMarketplace());
    const keeper = MOCK_KEEPERS.find((k) => k.isOnline)!;
    let bid: ReturnType<typeof result.current.placeBid>;
    act(() => { bid = result.current.placeBid(keeper.id, 'task-1', 1); });
    act(() => { result.current.cancelBid(bid!.id); });
    expect(result.current.bids[0].status).toBe('cancelled');
  });

  it('cancelBid does not affect other bids', () => {
    const { result } = renderHook(() => useMarketplace());
    const keepers = MOCK_KEEPERS.filter((k) => k.isOnline);
    let bid1: ReturnType<typeof result.current.placeBid>;
    let bid2: ReturnType<typeof result.current.placeBid>;
    act(() => {
      bid1 = result.current.placeBid(keepers[0].id, 'task-1', 1);
      bid2 = result.current.placeBid(keepers[0].id, 'task-2', 1);
    });
    act(() => { result.current.cancelBid(bid1!.id); });
    expect(result.current.bids.find((b) => b.id === bid2!.id)!.status).toBe('pending');
  });
});
