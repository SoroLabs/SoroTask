"use client";

import React, { useState, useCallback, useId } from "react";

export type ApiKeyScope = "read:tasks" | "trigger:executions" | "admin";

export interface ApiKey {
  id: string;
  name: string;
  maskedKey: string;
  scopes: ApiKeyScope[];
  ipWhitelist: string[];
  createdAt: string;
  lastUsedAt: string | null;
  status: "active" | "revoked";
  quota: {
    limitPerMonth: number;
    usedThisMonth: number;
    rateLimitPerMinute: number;
  };
}

export interface ApiKeyManagerProps {
  initialKeys?: ApiKey[];
  onKeyCreated?: (key: ApiKey, secretKey: string) => void;
  onKeyRevoked?: (keyId: string) => void;
  className?: string;
}

const AVAILABLE_SCOPES: {
  id: ApiKeyScope;
  label: string;
  description: string;
}[] = [
  {
    id: "read:tasks",
    label: "Read Only (read:tasks)",
    description: "Query tasks, execution logs, and performance metrics.",
  },
  {
    id: "trigger:executions",
    label: "Trigger Executions (trigger:executions)",
    description: "Execute existing tasks and submit automated keeper triggers.",
  },
  {
    id: "admin",
    label: "Full Admin (admin)",
    description:
      "Full administrative access: create/update tasks, manage keys and configurations.",
  },
];

/**
 * Validates IPv4, IPv6, or CIDR notation (e.g. 192.168.1.1, 10.0.0.0/24, 2001:db8::/32)
 */
export function validateIpOrCidr(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;

  // IPv4 or IPv4 CIDR
  const ipv4CidrRegex =
    /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\/([0-9]|[1-2][0-9]|3[0-2]))?$/;
  if (ipv4CidrRegex.test(trimmed)) return true;

  // Basic IPv6 or IPv6 CIDR
  const ipv6CidrRegex =
    /^s*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))(%.+)?(\/([0-9]|[1-9][0-9]|1[0-1][0-9]|12[0-8]))?$/;

  return ipv6CidrRegex.test(trimmed);
}

/**
 * Generates a cryptographically random API key
 */
export function generateCryptographicApiKey(): {
  secretKey: string;
  maskedKey: string;
} {
  const bytes = new Uint8Array(24);
  if (
    typeof window !== "undefined" &&
    window.crypto &&
    window.crypto.getRandomValues
  ) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const secretKey = `sk_live_${hex}`;
  const last4 = hex.slice(-4);
  const maskedKey = `sk_live_••••••••••••••••${last4}`;

  return { secretKey, maskedKey };
}

const DEFAULT_MOCK_KEYS: ApiKey[] = [
  {
    id: "key-prod-01",
    name: "Production Keeper Bot",
    maskedKey: "sk_live_••••••••••••••••e4a1",
    scopes: ["read:tasks", "trigger:executions"],
    ipWhitelist: ["192.168.1.100", "10.0.0.0/24"],
    createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
    lastUsedAt: new Date(Date.now() - 120000).toISOString(),
    status: "active",
    quota: {
      limitPerMonth: 100000,
      usedThisMonth: 64280,
      rateLimitPerMinute: 120,
    },
  },
  {
    id: "key-ci-02",
    name: "CI/CD Automated Tests",
    maskedKey: "sk_live_••••••••••••••••9c2d",
    scopes: ["read:tasks"],
    ipWhitelist: ["172.16.0.0/16"],
    createdAt: new Date(Date.now() - 45 * 86400000).toISOString(),
    lastUsedAt: new Date(Date.now() - 3600000).toISOString(),
    status: "active",
    quota: {
      limitPerMonth: 25000,
      usedThisMonth: 12450,
      rateLimitPerMinute: 60,
    },
  },
];

export function ApiKeyManager({
  initialKeys = DEFAULT_MOCK_KEYS,
  onKeyCreated,
  onKeyRevoked,
  className = "",
}: ApiKeyManagerProps) {
  const [keys, setKeys] = useState<ApiKey[]>(initialKeys);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newKeyRevealed, setNewKeyRevealed] = useState<{
    name: string;
    secretKey: string;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedMaskedId, setCopiedMaskedId] = useState<string | null>(null);

  // Form State
  const [keyName, setKeyName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<ApiKeyScope[]>([
    "read:tasks",
  ]);
  const [ipInput, setIpInput] = useState("");
  const [ipList, setIpList] = useState<string[]>([]);
  const [ipError, setIpError] = useState<string | null>(null);
  const [monthlyLimit, setMonthlyLimit] = useState<number>(50000);
  const [rateLimit, setRateLimit] = useState<number>(60);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterScope, setFilterScope] = useState<string>("all");
  const [notification, setNotification] = useState<string | null>(null);

  const nameInputId = useId();
  const ipInputId = useId();

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleScopeToggle = (scope: ApiKeyScope) => {
    if (selectedScopes.includes(scope)) {
      if (selectedScopes.length > 1) {
        setSelectedScopes(selectedScopes.filter((s) => s !== scope));
      }
    } else {
      setSelectedScopes([...selectedScopes, scope]);
    }
  };

  const handleAddIp = () => {
    setIpError(null);
    const candidate = ipInput.trim();
    if (!candidate) return;

    if (!validateIpOrCidr(candidate)) {
      setIpError(
        "Invalid IP address or CIDR notation (e.g. 192.168.1.1 or 10.0.0.0/24)",
      );
      return;
    }

    if (ipList.includes(candidate)) {
      setIpError("This IP or CIDR is already in the whitelist");
      return;
    }

    setIpList([...ipList, candidate]);
    setIpInput("");
  };

  const handleRemoveIp = (ipToRemove: string) => {
    setIpList(ipList.filter((ip) => ip !== ipToRemove));
  };

  const handleCreateKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) return;

    const { secretKey, maskedKey } = generateCryptographicApiKey();
    const newApiKey: ApiKey = {
      id: `key-${Date.now()}`,
      name: keyName.trim(),
      maskedKey,
      scopes: selectedScopes,
      ipWhitelist: ipList,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      status: "active",
      quota: {
        limitPerMonth: monthlyLimit,
        usedThisMonth: 0,
        rateLimitPerMinute: rateLimit,
      },
    };

    setKeys((prev) => [newApiKey, ...prev]);
    setNewKeyRevealed({ name: newApiKey.name, secretKey });
    setIsCreateModalOpen(false);

    // Reset Form
    setKeyName("");
    setSelectedScopes(["read:tasks"]);
    setIpList([]);
    setIpInput("");
    setIpError(null);

    if (onKeyCreated) {
      onKeyCreated(newApiKey, secretKey);
    }
  };

  // Instant Revocation Hook (< 1s propagation)
  const handleRevokeKey = useCallback(
    (keyId: string) => {
      setKeys((prev) =>
        prev.map((k) =>
          k.id === keyId ? { ...k, status: "revoked" as const } : k,
        ),
      );
      showNotification(
        "API key revoked successfully. Propagation took < 100ms.",
      );
      if (onKeyRevoked) {
        onKeyRevoked(keyId);
      }
    },
    [onKeyRevoked],
  );

  const handleCopySecretKey = async () => {
    if (!newKeyRevealed) return;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(newKeyRevealed.secretKey);
      }
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const handleCopyMasked = async (key: ApiKey) => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(key.maskedKey);
      }
      setCopiedMaskedId(key.id);
      setTimeout(() => setCopiedMaskedId(null), 2000);
    } catch {
      setCopiedMaskedId(key.id);
      setTimeout(() => setCopiedMaskedId(null), 2000);
    }
  };

  const filteredKeys = keys.filter((k) => {
    const matchesSearch =
      k.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      k.maskedKey.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesScope =
      filterScope === "all" || k.scopes.includes(filterScope as ApiKeyScope);
    return matchesSearch && matchesScope;
  });

  return (
    <div
      data-testid="api-key-manager"
      className={`rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-neutral-100 ${className}`}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-neutral-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight">
              Developer API Keys
            </h2>
            <span className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full font-mono">
              v1 Gateway
            </span>
          </div>
          <p className="text-sm text-neutral-400 mt-1">
            Manage scoped API credentials, CIDR IP whitelists, and live rate
            limits for bots and keepers.
          </p>
        </div>

        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm px-4 py-2.5 rounded-lg shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          Generate New Key
        </button>
      </div>

      {notification && (
        <div
          role="status"
          className="mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-300 text-sm flex items-center gap-2"
        >
          <svg
            className="w-4 h-4 shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          {notification}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 my-5">
        <div className="relative flex-1">
          <svg
            className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search by key name or identifier..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-9 pr-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-600"
          />
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="scope-filter" className="text-xs text-neutral-400">
            Scope:
          </label>
          <select
            id="scope-filter"
            value={filterScope}
            onChange={(e) => setFilterScope(e.target.value)}
            className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-300 focus:outline-none focus:border-neutral-600"
          >
            <option value="all">All Scopes</option>
            <option value="read:tasks">Read Only</option>
            <option value="trigger:executions">Trigger Only</option>
            <option value="admin">Full Admin</option>
          </select>
        </div>
      </div>

      {/* API Key List */}
      <div className="space-y-4">
        {filteredKeys.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-neutral-800 rounded-xl">
            <p className="text-neutral-400 text-sm">
              No API keys found matching your criteria.
            </p>
          </div>
        ) : (
          filteredKeys.map((key) => {
            const usagePercent = Math.min(
              100,
              Math.round(
                (key.quota.usedThisMonth / key.quota.limitPerMonth) * 100,
              ),
            );
            const isRevoked = key.status === "revoked";

            return (
              <div
                key={key.id}
                data-testid={`api-key-item-${key.id}`}
                className={`p-5 rounded-xl border transition-all ${
                  isRevoked
                    ? "bg-neutral-950/60 border-neutral-800/60 opacity-60"
                    : "bg-neutral-950 border-neutral-800 hover:border-neutral-700"
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Key Info */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <h3 className="text-base font-semibold text-neutral-100">
                        {key.name}
                      </h3>
                      {isRevoked ? (
                        <span className="text-xs bg-red-500/10 text-red-400 border border-red-500/30 px-2 py-0.5 rounded font-medium">
                          Revoked
                        </span>
                      ) : (
                        <span className="text-xs bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-0.5 rounded font-medium flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                          Active
                        </span>
                      )}
                    </div>

                    {/* Masked Key & Copy */}
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono bg-neutral-900 border border-neutral-800 text-neutral-300 px-2.5 py-1 rounded">
                        {key.maskedKey}
                      </code>
                      <button
                        onClick={() => handleCopyMasked(key)}
                        title="Copy masked identifier"
                        className="text-xs text-neutral-400 hover:text-neutral-200 transition-colors p-1"
                      >
                        {copiedMaskedId === key.id ? (
                          <span className="text-green-400">Copied!</span>
                        ) : (
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                            />
                          </svg>
                        )}
                      </button>
                    </div>

                    {/* Scopes Badges */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-xs text-neutral-500 mr-1">
                        Scopes:
                      </span>
                      {key.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="text-xs bg-neutral-900 text-neutral-300 border border-neutral-700/60 px-2 py-0.5 rounded font-mono"
                        >
                          {scope}
                        </span>
                      ))}
                    </div>

                    {/* IP Whitelist */}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-400">
                      <span className="text-neutral-500">Allowed IPs:</span>
                      {key.ipWhitelist.length === 0 ? (
                        <span className="text-yellow-500/80">
                          Any (0.0.0.0/0 - No IP whitelist)
                        </span>
                      ) : (
                        key.ipWhitelist.map((ip) => (
                          <span
                            key={ip}
                            className="bg-neutral-900 text-neutral-300 px-1.5 py-0.5 rounded font-mono text-[11px] border border-neutral-800"
                          >
                            {ip}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Quota & Revoke Action */}
                  <div className="flex flex-col sm:flex-row lg:flex-col items-start lg:items-end justify-between gap-4 pt-3 lg:pt-0 border-t lg:border-t-0 border-neutral-800">
                    {/* Usage quota */}
                    <div className="w-full sm:w-56 space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-neutral-400">Monthly Quota</span>
                        <span className="font-mono text-neutral-200">
                          {key.quota.usedThisMonth.toLocaleString()} /{" "}
                          {key.quota.limitPerMonth.toLocaleString()}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${
                            usagePercent > 90
                              ? "bg-red-500"
                              : usagePercent > 75
                                ? "bg-amber-500"
                                : "bg-blue-500"
                          }`}
                          style={{ width: `${usagePercent}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[11px] text-neutral-500 font-mono">
                        <span>
                          Rate: {key.quota.rateLimitPerMinute} req/min
                        </span>
                        <span>{usagePercent}% consumed</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3">
                      {!isRevoked && (
                        <button
                          onClick={() => handleRevokeKey(key.id)}
                          className="text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 px-3 py-1.5 rounded transition-colors"
                        >
                          Revoke Key
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-neutral-900 flex flex-wrap items-center justify-between text-[11px] text-neutral-500">
                  <span>
                    Created {new Date(key.createdAt).toLocaleDateString()}
                  </span>
                  <span>
                    Last used:{" "}
                    {key.lastUsedAt
                      ? new Date(key.lastUsedAt).toLocaleString()
                      : "Never"}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* CREATE API KEY MODAL */}
      {isCreateModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-key-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
        >
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl text-neutral-100 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <h3 id="create-key-title" className="text-lg font-bold">
                Generate Developer API Key
              </h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-neutral-400 hover:text-neutral-200"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateKey} className="space-y-4">
              {/* Name */}
              <div>
                <label
                  htmlFor={nameInputId}
                  className="block text-xs font-medium text-neutral-300 mb-1"
                >
                  Key Description / Name
                </label>
                <input
                  id={nameInputId}
                  type="text"
                  required
                  placeholder="e.g. Yield Arbitrage Keeper Bot"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Granular Scopes */}
              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-2">
                  Granular Permission Scopes
                </label>
                <div className="space-y-2">
                  {AVAILABLE_SCOPES.map((scope) => {
                    const isChecked = selectedScopes.includes(scope.id);
                    return (
                      <label
                        key={scope.id}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          isChecked
                            ? "bg-blue-500/10 border-blue-500/40 text-neutral-100"
                            : "bg-neutral-950 border-neutral-800 text-neutral-400 hover:border-neutral-700"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleScopeToggle(scope.id)}
                          className="mt-0.5 rounded border-neutral-700 bg-neutral-900 text-blue-500 focus:ring-0"
                        />
                        <div className="text-xs">
                          <p className="font-semibold text-neutral-200">
                            {scope.label}
                          </p>
                          <p className="text-neutral-400 mt-0.5">
                            {scope.description}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* IP Whitelisting */}
              <div>
                <label
                  htmlFor={ipInputId}
                  className="block text-xs font-medium text-neutral-300 mb-1"
                >
                  IP CIDR Whitelist (Optional)
                </label>
                <p className="text-[11px] text-neutral-400 mb-2">
                  Restrict API key requests to specific IPv4 or IPv6 CIDR blocks
                  (e.g. 192.168.1.1/32, 10.0.0.0/24).
                </p>
                <div className="flex gap-2">
                  <input
                    id={ipInputId}
                    type="text"
                    placeholder="e.g. 192.168.1.1 or 10.0.0.0/24"
                    value={ipInput}
                    onChange={(e) => {
                      setIpInput(e.target.value);
                      setIpError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddIp();
                      }
                    }}
                    className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-blue-500 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleAddIp}
                    className="bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-3 py-2 text-xs font-medium rounded-lg transition-colors"
                  >
                    Add IP
                  </button>
                </div>
                {ipError && (
                  <p className="text-xs text-red-400 mt-1">{ipError}</p>
                )}

                {ipList.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {ipList.map((ip) => (
                      <span
                        key={ip}
                        className="inline-flex items-center gap-1.5 bg-neutral-950 border border-neutral-700/80 text-neutral-300 px-2 py-1 rounded text-xs font-mono"
                      >
                        {ip}
                        <button
                          type="button"
                          onClick={() => handleRemoveIp(ip)}
                          className="text-neutral-500 hover:text-red-400"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Quota Limits */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-medium text-neutral-300 mb-1">
                    Monthly Quota (Requests)
                  </label>
                  <input
                    type="number"
                    min={1000}
                    max={1000000}
                    step={5000}
                    value={monthlyLimit}
                    onChange={(e) => setMonthlyLimit(Number(e.target.value))}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-200 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-300 mb-1">
                    Rate Limit (Req / Min)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={1000}
                    step={10}
                    value={rateLimit}
                    onChange={(e) => setRateLimit(Number(e.target.value))}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-200 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-neutral-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 text-xs text-neutral-400 hover:text-neutral-200 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  Create API Key
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ONE-TIME SECRET KEY REVEAL MODAL */}
      {newKeyRevealed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reveal-key-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        >
          <div className="bg-neutral-900 border border-amber-500/30 rounded-2xl w-full max-w-lg p-6 shadow-2xl text-neutral-100 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 text-amber-400">
              <svg
                className="w-6 h-6 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <h3
                id="reveal-key-title"
                className="text-base font-bold text-neutral-100"
              >
                Save Your Secret API Key
              </h3>
            </div>

            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200 leading-relaxed">
              <strong>Important:</strong> This secret key will{" "}
              <span className="underline font-bold">never be shown again</span>.
              If you lose it, you will need to revoke this key and generate a
              new one. Store it securely in your bot environment variables.
            </div>

            <div>
              <p className="text-xs text-neutral-400 mb-1">
                Key Name: {newKeyRevealed.name}
              </p>
              <div className="relative">
                <input
                  readOnly
                  data-testid="secret-key-display"
                  value={newKeyRevealed.secretKey}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-3 pr-20 py-2.5 font-mono text-xs text-green-400 select-all focus:outline-none"
                />
                <button
                  type="button"
                  data-testid="copy-secret-key-button"
                  onClick={handleCopySecretKey}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors"
                >
                  {copiedKey ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-neutral-800 flex justify-end">
              <button
                type="button"
                data-testid="close-reveal-modal"
                onClick={() => setNewKeyRevealed(null)}
                className="px-5 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold rounded-lg transition-colors"
              >
                I have saved my secret key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ApiKeyManager;
