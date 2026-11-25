"use client";

import React, { useState, useTransition } from "react";
import {
  ShieldAlert,
  Clock,
  Database,
  ArrowUpCircle,
  RefreshCw,
  Search,
  CheckCircle,
  AlertTriangle,
  Flame,
} from "lucide-react";

export type StorageEntryType = "Instance" | "Persistent" | "Temporary";

export interface StorageEntry {
  key: string;
  type: StorageEntryType;
  valueSnippet: string;
  sizeBytes: number;
  liveUntilLedger: number;
  currentLedger: number;
}

export interface StorageInspectorProps {
  contractId?: string;
  initialEntries?: StorageEntry[];
  currentLedger?: number;
  onBumpTtl?: (
    key: string,
    type: StorageEntryType,
    bumpLedgers: number,
  ) => Promise<boolean>;
}

export const LEDGER_SECONDS_PER_BLOCK = 5; // Stellar 5-second ledger block close
export const BLOCKS_PER_DAY = (24 * 60 * 60) / LEDGER_SECONDS_PER_BLOCK; // 17,280 blocks/day

export function calculateRemainingBlocks(
  liveUntilLedger: number,
  currentLedger: number,
): number {
  return Math.max(0, liveUntilLedger - currentLedger);
}

export function calculateRemainingDays(
  liveUntilLedger: number,
  currentLedger: number,
): number {
  const remainingBlocks = calculateRemainingBlocks(
    liveUntilLedger,
    currentLedger,
  );
  return remainingBlocks / BLOCKS_PER_DAY;
}

export function getTtlHealthCategory(remainingDays: number): {
  color: "green" | "yellow" | "red";
  label: string;
  bgClass: string;
  barClass: string;
  textClass: string;
} {
  if (remainingDays >= 30) {
    return {
      color: "green",
      label: "Healthy (>30d)",
      bgClass: "bg-emerald-500/10 border-emerald-500/30",
      barClass: "bg-emerald-500",
      textClass: "text-emerald-400",
    };
  }
  if (remainingDays >= 7) {
    return {
      color: "yellow",
      label: "Moderate (7-30d)",
      bgClass: "bg-amber-500/10 border-amber-500/30",
      barClass: "bg-amber-500",
      textClass: "text-amber-400",
    };
  }
  if (remainingDays >= 2) {
    return {
      color: "yellow",
      label: "Warning (<7d)",
      bgClass: "bg-yellow-500/10 border-yellow-500/30",
      barClass: "bg-yellow-500",
      textClass: "text-yellow-400",
    };
  }
  return {
    color: "red",
    label: "Critical (<2d)",
    bgClass: "bg-rose-500/10 border-rose-500/30",
    barClass: "bg-rose-500",
    textClass: "text-rose-400",
  };
}

const MOCK_STORAGE_ENTRIES: StorageEntry[] = [
  {
    key: "AdminAddress",
    type: "Instance",
    valueSnippet: "GB7B...43NQ (Address)",
    sizeBytes: 64,
    liveUntilLedger: 52_500_000,
    currentLedger: 51_000_000, // ~1,500,000 blocks (~86 days) -> Green
  },
  {
    key: "TaskNonce:user_01",
    type: "Persistent",
    valueSnippet: "142 (u64)",
    sizeBytes: 16,
    liveUntilLedger: 51_150_000,
    currentLedger: 51_000_000, // 150,000 blocks (~8.6 days) -> Yellow
  },
  {
    key: "RateLimitWindow:user_01",
    type: "Temporary",
    valueSnippet: "count: 4, window_end: 51000500",
    sizeBytes: 32,
    liveUntilLedger: 51_015_000,
    currentLedger: 51_000_000, // 15,000 blocks (~0.86 days) -> Red (<2d)
  },
  {
    key: "OraclePriceFeed:XLM_USDC",
    type: "Persistent",
    valueSnippet: "0.124500 (i128 fixed)",
    sizeBytes: 40,
    liveUntilLedger: 51_025_000,
    currentLedger: 51_000_000, // 25,000 blocks (~1.44 days) -> Red (<2d)
  },
  {
    key: "KeeperStakePool",
    type: "Instance",
    valueSnippet: "total_staked: 500,000 XLM",
    sizeBytes: 128,
    liveUntilLedger: 51_800_000,
    currentLedger: 51_000_000, // 800,000 blocks (~46 days) -> Green
  },
];

export const StorageInspector: React.FC<StorageInspectorProps> = ({
  contractId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  initialEntries = MOCK_STORAGE_ENTRIES,
  currentLedger = 51_000_000,
  onBumpTtl,
}) => {
  const [entries, setEntries] = useState<StorageEntry[]>(initialEntries);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("ALL");
  const [bumpStatus, setBumpStatus] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const handleBump = async (entry: StorageEntry) => {
    setBumpStatus((prev) => ({ ...prev, [entry.key]: "bumping" }));
    try {
      if (onBumpTtl) {
        await onBumpTtl(entry.key, entry.type, 100_000);
      } else {
        // Mock simulated delay and local update
        await new Promise((res) => setTimeout(res, 500));
      }

      setEntries((prev) =>
        prev.map((e) =>
          e.key === entry.key
            ? { ...e, liveUntilLedger: e.liveUntilLedger + 100_000 }
            : e,
        ),
      );
      setBumpStatus((prev) => ({ ...prev, [entry.key]: "success" }));
      setTimeout(() => {
        setBumpStatus((prev) => {
          const next = { ...prev };
          delete next[entry.key];
          return next;
        });
      }, 3000);
    } catch {
      setBumpStatus((prev) => ({ ...prev, [entry.key]: "error" }));
    }
  };

  const filteredEntries = entries.filter((entry) => {
    const matchesSearch =
      entry.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.valueSnippet.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === "ALL" || entry.type === filterType;
    return matchesSearch && matchesType;
  });

  const criticalCount = entries.filter((e) => {
    const days = calculateRemainingDays(e.liveUntilLedger, currentLedger);
    return days < 2;
  }).length;

  return (
    <div
      data-testid="storage-inspector"
      className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl text-neutral-100"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-6 border-b border-neutral-800">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-indigo-400">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                Contract Storage & TTL Inspector
                {criticalCount > 0 && (
                  <span
                    data-testid="critical-badge"
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-300 font-semibold animate-pulse"
                  >
                    <Flame className="w-3.5 h-3.5" />
                    {criticalCount} Critical Expiries
                  </span>
                )}
              </h2>
              <p className="text-sm text-neutral-400 font-mono mt-0.5 break-all">
                Contract: <span className="text-neutral-200">{contractId}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-xs text-neutral-400 block">
              Current Ledger Block
            </span>
            <span
              data-testid="current-ledger"
              className="font-mono text-sm font-semibold text-indigo-300"
            >
              #{currentLedger.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between mb-6">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-3 text-neutral-500" />
          <input
            type="text"
            placeholder="Filter keys or values..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-9 pr-4 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-neutral-400 font-medium">Type:</span>
          {(["ALL", "Instance", "Persistent", "Temporary"] as const).map(
            (type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  filterType === type
                    ? "bg-indigo-600 text-white"
                    : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                }`}
              >
                {type}
              </button>
            ),
          )}
        </div>
      </div>

      {/* Storage Entries Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-xs text-neutral-400 uppercase tracking-wider">
              <th className="pb-3 px-3">Storage Key</th>
              <th className="pb-3 px-3">Type</th>
              <th className="pb-3 px-3">Size</th>
              <th className="pb-3 px-3">Value Preview</th>
              <th className="pb-3 px-3">Remaining TTL Blocks</th>
              <th className="pb-3 px-3">Expiration Health</th>
              <th className="pb-3 px-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/60 font-mono">
            {filteredEntries.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="py-8 text-center text-neutral-500 text-sm"
                >
                  No storage entries matched query.
                </td>
              </tr>
            ) : (
              filteredEntries.map((entry) => {
                const remainingBlocks = calculateRemainingBlocks(
                  entry.liveUntilLedger,
                  currentLedger,
                );
                const remainingDays = calculateRemainingDays(
                  entry.liveUntilLedger,
                  currentLedger,
                );
                const health = getTtlHealthCategory(remainingDays);
                const isBumping = bumpStatus[entry.key] === "bumping";
                const isSuccess = bumpStatus[entry.key] === "success";

                return (
                  <tr
                    key={entry.key}
                    data-testid={`storage-row-${entry.key}`}
                    className="hover:bg-neutral-800/40 transition-colors"
                  >
                    {/* Key */}
                    <td className="py-3 px-3 font-semibold text-neutral-200">
                      {entry.key}
                    </td>

                    {/* Type Badge */}
                    <td className="py-3 px-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-sans font-medium ${
                          entry.type === "Instance"
                            ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                            : entry.type === "Persistent"
                              ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                        }`}
                      >
                        {entry.type}
                      </span>
                    </td>

                    {/* Size */}
                    <td className="py-3 px-3 text-neutral-400 text-xs">
                      {entry.sizeBytes} B
                    </td>

                    {/* Value snippet */}
                    <td className="py-3 px-3 text-neutral-300 text-xs truncate max-w-xs">
                      {entry.valueSnippet}
                    </td>

                    {/* TTL Countdowns */}
                    <td className="py-3 px-3">
                      <div className="flex flex-col">
                        <span className="font-semibold text-neutral-200">
                          {remainingBlocks.toLocaleString()} blocks
                        </span>
                        <span className="text-xs text-neutral-400">
                          ~{remainingDays.toFixed(1)} days remaining
                        </span>
                      </div>
                    </td>

                    {/* Risk bar */}
                    <td className="py-3 px-3">
                      <div className="w-36">
                        <div className="flex justify-between items-center text-xs mb-1 font-sans">
                          <span className={`font-semibold ${health.textClass}`}>
                            {health.label}
                          </span>
                        </div>
                        <div className="w-full bg-neutral-800 rounded-full h-2 overflow-hidden">
                          <div
                            data-testid={`health-bar-${health.color}`}
                            className={`h-full rounded-full transition-all duration-500 ${health.barClass}`}
                            style={{
                              width: `${Math.min(100, Math.max(5, (remainingDays / 60) * 100))}%`,
                            }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Bump Action Button */}
                    <td className="py-3 px-3 text-right">
                      <button
                        data-testid={`bump-btn-${entry.key}`}
                        disabled={isBumping || isSuccess}
                        onClick={() => handleBump(entry)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-sans font-medium transition-colors ${
                          isSuccess
                            ? "bg-emerald-600 text-white"
                            : "bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
                        }`}
                      >
                        {isBumping ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            Extending...
                          </>
                        ) : isSuccess ? (
                          <>
                            <CheckCircle className="w-3.5 h-3.5" />
                            Bumped!
                          </>
                        ) : (
                          <>
                            <ArrowUpCircle className="w-3.5 h-3.5" />
                            Extend TTL
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StorageInspector;
