"use client";

import React, { useState, useRef, useEffect } from "react";
import { useWallet } from "@/app/context/WalletContext";
import {
  FiChevronDown,
  FiCheck,
  FiPlus,
  FiTrash2,
  FiZap,
  FiTrendingUp,
  FiLayers,
  FiLogOut,
  FiDollarSign,
} from "react-icons/fi";

export function AccountSwitcher() {
  const {
    session,
    status,
    connectedAccounts,
    activeAccount,
    aggregatePortfolio,
    switchAccount,
    addConnectedAccount,
    removeConnectedAccount,
    openConnectModal,
    disconnect,
  } = useWallet();

  const [isOpen, setIsOpen] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const formatAddress = (addr?: string | null) => {
    if (!addr) return "Not Connected";
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  const handleAddAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAddress.trim()) return;
    addConnectedAccount({
      address: newAddress.trim(),
      label: newLabel.trim() || undefined,
      walletType: "manual",
      balanceXlm: 1250.0,
      gasEscrowXlm: 45.0,
      pendingYieldXlm: 3.2,
      activeTaskCount: 2,
    });
    setNewAddress("");
    setNewLabel("");
    setShowAddModal(false);
  };

  if (status !== "connected" || !activeAccount) {
    return (
      <button
        onClick={openConnectModal}
        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-indigo-500"
      >
        <FiZap className="size-4" />
        Connect Wallet
      </button>
    );
  }

  const currentItem = connectedAccounts.find((a) => a.address === activeAccount);

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Active Account Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        data-testid="account-switcher-button"
        className="inline-flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900/80 px-3.5 py-2 text-sm font-medium text-slate-200 shadow-sm backdrop-blur transition hover:border-indigo-500/40 hover:bg-slate-800/80 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <div className="size-2.5 rounded-full bg-emerald-400 animate-pulse" />
        <div className="flex flex-col text-left">
          <span className="text-xs font-semibold text-slate-400">
            {currentItem?.label || "Active Wallet"}
          </span>
          <span className="font-mono text-xs font-bold text-white">
            {formatAddress(activeAccount)}
          </span>
        </div>
        <div className="ml-1 flex items-center gap-1 rounded bg-indigo-500/10 px-2 py-0.5 text-xs font-semibold text-indigo-400">
          <span>{currentItem?.balanceXlm?.toLocaleString() ?? 0} XLM</span>
        </div>
        <FiChevronDown
          className={`size-4 text-slate-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          data-testid="account-switcher-dropdown"
          className="absolute right-0 mt-2 w-96 rounded-2xl border border-slate-800 bg-[#0b1319]/95 p-4 shadow-2xl backdrop-blur-xl z-50 animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Aggregated Portfolio Overview Banner */}
          <div className="mb-4 rounded-xl border border-indigo-500/20 bg-indigo-950/30 p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
                Consolidated Portfolio
              </span>
              <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-bold text-indigo-300">
                {aggregatePortfolio.accountCount} Accounts
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-slate-900/60 p-2">
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <FiDollarSign className="size-3 text-emerald-400" /> Total Balance
                </span>
                <span className="mt-0.5 block font-mono text-sm font-bold text-emerald-400">
                  {aggregatePortfolio.totalBalanceXlm.toLocaleString()} XLM
                </span>
              </div>

              <div className="rounded-lg bg-slate-900/60 p-2">
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <FiZap className="size-3 text-amber-400" /> Gas Escrows
                </span>
                <span className="mt-0.5 block font-mono text-sm font-bold text-amber-300">
                  {aggregatePortfolio.totalGasEscrowXlm.toLocaleString()} XLM
                </span>
              </div>

              <div className="rounded-lg bg-slate-900/60 p-2">
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <FiTrendingUp className="size-3 text-cyan-400" /> Pending Yield
                </span>
                <span className="mt-0.5 block font-mono text-sm font-bold text-cyan-300">
                  +{aggregatePortfolio.totalPendingYieldXlm.toLocaleString()} XLM
                </span>
              </div>

              <div className="rounded-lg bg-slate-900/60 p-2">
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <FiLayers className="size-3 text-indigo-400" /> Active Tasks
                </span>
                <span className="mt-0.5 block font-mono text-sm font-bold text-indigo-300">
                  {aggregatePortfolio.totalActiveTasks} Tasks
                </span>
              </div>
            </div>
          </div>

          {/* Connected Accounts List */}
          <div className="mb-3">
            <span className="mb-2 block text-xs font-semibold text-slate-400">
              Connected Accounts ({connectedAccounts.length})
            </span>

            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {connectedAccounts.map((account) => {
                const isActive = account.address === activeAccount;
                return (
                  <div
                    key={account.address}
                    onClick={() => switchAccount(account.address)}
                    className={`group flex items-center justify-between rounded-xl border p-2.5 transition cursor-pointer ${
                      isActive
                        ? "border-indigo-500/40 bg-indigo-500/10"
                        : "border-white/5 bg-slate-900/40 hover:border-white/10 hover:bg-slate-800/50"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`size-2 rounded-full ${
                          isActive ? "bg-emerald-400" : "bg-slate-600"
                        }`}
                      />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-white">
                            {account.label || formatAddress(account.address)}
                          </span>
                          {isActive && (
                            <span className="rounded bg-emerald-500/20 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-400">
                              Active
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400">
                          {account.balanceXlm.toLocaleString()} XLM • {account.activeTaskCount} tasks
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {isActive ? (
                        <FiCheck className="size-4 text-emerald-400" />
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeConnectedAccount(account.address);
                          }}
                          className="rounded p-1 text-slate-500 opacity-0 transition hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100"
                          title="Remove from portfolio"
                        >
                          <FiTrash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Action Footer */}
          <div className="flex items-center justify-between border-t border-slate-800 pt-3">
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300 transition"
            >
              <FiPlus className="size-3.5" /> Add Account
            </button>

            <button
              onClick={disconnect}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400 hover:text-rose-300 transition"
            >
              <FiLogOut className="size-3.5" /> Disconnect All
            </button>
          </div>
        </div>
      )}

      {/* Add Account Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-base font-bold text-white">Add Connected Account</h3>
            <p className="mt-1 text-xs text-slate-400">
              Track multiple Stellar accounts and aggregate portfolio metrics.
            </p>

            <form onSubmit={handleAddAccount} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300">
                  Account Label (optional)
                </label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. Treasury Ops / DAO Vault"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300">
                  Stellar Address (G...)
                </label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  required
                  placeholder="G..."
                  className="mt-1 w-full font-mono rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 rounded-lg border border-slate-700 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-indigo-600 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
                >
                  Add Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default AccountSwitcher;
