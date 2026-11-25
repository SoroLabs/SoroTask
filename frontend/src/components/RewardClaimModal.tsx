"use client";

import React, { useState, useMemo, useCallback } from "react";

export type ClaimableItem = {
  id: string;
  taskId: string;
  contractId: string;
  date: string;
  type: "keeper_reward" | "gas_refund" | "staking_yield";
  amountXlm: number;
  status: "pending" | "claimed";
};

export type RewardClaimModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onClaimSuccess?: (claimedTotal: number, txHash: string) => void;
};

// Canvas-free lightweight SVG confetti particle burst
function ConfettiCelebration() {
  const particles = useMemo(() => {
    const colors = [
      "#10B981",
      "#3B82F6",
      "#F59E0B",
      "#EC4899",
      "#8B5CF6",
      "#14B8A6",
    ];
    return Array.from({ length: 40 }).map((_, i) => ({
      id: i,
      x: (Math.random() - 0.5) * 400,
      y: -Math.random() * 250 - 50,
      rot: Math.random() * 360,
      color: colors[i % colors.length],
      size: Math.random() * 8 + 4,
      delay: Math.random() * 0.2,
    }));
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden flex items-center justify-center">
      <div className="relative">
        {particles.map((p) => (
          <div
            key={p.id}
            className="absolute rounded-sm animate-ping"
            style={{
              width: `${p.size}px`,
              height: `${p.size * 1.5}px`,
              backgroundColor: p.color,
              transform: `translate(${p.x}px, ${p.y}px) rotate(${p.rot}deg)`,
              transition: `all 1s cubic-bezier(0.25, 1, 0.5, 1) ${p.delay}s`,
              opacity: 0.9,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function RewardClaimModal({
  isOpen,
  onClose,
  onClaimSuccess,
}: RewardClaimModalProps) {
  const [items, setItems] = useState<ClaimableItem[]>([
    {
      id: "CLM-001",
      taskId: "task_oracle_feed_9921",
      contractId: "CDLZ...4891",
      date: "2026-10-14",
      type: "keeper_reward",
      amountXlm: 45.5,
      status: "pending",
    },
    {
      id: "CLM-002",
      taskId: "task_liquidity_rebalance_104",
      contractId: "CBMW...9923",
      date: "2026-10-15",
      type: "keeper_reward",
      amountXlm: 68.0,
      status: "pending",
    },
    {
      id: "CLM-003",
      taskId: "task_escrow_timelock_883",
      contractId: "CAQP...1102",
      date: "2026-10-15",
      type: "gas_refund",
      amountXlm: 24.25,
      status: "pending",
    },
    {
      id: "CLM-004",
      taskId: "task_governance_snapshot_402",
      contractId: "CDLZ...4891",
      date: "2026-10-16",
      type: "gas_refund",
      amountXlm: 14.0,
      status: "pending",
    },
    {
      id: "CLM-005",
      taskId: "stake_pool_yield_w42",
      contractId: "CYLD...7719",
      date: "2026-10-16",
      type: "staking_yield",
      amountXlm: 18.8,
      status: "pending",
    },
  ]);

  const [selectedIds, setSelectedIds] = useState<string[]>(
    items.map((it) => it.id),
  );
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [claimCompleted, setClaimCompleted] = useState<boolean>(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const pendingItems = useMemo(
    () => items.filter((it) => it.status === "pending"),
    [items],
  );

  const selectedTotal = useMemo(() => {
    return items
      .filter((it) => selectedIds.includes(it.id) && it.status === "pending")
      .reduce((acc, curr) => acc + curr.amountXlm, 0);
  }, [items, selectedIds]);

  const keeperRewardsTotal = useMemo(
    () =>
      items
        .filter((it) => it.type === "keeper_reward" && it.status === "pending")
        .reduce((acc, c) => acc + c.amountXlm, 0),
    [items],
  );

  const gasRefundsTotal = useMemo(
    () =>
      items
        .filter((it) => it.type === "gas_refund" && it.status === "pending")
        .reduce((acc, c) => acc + c.amountXlm, 0),
    [items],
  );

  const stakingYieldTotal = useMemo(
    () =>
      items
        .filter((it) => it.type === "staking_yield" && it.status === "pending")
        .reduce((acc, c) => acc + c.amountXlm, 0),
    [items],
  );

  const toggleSelectAll = () => {
    if (selectedIds.length === pendingItems.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(pendingItems.map((it) => it.id));
    }
  };

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((i) => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleBatchClaim = useCallback(async () => {
    if (selectedTotal <= 0) return;
    setIsSubmitting(true);

    try {
      // Simulate atomic multi-contract batch claim transaction
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const simulatedTxHash = `tx_batch_claim_${Date.now().toString(16)}_99b7f`;

      setItems((prev) =>
        prev.map((it) =>
          selectedIds.includes(it.id) ? { ...it, status: "claimed" } : it,
        ),
      );

      setLastTxHash(simulatedTxHash);
      setClaimCompleted(true);
      onClaimSuccess?.(selectedTotal, simulatedTxHash);
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedTotal, selectedIds, onClaimSuccess]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-100 shadow-2xl">
        {claimCompleted && <ConfettiCelebration />}

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-xl font-bold">
              Reward & Gas Refund Claims Dashboard
            </h2>
            <p className="text-xs text-slate-400">
              One-click batch claims across keeper rewards, gas refunds, and
              staking yield.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Aggregate Balances Cards */}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3.5">
            <span className="text-[11px] font-semibold text-blue-300 block">
              Keeper Rewards
            </span>
            <span className="text-lg font-bold font-mono text-white">
              {keeperRewardsTotal.toFixed(2)} XLM
            </span>
          </div>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5">
            <span className="text-[11px] font-semibold text-emerald-300 block">
              Gas Refunds
            </span>
            <span className="text-lg font-bold font-mono text-white">
              {gasRefundsTotal.toFixed(2)} XLM
            </span>
          </div>
          <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-3.5">
            <span className="text-[11px] font-semibold text-purple-300 block">
              Staking Accrual
            </span>
            <span className="text-lg font-bold font-mono text-white">
              {stakingYieldTotal.toFixed(2)} XLM
            </span>
          </div>
        </div>

        {/* Claim Success Banner with Confetti notice */}
        {claimCompleted && lastTxHash && (
          <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/15 p-4 text-xs text-emerald-200">
            <div className="font-bold text-sm flex items-center gap-2 mb-1">
              <span>🎉</span> Batch Claim Confirmed!
            </div>
            <p>
              Successfully transferred rewards to your connected wallet in a
              single atomic transaction.
            </p>
            <div className="mt-2 font-mono text-[11px] text-emerald-300 break-all">
              Tx: {lastTxHash}
            </div>
          </div>
        )}

        {/* Itemized Table */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>
              Itemized Breakdown ({pendingItems.length} claimable items)
            </span>
            <button
              type="button"
              onClick={toggleSelectAll}
              className="text-blue-400 hover:underline"
            >
              {selectedIds.length === pendingItems.length
                ? "Deselect All"
                : "Select All"}
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 divide-y divide-slate-800/80">
            {items.map((item) => {
              const isSelected = selectedIds.includes(item.id);
              return (
                <div
                  key={item.id}
                  className={`flex items-center justify-between p-3 text-xs transition ${
                    item.status === "claimed"
                      ? "opacity-40 bg-slate-900/40"
                      : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected && item.status === "pending"}
                      disabled={item.status === "claimed"}
                      onChange={() => toggleSelect(item.id)}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-0"
                    />
                    <div>
                      <div className="font-mono text-slate-200 font-semibold">
                        {item.taskId}
                      </div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-2">
                        <span>{item.date}</span>
                        <span>•</span>
                        <span>{item.contractId}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="font-mono font-bold text-slate-100 block">
                      +{item.amountXlm.toFixed(2)} XLM
                    </span>
                    <span
                      className={`text-[10px] capitalize ${
                        item.status === "claimed"
                          ? "text-slate-500"
                          : item.type === "keeper_reward"
                            ? "text-blue-400"
                            : item.type === "gas_refund"
                              ? "text-emerald-400"
                              : "text-purple-400"
                      }`}
                    >
                      {item.status === "claimed"
                        ? "Claimed"
                        : item.type.replace("_", " ")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Modal Actions */}
        <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-800 pt-4">
          <div className="text-xs text-slate-400">
            Total Selected:{" "}
            <span className="font-mono font-bold text-emerald-400 text-sm">
              {selectedTotal.toFixed(2)} XLM
            </span>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
            >
              {claimCompleted ? "Close" : "Cancel"}
            </button>

            {!claimCompleted && (
              <button
                type="button"
                onClick={handleBatchClaim}
                disabled={isSubmitting || selectedTotal <= 0}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {isSubmitting
                  ? "Executing Batch Claim..."
                  : `Claim ${selectedTotal.toFixed(2)} XLM`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
