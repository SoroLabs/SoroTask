/**
 * Client-Side Cryptographic Audit Log & Verified Action Ledger (issue #1480 / #1267)
 *
 * Protected admin page rendering the signed, hash-chained activity ledger:
 * every administrative and automation action (task parameter modifications,
 * pause/resume, withdrawals, permission rotations) is appended with the acting
 * wallet address, timestamp, SHA-256 hash chain, and an ECDSA signature proof
 * made by a non-extractable WebCrypto key.
 *
 * Supports:
 * - Tamper-evident verification detecting any altered record
 * - On-chain cryptographic anchor verification
 * - RFC 4180 compliant CSV export
 * - W3C JSON-LD standard export
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { withRouteGuard } from '@/lib/routeGuards';
import {
  appendAuditEntry,
  downloadAuditExport,
  exportAuditCsv,
  exportAuditJson,
  exportAuditJsonLd,
  loadAuditLedger,
  verifyAuditLedger,
  createOnChainAnchor,
  saveAuditAnchor,
  getLatestAnchor,
  tamperAuditEntry,
  clearAuditLedger,
  type SignedAuditLogEntry,
  type OnChainAuditAnchor,
} from '@/src/lib/auditLedger';
import type { AuditLogFilterOptions } from '@/app/types/auditLog';
import { useAuth } from '@/context/AuthContext';

function severityTone(severity: SignedAuditLogEntry['severity']): string {
  switch (severity) {
    case 'critical':
      return 'bg-rose-500/15 text-rose-700 border-rose-300';
    case 'warning':
      return 'bg-amber-500/15 text-amber-700 border-amber-300';
    default:
      return 'bg-emerald-500/15 text-emerald-700 border-emerald-300';
  }
}

function AuditPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<SignedAuditLogEntry[]>([]);
  const [latestAnchor, setLatestAnchor] = useState<OnChainAuditAnchor | null>(null);
  const [filters, setFilters] = useState<AuditLogFilterOptions>({
    searchQuery: '',
    severityFilter: 'all',
  });
  const [verification, setVerification] = useState<{
    label: string;
    valid: boolean | null;
    detail?: string;
    anchored?: boolean;
    anchorTx?: string;
  }>({ label: 'Not verified yet', valid: null });
  const [actionInput, setActionInput] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<'custom' | 'pause' | 'resume' | 'params' | 'withdraw'>('custom');
  const [isRecording, setIsRecording] = useState(false);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (typeof window === 'undefined') return;
    const loaded = loadAuditLedger(window.localStorage);
    setEntries(loaded);
    setLatestAnchor(getLatestAnchor(window.localStorage));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const actor = user?.address ?? 'GADMIN_LOCAL_WALLET';

  const recordAction = async (customAction?: string, customSeverity?: SignedAuditLogEntry['severity']) => {
    const action = (customAction ?? actionInput).trim();
    if (!action) return;
    setIsRecording(true);
    try {
      await appendAuditEntry(
        {
          action,
          actor,
          payload: {
            source: 'admin-audit-ledger',
            preset: selectedPreset,
            recordedAtIso: new Date().toISOString(),
          },
          severity: customSeverity ?? (selectedPreset === 'pause' ? 'warning' : selectedPreset === 'withdraw' ? 'critical' : 'info'),
        },
        { storage: window.localStorage },
      );
      setActionInput('');
      setSelectedPreset('custom');
      setVerification({ label: 'Not verified yet', valid: null });
      refresh();
    } finally {
      setIsRecording(false);
    }
  };

  const handlePresetSelect = (preset: 'pause' | 'resume' | 'params' | 'withdraw') => {
    setSelectedPreset(preset);
    switch (preset) {
      case 'pause':
        setActionInput('task:paused — High-value arbitrage automation paused for risk compliance review');
        break;
      case 'resume':
        setActionInput('task:resumed — High-value arbitrage automation resumed after compliance approval');
        break;
      case 'params':
        setActionInput('task:modified — Updated gas ceiling to 75000 stroops and execution window to 60s');
        break;
      case 'withdraw':
        setActionInput('treasury:withdrawal — Initiated multi-sig liquidity rebalancing withdrawal');
        break;
    }
  };

  const verify = async () => {
    if (typeof window === 'undefined') return;
    const current = loadAuditLedger(window.localStorage);
    if (current.length === 0) {
      setVerification({
        label: 'Ledger is empty — no entries to verify',
        valid: null,
      });
      return;
    }

    const result = await verifyAuditLedger(current, globalThis.crypto, {
      storage: window.localStorage,
    });

    if (result.valid) {
      setVerification({
        label: `Ledger verified — ${current.length} entries cryptographically intact`,
        valid: true,
        anchored: result.anchored,
        anchorTx: result.anchorTxHash,
        detail: result.anchored
          ? `Cryptographic anchor verified on Soroban (${result.anchorTxHash?.slice(0, 14)}…)`
          : 'All SHA-256 hash chains and WebCrypto ECDSA signatures valid',
      });
    } else {
      setVerification({
        label: `Verification FAILED at entry #${result.brokenAt ?? '?'}`,
        valid: false,
        detail: result.reason ?? 'Tamper detected in cryptographic proof',
      });
    }
  };

  const handleAnchorOnChain = () => {
    if (typeof window === 'undefined' || entries.length === 0) return;
    const anchor = createOnChainAnchor(entries, {
      network: 'futurenet',
      contractAddress: 'CAUDIT_LEDGER_ANCHOR_V1',
    });
    saveAuditAnchor(anchor, window.localStorage);
    setLatestAnchor(anchor);
    verify();
  };

  const handleSimulateTamper = () => {
    if (typeof window === 'undefined' || entries.length === 0) return;
    // Tamper with the earliest entry's payload
    tamperAuditEntry(0, { action: 'UNAUTHORIZED_TAMPERED_ACTION_DATA' }, window.localStorage);
    refresh();
    verify();
  };

  const handleResetLedger = () => {
    if (typeof window === 'undefined') return;
    if (window.confirm('Reset local audit ledger and anchors? This cannot be undone.')) {
      clearAuditLedger(window.localStorage);
      setVerification({ label: 'Ledger reset', valid: null });
      refresh();
    }
  };

  const exportCsv = () => {
    if (typeof window === 'undefined') return;
    const csvData = exportAuditCsv(loadAuditLedger(window.localStorage));
    downloadAuditExport(
      csvData,
      `sorotask-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      'text/csv;charset=utf-8',
    );
  };

  const exportJsonLd = () => {
    if (typeof window === 'undefined') return;
    const current = loadAuditLedger(window.localStorage);
    const jsonLdData = exportAuditJsonLd(current, {
      anchor: latestAnchor,
      issuer: `urn:stellar:address:${actor}`,
    });
    downloadAuditExport(
      jsonLdData,
      `sorotask-audit-${new Date().toISOString().slice(0, 10)}.jsonld`,
      'application/ld+json',
    );
  };

  const exportJson = () => {
    if (typeof window === 'undefined') return;
    const jsonData = exportAuditJson(loadAuditLedger(window.localStorage));
    downloadAuditExport(
      jsonData,
      `sorotask-audit-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
    );
  };

  const filteredEntries = entries.filter((entry) => {
    if (
      filters.severityFilter !== 'all' &&
      entry.severity !== filters.severityFilter
    ) {
      return false;
    }
    if (!filters.searchQuery) return true;
    const query = filters.searchQuery.toLowerCase();
    return (
      entry.action.toLowerCase().includes(query) ||
      entry.actor.toLowerCase().includes(query) ||
      entry.payloadHash.toLowerCase().includes(query)
    );
  });

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-neutral-900">
                Client Cryptographic Audit Trail
              </h1>
              <p className="mt-1 text-sm text-neutral-600">
                Tamper-evident client action ledger with non-extractable WebCrypto ECDSA
                signatures, SHA-256 hash chains, on-chain anchor verification, and RFC 4180 / JSON-LD export.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs text-slate-700">
                Acting Wallet: <strong className="text-slate-900">{actor}</strong>
              </span>
            </div>
          </div>
        </header>

        {/* Action Recording Panel */}
        <section className="mb-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
            Log Verified Automation Action
          </h2>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <span className="self-center font-medium text-neutral-500">Quick presets:</span>
            <button
              type="button"
              onClick={() => handlePresetSelect('pause')}
              className="rounded-md border border-neutral-300 bg-neutral-50 px-2.5 py-1 text-neutral-700 hover:bg-neutral-100"
            >
              Pause High-Value Task
            </button>
            <button
              type="button"
              onClick={() => handlePresetSelect('resume')}
              className="rounded-md border border-neutral-300 bg-neutral-50 px-2.5 py-1 text-neutral-700 hover:bg-neutral-100"
            >
              Resume Automation Task
            </button>
            <button
              type="button"
              onClick={() => handlePresetSelect('params')}
              className="rounded-md border border-neutral-300 bg-neutral-50 px-2.5 py-1 text-neutral-700 hover:bg-neutral-100"
            >
              Modify Task Parameters
            </button>
            <button
              type="button"
              onClick={() => handlePresetSelect('withdraw')}
              className="rounded-md border border-neutral-300 bg-neutral-50 px-2.5 py-1 text-neutral-700 hover:bg-neutral-100"
            >
              Initiate Withdrawal
            </button>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <input
              type="text"
              value={actionInput}
              onChange={(event) => setActionInput(event.target.value)}
              placeholder="Describe an administrative or automation action to sign and record..."
              aria-label="New audit action"
              className="w-full rounded-lg border border-neutral-300 px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => recordAction()}
              disabled={isRecording || !actionInput.trim()}
              className="shrink-0 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {isRecording ? 'Signing with WebCrypto…' : 'Sign & Record Action'}
            </button>
          </div>
        </section>

        {/* Verification & Control Bar */}
        <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={filters.searchQuery}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  searchQuery: event.target.value,
                }))
              }
              placeholder="Search actions, hashes, wallets..."
              aria-label="Search audit trail"
              className="w-60 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <select
              value={filters.severityFilter}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  severityFilter: event.target.value as AuditLogFilterOptions['severityFilter'],
                }))
              }
              aria-label="Filter by severity"
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Severities</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
            <button
              type="button"
              onClick={verify}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
            >
              Verify Ledger
            </button>
            <button
              type="button"
              onClick={handleAnchorOnChain}
              disabled={entries.length === 0}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40"
              title="Anchor latest ledger head to Soroban network"
            >
              Anchor to Blockchain
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={exportCsv}
              disabled={entries.length === 0}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
              title="RFC 4180 Compliant CSV Export"
            >
              Export CSV (RFC 4180)
            </button>
            <button
              type="button"
              onClick={exportJsonLd}
              disabled={entries.length === 0}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
              title="W3C JSON-LD Export"
            >
              Export JSON-LD
            </button>
            <button
              type="button"
              onClick={exportJson}
              disabled={entries.length === 0}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
              title="Standard JSON Export"
            >
              Export JSON
            </button>
            <button
              type="button"
              onClick={handleSimulateTamper}
              disabled={entries.length === 0}
              className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-40"
              title="Simulate data tampering to test cryptographic detection"
            >
              Simulate Tamper
            </button>
            <button
              type="button"
              onClick={handleResetLedger}
              className="rounded-lg border border-neutral-200 px-2.5 py-2 text-xs text-neutral-500 hover:bg-neutral-100"
              title="Clear local audit storage"
            >
              Reset
            </button>
          </div>
        </section>

        {/* Verification Status Banner */}
        <section
          className={`mb-6 rounded-xl border p-4 transition-colors ${
            verification.valid === true
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : verification.valid === false
                ? 'border-rose-200 bg-rose-50 text-rose-900'
                : 'border-neutral-200 bg-neutral-50 text-neutral-700'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-semibold">{verification.label}</span>
              {verification.detail && (
                <p className="mt-1 text-xs opacity-90">{verification.detail}</p>
              )}
            </div>
            {latestAnchor && (
              <div className="text-right text-xs">
                <span className="rounded bg-indigo-100 px-2 py-1 font-mono font-medium text-indigo-800">
                  On-chain Anchor: #{latestAnchor.sequence} ({latestAnchor.txHash.slice(0, 10)}…)
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Audit Log Table */}
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-3.5">#</th>
                  <th className="px-4 py-3.5">Timestamp</th>
                  <th className="px-4 py-3.5">Action</th>
                  <th className="px-4 py-3.5">Actor (Wallet)</th>
                  <th className="px-4 py-3.5">Severity</th>
                  <th className="px-4 py-3.5">Payload Hash</th>
                  <th className="px-4 py-3.5">Signature Proof</th>
                  <th className="px-4 py-3.5 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filteredEntries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-neutral-500">
                      No audit entries found. Log an action above to initialize the cryptographic ledger.
                    </td>
                  </tr>
                ) : (
                  filteredEntries.map((entry) => {
                    const isExpanded = expandedEntryId === entry.id;
                    return (
                      <React.Fragment key={entry.id}>
                        <tr className="hover:bg-neutral-50/60">
                          <td className="px-4 py-3 font-mono text-xs font-semibold text-neutral-400">
                            {entry.sequence}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-xs text-neutral-600">
                            {new Date(entry.timestamp).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 font-medium text-neutral-800">
                            {entry.action}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-neutral-600">
                            {entry.actor}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${severityTone(
                                entry.severity,
                              )}`}
                            >
                              {entry.severity}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                            {entry.payloadHash.slice(0, 10)}…{entry.payloadHash.slice(-6)}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-indigo-600">
                            {entry.signature.slice(0, 12)}…
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => setExpandedEntryId(isExpanded ? null : entry.id)}
                              className="text-xs font-medium text-blue-600 hover:text-blue-800"
                            >
                              {isExpanded ? 'Hide' : 'Inspect'}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-neutral-50/80">
                            <td colSpan={8} className="p-4 text-xs font-mono">
                              <div className="grid grid-cols-1 gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-neutral-700 md:grid-cols-2">
                                <div>
                                  <span className="font-semibold text-neutral-500">ID:</span> {entry.id}
                                </div>
                                <div>
                                  <span className="font-semibold text-neutral-500">Previous Hash:</span>{' '}
                                  {entry.prevHash ? `${entry.prevHash.slice(0, 24)}…` : 'null (Genesis Entry)'}
                                </div>
                                <div>
                                  <span className="font-semibold text-neutral-500">Content Hash:</span>{' '}
                                  {entry.contentHash}
                                </div>
                                <div>
                                  <span className="font-semibold text-neutral-500">Payload Hash:</span>{' '}
                                  {entry.payloadHash}
                                </div>
                                <div className="md:col-span-2">
                                  <span className="font-semibold text-neutral-500">Public Key (SPKI):</span>{' '}
                                  <span className="break-all">{entry.publicKey}</span>
                                </div>
                                <div className="md:col-span-2">
                                  <span className="font-semibold text-neutral-500">ECDSA Signature:</span>{' '}
                                  <span className="break-all">{entry.signature}</span>
                                </div>
                                <div className="md:col-span-2 mt-1">
                                  <span className="font-semibold text-neutral-500">Canonical Payload:</span>
                                  <pre className="mt-1 max-h-36 overflow-auto rounded bg-neutral-100 p-2 text-[11px] text-neutral-800">
                                    {JSON.stringify(entry.payload, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default withRouteGuard(
  AuditPage,
  ['admin:users', 'admin:system', 'admin:settings', 'audit:view'],
  {
    redirectTo: '/unauthorized',
    requireAll: false, // any admin or audit permission grants access
  },
);
