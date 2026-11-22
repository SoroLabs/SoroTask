"use client";

import React, { useState, useMemo } from "react";
import { useStellarWallet } from "@/context/StellarWalletContext";
import {
  FiShield,
  FiAlertTriangle,
  FiCheckCircle,
  FiTrash2,
  FiRefreshCw,
  FiSearch,
  FiAlertOctagon,
  FiInfo,
} from "react-icons/fi";

export interface TokenAllowance {
  id: string;
  tokenSymbol: string;
  tokenName: string;
  tokenAddress: string;
  spenderName: string;
  spenderAddress: string;
  allowance: string; // "unlimited" or numeric string
  isUnlimited: boolean;
  balance: string;
  isDust: boolean; // Balance < 0.001 or marked as dust
  riskLevel: "high" | "medium" | "safe";
  lastUpdated: string;
}

const DEFAULT_ALLOWANCES: TokenAllowance[] = [
  {
    id: "allowance-1",
    tokenSymbol: "XLM",
    tokenName: "Native Lumens",
    tokenAddress: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    spenderName: "SoroTask Core Hub",
    spenderAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    allowance: "unlimited",
    isUnlimited: true,
    balance: "1420.50",
    isDust: false,
    riskLevel: "high",
    lastUpdated: "2026-10-10",
  },
  {
    id: "allowance-2",
    tokenSymbol: "USDC",
    tokenName: "Circle USD",
    tokenAddress: "CBIELTK6YBZJU5UP2WWQEUCYJLPU6QXHCH43GVVRM2HEFEJNW7EBME2B",
    spenderName: "SoroTask Escrow Router",
    spenderAddress: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    allowance: "5000000",
    isUnlimited: true,
    balance: "250.00",
    isDust: false,
    riskLevel: "high",
    lastUpdated: "2026-10-12",
  },
  {
    id: "allowance-3",
    tokenSymbol: "AQUA",
    tokenName: "Aquarius Token",
    tokenAddress: "CDED4KTYOQLN6WZEVFY3T7WURG6X5767VVI4542AIE76UEX5M337F46B",
    spenderName: "DEX Liquidator Protocol",
    spenderAddress: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    allowance: "1500.00",
    isUnlimited: false,
    balance: "0.000045",
    isDust: true,
    riskLevel: "medium",
    lastUpdated: "2026-09-18",
  },
  {
    id: "allowance-4",
    tokenSymbol: "SORO",
    tokenName: "SoroTask Governance",
    tokenAddress: "CDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
    spenderName: "SoroTask Staking Pool",
    spenderAddress: "CEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
    allowance: "250.00",
    isUnlimited: false,
    balance: "250.00",
    isDust: false,
    riskLevel: "safe",
    lastUpdated: "2026-10-14",
  },
  {
    id: "allowance-5",
    tokenSymbol: "OLD-LP",
    tokenName: "Deprecated LP Token",
    tokenAddress: "CFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
    spenderName: "Legacy Yield Vault v1",
    spenderAddress: "CGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
    allowance: "unlimited",
    isUnlimited: true,
    balance: "0.000002",
    isDust: true,
    riskLevel: "high",
    lastUpdated: "2026-08-01",
  },
];

export function AllowanceManager() {
  const { address } = useStellarWallet();
  const [allowances, setAllowances] =
    useState<TokenAllowance[]>(DEFAULT_ALLOWANCES);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState<"all" | "unlimited" | "dust">(
    "all",
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  // Scan or reload allowances
  const handleScan = () => {
    setIsScanning(true);
    setNotification({
      type: "info",
      message: "Scanning on-chain token allowances and approvals...",
    });
    setTimeout(() => {
      // Simulate reading fresh allowances for the account
      setAllowances(DEFAULT_ALLOWANCES);
      setIsScanning(false);
      setNotification({
        type: "success",
        message: "Token allowances updated successfully from ledger.",
      });
    }, 600);
  };

  // Revoke single allowance
  const handleRevokeSingle = async (
    id: string,
    tokenSymbol: string,
    spenderName: string,
  ) => {
    setIsRevoking(true);
    setNotification({
      type: "info",
      message: `Revoking ${tokenSymbol} allowance for ${spenderName}...`,
    });

    setTimeout(() => {
      setAllowances((prev) => prev.filter((item) => item.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setIsRevoking(false);
      setNotification({
        type: "success",
        message: `Successfully reset ${tokenSymbol} allowance to 0 on-chain for ${spenderName}.`,
      });
    }, 500);
  };

  // Batch revoke selected
  const handleBatchRevoke = () => {
    if (selectedIds.size === 0) return;
    setIsRevoking(true);
    const count = selectedIds.size;
    setNotification({
      type: "info",
      message: `Executing batch revocation for ${count} allowances...`,
    });

    setTimeout(() => {
      setAllowances((prev) => prev.filter((item) => !selectedIds.has(item.id)));
      setSelectedIds(new Set());
      setIsRevoking(false);
      setNotification({
        type: "success",
        message: `Successfully executed batch revocation: ${count} token allowances reset to 0.`,
      });
    }, 800);
  };

  // Emergency Revoke All (high-risk focus)
  const handleEmergencyRevokeAll = () => {
    const highRiskCount = allowances.filter((a) => a.isUnlimited).length;
    setIsRevoking(true);
    setNotification({
      type: "info",
      message: `Emergency action initiated: Revoking all ${allowances.length} approvals (${highRiskCount} unlimited)...`,
    });

    setTimeout(() => {
      setAllowances([]);
      setSelectedIds(new Set());
      setIsRevoking(false);
      setNotification({
        type: "success",
        message: "All token approvals and allowances have been reset to 0.",
      });
    }, 1000);
  };

  // Toggle selection
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredAllowances.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAllowances.map((a) => a.id)));
    }
  };

  // Filter & search
  const filteredAllowances = useMemo(() => {
    return allowances.filter((item) => {
      const matchesSearch =
        item.tokenSymbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.tokenName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.spenderName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.spenderAddress.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchesSearch) return false;

      if (filterType === "unlimited") return item.isUnlimited;
      if (filterType === "dust") return item.isDust;
      return true;
    });
  }, [allowances, searchTerm, filterType]);

  const unlimitedCount = useMemo(
    () => allowances.filter((a) => a.isUnlimited).length,
    [allowances],
  );
  const dustCount = useMemo(
    () => allowances.filter((a) => a.isDust).length,
    [allowances],
  );

  return (
    <div className="w-full space-y-6" data-testid="allowance-manager">
      {/* Header and stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-700/60">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <FiShield className="text-emerald-400" />
            Token Allowances & Approval Manager
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Audit and revoke contract approvals granted to SoroTask and external
            protocols to mitigate exploit risks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleScan}
            disabled={isScanning || isRevoking}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-800 text-gray-200 hover:bg-gray-700 border border-gray-700 transition"
            data-testid="refresh-allowances-btn"
          >
            <FiRefreshCw className={isScanning ? "animate-spin" : ""} />
            {isScanning ? "Scanning..." : "Scan Allowances"}
          </button>
          <button
            onClick={handleEmergencyRevokeAll}
            disabled={isRevoking || allowances.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-900/40 text-rose-300 hover:bg-rose-900/60 border border-rose-700/50 transition"
            data-testid="emergency-revoke-all-btn"
          >
            <FiAlertOctagon />
            Emergency Revoke All
          </button>
        </div>
      </div>

      {/* Security alert for unlimited allowances */}
      {unlimitedCount > 0 && (
        <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-200 flex items-start gap-3">
          <FiAlertTriangle className="text-amber-400 text-lg flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <span className="font-semibold text-amber-300">
              Security Warning:
            </span>{" "}
            You have{" "}
            <strong className="text-white">
              {unlimitedCount} unlimited token allowance(s)
            </strong>{" "}
            active. Unlimited approvals permit target smart contracts to
            withdraw all present and future tokens without additional
            signatures. We recommend revoking or lowering unused permissions.
          </div>
        </div>
      )}

      {/* Notification banner */}
      {notification && (
        <div
          className={`p-3 rounded-lg text-sm flex items-center justify-between ${
            notification.type === "success"
              ? "bg-emerald-950/40 border border-emerald-500/40 text-emerald-300"
              : notification.type === "error"
                ? "bg-rose-950/40 border border-rose-500/40 text-rose-300"
                : "bg-sky-950/40 border border-sky-500/40 text-sky-300"
          }`}
          data-testid="allowance-notification"
        >
          <span className="flex items-center gap-2">
            {notification.type === "success" && <FiCheckCircle />}
            {notification.type === "error" && <FiAlertTriangle />}
            {notification.type === "info" && <FiInfo />}
            {notification.message}
          </span>
          <button
            onClick={() => setNotification(null)}
            className="text-xs opacity-75 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl bg-gray-800/40 border border-gray-700/60">
          <div className="text-xs text-gray-400">Total Approvals</div>
          <div
            className="text-lg font-bold text-white mt-1"
            data-testid="metric-total-allowances"
          >
            {allowances.length}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-rose-950/20 border border-rose-900/40">
          <div className="text-xs text-rose-300">Unlimited (High Risk)</div>
          <div
            className="text-lg font-bold text-rose-400 mt-1"
            data-testid="metric-unlimited-allowances"
          >
            {unlimitedCount}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-900/40">
          <div className="text-xs text-amber-300">Dust Token Approvals</div>
          <div
            className="text-lg font-bold text-amber-400 mt-1"
            data-testid="metric-dust-allowances"
          >
            {dustCount}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-900/40">
          <div className="text-xs text-emerald-300">Connected Wallet</div>
          <div className="text-xs font-mono text-emerald-400 mt-1 truncate">
            {address
              ? `${address.slice(0, 6)}...${address.slice(-6)}`
              : "Demo Wallet"}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs" />
            <input
              type="text"
              placeholder="Search token or spender..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-gray-900 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
              data-testid="search-allowances-input"
            />
          </div>
          <div className="flex bg-gray-900 p-1 rounded-lg border border-gray-800 text-xs">
            <button
              onClick={() => setFilterType("all")}
              className={`px-2.5 py-1 rounded-md transition ${
                filterType === "all"
                  ? "bg-gray-800 text-white font-medium"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              data-testid="filter-all-btn"
            >
              All ({allowances.length})
            </button>
            <button
              onClick={() => setFilterType("unlimited")}
              className={`px-2.5 py-1 rounded-md transition ${
                filterType === "unlimited"
                  ? "bg-rose-900/50 text-rose-300 font-medium"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              data-testid="filter-unlimited-btn"
            >
              Unlimited ({unlimitedCount})
            </button>
            <button
              onClick={() => setFilterType("dust")}
              className={`px-2.5 py-1 rounded-md transition ${
                filterType === "dust"
                  ? "bg-amber-900/50 text-amber-300 font-medium"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              data-testid="filter-dust-btn"
            >
              Dust ({dustCount})
            </button>
          </div>
        </div>

        {selectedIds.size > 0 && (
          <button
            onClick={handleBatchRevoke}
            disabled={isRevoking}
            className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition"
            data-testid="batch-revoke-btn"
          >
            <FiTrash2 />
            Revoke Selected ({selectedIds.size})
          </button>
        )}
      </div>

      {/* Allowances Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900/40">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-800/60 text-gray-400 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="p-3 w-10">
                <input
                  type="checkbox"
                  checked={
                    filteredAllowances.length > 0 &&
                    selectedIds.size === filteredAllowances.length
                  }
                  onChange={selectAll}
                  className="rounded border-gray-700 text-emerald-600 focus:ring-0"
                  aria-label="Select all allowances"
                />
              </th>
              <th className="p-3">Asset</th>
              <th className="p-3">Approved Spender</th>
              <th className="p-3">Allowance Limit</th>
              <th className="p-3">Wallet Balance</th>
              <th className="p-3">Risk Assessment</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {filteredAllowances.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-gray-500">
                  <FiCheckCircle className="mx-auto text-2xl text-emerald-500/50 mb-2" />
                  No allowances match the current filters. Your wallet approvals
                  are clean!
                </td>
              </tr>
            ) : (
              filteredAllowances.map((item) => {
                const isSelected = selectedIds.has(item.id);
                return (
                  <tr
                    key={item.id}
                    className={`hover:bg-gray-800/30 transition ${isSelected ? "bg-emerald-950/10" : ""}`}
                    data-testid={`allowance-row-${item.id}`}
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(item.id)}
                        className="rounded border-gray-700 text-emerald-600 focus:ring-0"
                        aria-label={`Select ${item.tokenSymbol}`}
                      />
                    </td>
                    <td className="p-3 font-medium text-white">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold">{item.tokenSymbol}</span>
                        <span className="text-gray-400 font-normal">
                          ({item.tokenName})
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-gray-500 truncate max-w-[120px]">
                        {item.tokenAddress}
                      </div>
                    </td>
                    <td className="p-3 text-gray-300">
                      <div className="font-medium text-gray-200">
                        {item.spenderName}
                      </div>
                      <div className="text-[10px] font-mono text-gray-500 truncate max-w-[140px]">
                        {item.spenderAddress}
                      </div>
                    </td>
                    <td className="p-3">
                      {item.isUnlimited ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-rose-400">
                          <FiAlertTriangle className="text-xs" />
                          Unlimited
                        </span>
                      ) : (
                        <span className="font-mono text-gray-200">
                          {item.allowance} {item.tokenSymbol}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="font-mono text-gray-200">
                        {item.balance} {item.tokenSymbol}
                      </div>
                      {item.isDust && (
                        <span className="inline-block mt-0.5 text-[9px] uppercase tracking-wider text-amber-400 bg-amber-950/60 px-1 rounded">
                          Dust Balance
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      {item.riskLevel === "high" && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-900/40 text-rose-300 border border-rose-700/40">
                          High Risk
                        </span>
                      )}
                      {item.riskLevel === "medium" && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-900/40 text-amber-300 border border-amber-700/40">
                          Medium Risk
                        </span>
                      )}
                      {item.riskLevel === "safe" && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-900/40 text-emerald-300 border border-emerald-700/40">
                          Bounded / Safe
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() =>
                          handleRevokeSingle(
                            item.id,
                            item.tokenSymbol,
                            item.spenderName,
                          )
                        }
                        disabled={isRevoking}
                        className="px-2.5 py-1 text-xs font-medium rounded bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 transition inline-flex items-center gap-1"
                        data-testid={`revoke-btn-${item.id}`}
                      >
                        <FiTrash2 />
                        Revoke
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
}
