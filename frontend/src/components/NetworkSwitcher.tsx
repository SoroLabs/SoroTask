"use client";

import React, { useState } from "react";
import { useNetworkStore } from "@/src/lib/network/networkStore";
import { NetworkType, NETWORK_CONFIGS } from "@/src/lib/network/types";
import { FiGlobe, FiCheckCircle, FiAlertCircle, FiRefreshCw } from "react-icons/fi";

export function NetworkSwitcher() {
  const {
    currentNetwork,
    config,
    activeRpcUrl,
    activeContractId,
    walletSynced,
    isSwitching,
    syncPromptRequired,
    switchNetwork,
    promptWalletNetworkSync,
  } = useNetworkStore();

  const [isOpen, setIsOpen] = useState(false);

  const handleSelectNetwork = async (network: NetworkType) => {
    setIsOpen(false);
    await switchNetwork(network, { clearCaches: true });
  };

  const getBadgeColor = (net: NetworkType) => {
    switch (net) {
      case "standalone":
        return "bg-amber-500/10 text-amber-400 border-amber-500/30";
      case "testnet":
        return "bg-blue-500/10 text-blue-400 border-blue-500/30";
      case "mainnet":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
      default:
        return "bg-slate-500/10 text-slate-400 border-slate-500/30";
    }
  };

  return (
    <div className="relative inline-block text-left" data-testid="network-switcher-container">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={isSwitching}
          className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold shadow-sm transition-all focus:outline-none ${getBadgeColor(
            currentNetwork
          )}`}
          aria-haspopup="true"
          aria-expanded={isOpen}
        >
          <FiGlobe className={isSwitching ? "animate-spin" : ""} />
          <span className="capitalize">{config.name}</span>
          <span className="text-[10px] font-mono opacity-70">({currentNetwork})</span>
        </button>

        {syncPromptRequired && (
          <button
            type="button"
            onClick={() => promptWalletNetworkSync()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/20 px-3 py-2 text-xs font-medium text-amber-300 hover:bg-amber-500/30 transition"
          >
            <FiAlertCircle />
            Sync Wallet
          </button>
        )}

        {walletSynced && !syncPromptRequired && (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
            <FiCheckCircle /> Synced
          </span>
        )}
      </div>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-2 w-72 origin-top-right rounded-2xl border border-white/10 bg-slate-900/95 p-3 shadow-2xl backdrop-blur-md">
          <div className="mb-2 px-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            Select Soroban Network
          </div>

          <div className="space-y-1">
            {(Object.keys(NETWORK_CONFIGS) as NetworkType[]).map((net) => {
              const item = NETWORK_CONFIGS[net];
              const isSelected = currentNetwork === net;

              return (
                <button
                  key={net}
                  onClick={() => handleSelectNetwork(net)}
                  className={`flex w-full flex-col gap-1 rounded-xl p-2.5 text-left transition-colors ${
                    isSelected
                      ? "bg-white/10 text-white font-medium"
                      : "text-slate-300 hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">{item.name}</span>
                    {isSelected && <FiCheckCircle className="text-emerald-400" />}
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 truncate">
                    RPC: {item.rpcUrl}
                  </span>
                  <span className="text-[10px] font-mono text-slate-500 truncate">
                    Contract: {item.contractId.slice(0, 10)}...{item.contractId.slice(-6)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 border-t border-white/10 pt-2 px-2 text-[10px] text-slate-400 flex items-center justify-between">
            <span>Cache Isolation Active</span>
            <span className="font-mono text-emerald-400">Partitioned</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default NetworkSwitcher;
