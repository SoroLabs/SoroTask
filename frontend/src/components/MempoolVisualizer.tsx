"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useWallet } from "@/app/context/WalletContext";
import {
  FiActivity,
  FiBox,
  FiClock,
  FiZap,
  FiFilter,
  FiArrowUpRight,
  FiUser,
  FiSearch,
  FiRefreshCw,
} from "react-icons/fi";

export interface MempoolTransaction {
  hash: string;
  sender: string;
  targetContract: string;
  functionName: string;
  feeXlm: number;
  baseFeeStroops: number;
  estimatedCompute: number;
  gasPriority: "high" | "normal" | "low";
  timestamp: number;
  isUserTx: boolean;
  status: "pending" | "included" | "replaced";
  estimatedConfirmationSec: number;
}

const SAMPLE_CONTRACTS = [
  { contract: "CA7...89Z", name: "DCA_Vault_Execute" },
  { contract: "CB2...11M", name: "Liquidity_Rebalance" },
  { contract: "CC9...44Q", name: "Yield_Harvester" },
  { contract: "CD5...77K", name: "Oracle_Push_Price" },
  { contract: "CE1...22P", name: "Limit_Order_Fill" },
];

export function MempoolVisualizer() {
  const { session } = useWallet();
  const userAddress = session?.address || "GBDEV111111111111111111111111111111111111111111111111111111";

  const [transactions, setTransactions] = useState<MempoolTransaction[]>([]);
  const [filterUserOnly, setFilterUserOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"fee" | "time" | "compute">("fee");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [isLiveStreaming, setIsLiveStreaming] = useState(true);
  const [candidateBlockNum, setCandidateBlockNum] = useState(52_194_820);
  const [blockFillPercent, setBlockFillPercent] = useState(64);

  // Generate initial mempool dataset
  useEffect(() => {
    const initialTxs: MempoolTransaction[] = Array.from({ length: 18 }, (_, i) => {
      const isUser = i === 2 || i === 7;
      const fee = Number((0.001 + Math.random() * 0.02).toFixed(5));
      const sample = SAMPLE_CONTRACTS[i % SAMPLE_CONTRACTS.length];
      return {
        hash: `0x${Math.random().toString(16).substring(2, 10)}...${Math.random().toString(16).substring(2, 6)}`,
        sender: isUser ? userAddress : `G${Math.random().toString(36).substring(2, 8).toUpperCase()}...${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
        targetContract: sample.contract,
        functionName: sample.name,
        feeXlm: fee,
        baseFeeStroops: Math.round(fee * 10_000_000),
        estimatedCompute: Math.round(150_000 + Math.random() * 800_000),
        gasPriority: fee > 0.012 ? "high" : fee > 0.005 ? "normal" : "low",
        timestamp: Date.now() - Math.floor(Math.random() * 12_000),
        isUserTx: isUser,
        status: "pending",
        estimatedConfirmationSec: fee > 0.012 ? 3 : fee > 0.005 ? 6 : 14,
      };
    });

    setTransactions(initialTxs);
  }, [userAddress]);

  // Live WebSocket / simulated streaming incoming mempool updates
  useEffect(() => {
    if (!isLiveStreaming) return;

    const interval = setInterval(() => {
      setTransactions((prev) => {
        // Occasionally promote a tx into candidate block
        const updated = prev.map((tx) => {
          if (tx.status === "pending" && Math.random() < 0.15) {
            return { ...tx, status: "included" as const, estimatedConfirmationSec: 1 };
          }
          return tx;
        });

        // Add a new incoming pending tx
        const isUser = Math.random() < 0.1;
        const fee = Number((0.002 + Math.random() * 0.025).toFixed(5));
        const sample = SAMPLE_CONTRACTS[Math.floor(Math.random() * SAMPLE_CONTRACTS.length)];
        const newTx: MempoolTransaction = {
          hash: `0x${Math.random().toString(16).substring(2, 10)}...${Math.random().toString(16).substring(2, 6)}`,
          sender: isUser ? userAddress : `G${Math.random().toString(36).substring(2, 8).toUpperCase()}...${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
          targetContract: sample.contract,
          functionName: sample.name,
          feeXlm: fee,
          baseFeeStroops: Math.round(fee * 10_000_000),
          estimatedCompute: Math.round(180_000 + Math.random() * 750_000),
          gasPriority: fee > 0.015 ? "high" : fee > 0.006 ? "normal" : "low",
          timestamp: Date.now(),
          isUserTx: isUser,
          status: "pending",
          estimatedConfirmationSec: fee > 0.015 ? 2 : fee > 0.006 ? 5 : 12,
        };

        return [newTx, ...updated.slice(0, 35)];
      });

      // Update block candidate stats
      setBlockFillPercent((prev) => {
        const next = prev + (Math.random() * 6 - 2);
        if (next >= 98) {
          setCandidateBlockNum((b) => b + 1);
          return 15;
        }
        return Math.max(10, Math.min(98, Math.round(next)));
      });
    }, 2500);

    return () => clearInterval(interval);
  }, [isLiveStreaming, userAddress]);

  // Inject a simulated user transaction with custom gas priority
  const injectUserTx = (priority: "high" | "normal" | "low") => {
    const fee = priority === "high" ? 0.025 : priority === "normal" ? 0.008 : 0.002;
    const newTx: MempoolTransaction = {
      hash: `0x${Math.random().toString(16).substring(2, 10)}...user`,
      sender: userAddress,
      targetContract: "CA7...89Z",
      functionName: "Instant_Automation_Call",
      feeXlm: fee,
      baseFeeStroops: Math.round(fee * 10_000_000),
      estimatedCompute: 420_000,
      gasPriority: priority,
      timestamp: Date.now(),
      isUserTx: true,
      status: "pending",
      estimatedConfirmationSec: priority === "high" ? 2 : priority === "normal" ? 6 : 15,
    };
    setTransactions((prev) => [newTx, ...prev]);
  };

  // Filter & sort transactions
  const displayTransactions = useMemo(() => {
    let list = transactions;
    if (filterUserOnly) {
      list = list.filter((t) => t.isUserTx);
    }

    return [...list].sort((a, b) => {
      let diff = 0;
      if (sortBy === "fee") diff = a.feeXlm - b.feeXlm;
      else if (sortBy === "time") diff = a.timestamp - b.timestamp;
      else if (sortBy === "compute") diff = a.estimatedCompute - b.estimatedCompute;
      return sortOrder === "desc" ? -diff : diff;
    });
  }, [transactions, filterUserOnly, sortBy, sortOrder]);

  // Gas Fee Density Histogram bins
  const feeHistogram = useMemo(() => {
    const bins = [
      { label: "< 0.005 XLM", count: 0, color: "bg-slate-600" },
      { label: "0.005 - 0.010", count: 0, color: "bg-indigo-500" },
      { label: "0.010 - 0.015", count: 0, color: "bg-cyan-400" },
      { label: "0.015 - 0.020", count: 0, color: "bg-emerald-400" },
      { label: "> 0.020 XLM", count: 0, color: "bg-purple-500" },
    ];

    transactions.forEach((tx) => {
      if (tx.feeXlm < 0.005) bins[0].count++;
      else if (tx.feeXlm < 0.01) bins[1].count++;
      else if (tx.feeXlm < 0.015) bins[2].count++;
      else if (tx.feeXlm < 0.02) bins[3].count++;
      else bins[4].count++;
    });

    const maxCount = Math.max(...bins.map((b) => b.count), 1);
    return bins.map((b) => ({
      ...b,
      heightPercent: Math.round((b.count / maxCount) * 100),
    }));
  }, [transactions]);

  const userPendingCount = transactions.filter((t) => t.isUserTx && t.status === "pending").length;

  return (
    <div data-testid="mempool-visualizer" className="space-y-6">
      {/* Top Status Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-white/10 bg-slate-900/60 p-5 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <FiBox className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white">Live Mempool Visualizer</h2>
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
                <span className="size-2 rounded-full bg-emerald-400 animate-ping" />
                Live WebSocket Stream
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Tracking unconfirmed Soroban executions, priority gas bids, and candidate block space.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setIsLiveStreaming(!isLiveStreaming)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition ${
              isLiveStreaming
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-slate-700 bg-slate-800 text-slate-400"
            }`}
          >
            <FiRefreshCw className={`size-3.5 ${isLiveStreaming ? "animate-spin" : ""}`} />
            {isLiveStreaming ? "Streaming Active" : "Stream Paused"}
          </button>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => injectUserTx("high")}
              className="rounded-lg bg-indigo-600/80 hover:bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white transition"
              title="Inject high-priority test user transaction"
            >
              + Send High Gas Bid
            </button>
          </div>
        </div>
      </div>

      {/* 3D Block Construction & Gas Histogram Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Interactive 3D Block Visualizer */}
        <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-slate-900/60 p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                Candidate Block Construction
              </span>
              <h3 className="text-base font-bold text-white">
                Block #{candidateBlockNum.toLocaleString()}
              </h3>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-400">Block Capacity</span>
              <div className="font-mono text-sm font-bold text-white">
                {blockFillPercent}% Full
              </div>
            </div>
          </div>

          {/* Perspective 3D Block Container */}
          <div className="relative h-48 w-full overflow-hidden rounded-xl border border-indigo-500/20 bg-gradient-to-b from-indigo-950/20 to-slate-950/80 p-4 flex items-center justify-center">
            <div
              className="relative w-64 h-32 rounded-lg border border-indigo-400/40 bg-slate-900/90 shadow-2xl transition-all duration-500 flex flex-col justify-end p-2 overflow-hidden"
              style={{
                transform: "perspective(500px) rotateX(16deg) rotateY(-8deg)",
                boxShadow: "0 20px 40px -10px rgba(99, 102, 241, 0.3)",
              }}
            >
              <div
                className="w-full bg-gradient-to-t from-indigo-600 to-cyan-400 rounded transition-all duration-300 opacity-80"
                style={{ height: `${blockFillPercent}%` }}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="font-mono text-xs font-bold text-white drop-shadow">
                  {transactions.filter((t) => t.status === "included").length} TXs Packing
                </span>
                <span className="text-[10px] text-indigo-200">
                  Target Ingestion Rate: ~12 tx/sec
                </span>
              </div>
            </div>

            {/* Floating User Transaction Alert */}
            {userPendingCount > 0 && (
              <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-500/20 px-3 py-1 text-xs font-bold text-purple-300 animate-pulse">
                <FiUser className="size-3.5" />
                {userPendingCount} User TX in Mempool
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl border border-white/5 bg-slate-800/40 p-2.5">
              <span className="text-[11px] text-slate-400">Pending Txs</span>
              <span className="block font-mono text-sm font-bold text-white">
                {transactions.length}
              </span>
            </div>
            <div className="rounded-xl border border-white/5 bg-slate-800/40 p-2.5">
              <span className="text-[11px] text-slate-400">Avg Priority Fee</span>
              <span className="block font-mono text-sm font-bold text-indigo-400">
                0.0125 XLM
              </span>
            </div>
            <div className="rounded-xl border border-white/5 bg-slate-800/40 p-2.5">
              <span className="text-[11px] text-slate-400">Est. Inclusion Time</span>
              <span className="block font-mono text-sm font-bold text-emerald-400">
                ~4.2s
              </span>
            </div>
          </div>
        </div>

        {/* Real-Time Fee Density Histogram */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 backdrop-blur-xl flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400">
              Fee Density Histogram
            </span>
            <h3 className="text-base font-bold text-white mb-2">Priority Gas Distribution</h3>
            <p className="text-xs text-slate-400 mb-4">
              Gas bid clusters showing current competitive bidding thresholds.
            </p>

            <div className="flex h-36 items-end gap-2 border-b border-slate-800 pb-2">
              {feeHistogram.map((bin, idx) => (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-mono text-slate-400">{bin.count}</span>
                  <div
                    className={`w-full rounded-t transition-all duration-300 ${bin.color}`}
                    style={{ height: `${Math.max(12, bin.heightPercent)}%` }}
                    title={`${bin.label}: ${bin.count} transactions`}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 text-[10px] text-slate-500 text-center">
            Higher bids skip ahead in candidate block space ordering.
          </div>
        </div>
      </div>

      {/* Unconfirmed Transactions Table */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 backdrop-blur-xl">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-bold text-white">Unconfirmed Transaction Pool</h3>
            <p className="text-xs text-slate-400">
              Transactions currently queued for validation sorted by bid priority.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setFilterUserOnly(!filterUserOnly)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition ${
                filterUserOnly
                  ? "border-purple-500/40 bg-purple-500/20 text-purple-300"
                  : "border-slate-700 bg-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              <FiUser className="size-3.5" />
              My Transactions Only
            </button>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
            >
              <option value="fee">Sort by Gas Fee</option>
              <option value="time">Sort by Age</option>
              <option value="compute">Sort by Compute</option>
            </select>
          </div>
        </div>

        {/* List / Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2.5 px-3">Tx Hash</th>
                <th className="py-2.5 px-3">Sender</th>
                <th className="py-2.5 px-3">Contract Action</th>
                <th className="py-2.5 px-3">Priority Bid</th>
                <th className="py-2.5 px-3">Est. Confirmation</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {displayTransactions.map((tx) => (
                <tr
                  key={tx.hash}
                  className={`transition ${
                    tx.isUserTx
                      ? "bg-purple-950/30 border-l-2 border-purple-500"
                      : "hover:bg-slate-800/40"
                  }`}
                >
                  <td className="py-2.5 px-3 font-semibold text-slate-200">
                    <span className="flex items-center gap-1">
                      {tx.hash}
                      {tx.isUserTx && (
                        <span className="rounded bg-purple-500/20 px-1 text-[10px] text-purple-300 font-sans">
                          You
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-400">{tx.sender}</td>
                  <td className="py-2.5 px-3 text-indigo-300">
                    {tx.functionName}
                  </td>
                  <td className="py-2.5 px-3 font-bold text-emerald-400">
                    {tx.feeXlm} XLM
                  </td>
                  <td className="py-2.5 px-3 text-slate-300">
                    <span className="flex items-center gap-1 text-slate-400">
                      <FiClock className="size-3 text-indigo-400" />
                      ~{tx.estimatedConfirmationSec}s
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-[10px] font-sans font-semibold uppercase ${
                        tx.status === "included"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-amber-500/20 text-amber-300"
                      }`}
                    >
                      {tx.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default MempoolVisualizer;
