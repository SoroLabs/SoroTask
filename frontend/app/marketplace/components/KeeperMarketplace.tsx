'use client';

import React, { useState, useCallback } from 'react';
import { useMarketplace } from '../useMarketplace';
import { KeeperCard } from './KeeperCard';
import { BidModal } from './BidModal';
import { Keeper, KeeperTier, SortField } from '../types';

const TIERS: Array<KeeperTier | 'all'> = ['all', 'platinum', 'gold', 'silver', 'bronze'];

const SORT_OPTIONS: Array<{ label: string; value: SortField }> = [
  { label: 'Reliability', value: 'reliabilityScore' },
  { label: 'Success rate', value: 'successRate' },
  { label: 'Latency', value: 'medianLatencyMs' },
  { label: 'Min bid', value: 'minBidXlm' },
];

export function KeeperMarketplace() {
  const {
    keepers,
    bids,
    filters,
    sortField,
    sortDirection,
    setFilter,
    resetFilters,
    setSort,
    placeBid,
  } = useMarketplace();

  const [selectedKeeper, setSelectedKeeper] = useState<Keeper | null>(null);
  const [bidError, setBidError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const activeBidsFor = useCallback(
    (keeperId: string) => bids.filter((b) => b.keeperId === keeperId && b.status === 'pending').length,
    [bids],
  );

  function handleConfirmBid(keeper: Keeper, taskId: string, amountXlm: number) {
    setBidError('');
    try {
      placeBid(keeper.id, taskId, amountXlm);
      setSuccessMsg(`Bid of ${amountXlm} XLM placed for ${keeper.label ?? keeper.address}!`);
      setSelectedKeeper(null);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setBidError(err instanceof Error ? err.message : 'Failed to place bid');
    }
  }

  const filtersActive =
    filters.onlineOnly ||
    filters.minReliability > 0 ||
    filters.maxBidXlm !== null ||
    filters.tier !== 'all';

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Page header */}
      <header className="border-b border-neutral-800 bg-neutral-900 px-6 py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-neutral-100">Keeper Marketplace</h1>
            <p className="text-sm text-neutral-400 mt-0.5">Browse keepers and place priority execution bids</p>
          </div>
          <span className="text-xs text-neutral-500 bg-neutral-800 px-3 py-1 rounded-full">
            {keepers.length} keeper{keepers.length !== 1 ? 's' : ''} shown
          </span>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {/* Success toast */}
        {successMsg && (
          <div role="status" className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 text-sm text-green-400 flex items-center justify-between">
            <span>{successMsg}</span>
            <button type="button" onClick={() => setSuccessMsg('')} aria-label="Dismiss" className="ml-4 text-green-400/60 hover:text-green-400 text-lg">×</button>
          </div>
        )}

        {/* Filters + sort bar */}
        <section aria-label="Filters and sorting" className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            {/* Online only */}
            <label className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.onlineOnly}
                onChange={(e) => setFilter({ onlineOnly: e.target.checked })}
                className="accent-blue-500 w-4 h-4"
              />
              Online only
            </label>

            {/* Tier */}
            <div className="flex items-center gap-2">
              <label htmlFor="filter-tier" className="text-xs text-neutral-400">Tier</label>
              <select
                id="filter-tier"
                value={filters.tier}
                onChange={(e) => setFilter({ tier: e.target.value as KeeperTier | 'all' })}
                className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200 outline-none focus:ring-1 focus:ring-blue-500"
              >
                {TIERS.map((t) => (
                  <option key={t} value={t}>{t === 'all' ? 'All tiers' : t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>

            {/* Min reliability */}
            <div className="flex items-center gap-2">
              <label htmlFor="filter-reliability" className="text-xs text-neutral-400 whitespace-nowrap">Min reliability</label>
              <input
                id="filter-reliability"
                type="number"
                min={0}
                max={100}
                value={filters.minReliability}
                onChange={(e) => setFilter({ minReliability: Number(e.target.value) || 0 })}
                className="w-16 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200 outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span className="text-xs text-neutral-500">%</span>
            </div>

            {/* Max bid */}
            <div className="flex items-center gap-2">
              <label htmlFor="filter-maxbid" className="text-xs text-neutral-400 whitespace-nowrap">Max bid</label>
              <input
                id="filter-maxbid"
                type="number"
                min={0}
                step="0.01"
                value={filters.maxBidXlm ?? ''}
                onChange={(e) => setFilter({ maxBidXlm: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="any"
                className="w-20 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200 placeholder-neutral-600 outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span className="text-xs text-neutral-500">XLM</span>
            </div>

            {filtersActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors ml-auto"
              >
                Reset filters
              </button>
            )}
          </div>

          {/* Sort buttons */}
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-neutral-500 self-center">Sort by:</span>
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSort(opt.value)}
                aria-pressed={sortField === opt.value}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                  sortField === opt.value
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'border-neutral-700 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {opt.label}
                {sortField === opt.value && (
                  <span className="ml-1" aria-hidden="true">{sortDirection === 'desc' ? '↓' : '↑'}</span>
                )}
              </button>
            ))}
          </div>
        </section>

        {/* Keeper grid */}
        {keepers.length === 0 ? (
          <div className="text-center py-16 text-neutral-500">
            <p className="text-4xl mb-3" aria-hidden="true">🔍</p>
            <p className="text-sm">No keepers match your filters.</p>
            <button type="button" onClick={resetFilters} className="mt-3 text-xs text-blue-400 hover:text-blue-300">
              Clear filters
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 list-none p-0">
            {keepers.map((keeper) => (
              <li key={keeper.id}>
                <KeeperCard
                  keeper={keeper}
                  activeBidCount={activeBidsFor(keeper.id)}
                  onBid={setSelectedKeeper}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Bid modal */}
      <BidModal
        keeper={selectedKeeper}
        onConfirm={handleConfirmBid}
        onClose={() => { setSelectedKeeper(null); setBidError(''); }}
        submitError={bidError}
      />
    </div>
  );
}
