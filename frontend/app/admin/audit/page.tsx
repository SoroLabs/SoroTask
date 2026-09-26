/**
 * Client-Side Cryptographic Audit Log (issue #1267)
 *
 * Protected admin page rendering the signed, hash-chained activity ledger:
 * every administrative action (task parameter changes, withdrawals,
 * permission changes) is appended with the acting wallet address, a
 * timestamp, and an ECDSA signature proof. The trail exports to CSV/JSON
 * and can be verified offline.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { withRouteGuard } from '@/lib/routeGuards';
import {
  appendAuditEntry,
  downloadAuditExport,
  exportAuditCsv,
  exportAuditJson,
  loadAuditLedger,
  verifyAuditLedger,
  type SignedAuditLogEntry,
} from '@/src/lib/auditLedger';
import type { AuditLogFilterOptions } from '@/app/types/auditLog';
import { useAuth } from '@/context/AuthContext';

function severityTone(severity: SignedAuditLogEntry['severity']): string {
  switch (severity) {
    case 'critical':
      return 'bg-rose-500/15 text-rose-200';
    case 'warning':
      return 'bg-amber-500/15 text-amber-200';
    default:
      return 'bg-emerald-500/15 text-emerald-200';
  }
}

function AuditPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<SignedAuditLogEntry[]>([]);
  const [filters, setFilters] = useState<AuditLogFilterOptions>({
    searchQuery: '',
    severityFilter: 'all',
  });
  const [verification, setVerification] = useState<{
    label: string;
    valid: boolean | null;
    detail?: string;
  }>({ label: 'Not verified yet', valid: null });
  const [actionInput, setActionInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);

  const refresh = useCallback(() => {
    setEntries(loadAuditLedger());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const actor = user?.address ?? 'anonymous';

  const recordAction = async () => {
    const action = actionInput.trim();
    if (!action) return;
    setIsRecording(true);
    try {
      await appendAuditEntry(
        {
          action,
          actor,
          payload: { source: 'admin-audit-page' },
          severity: 'info',
        },
        { storage: window.localStorage },
      );
      setActionInput('');
      setVerification({ label: 'Not verified yet', valid: null });
      refresh();
    } finally {
      setIsRecording(false);
    }
  };

  const verify = async () => {
    const result = await verifyAuditLedger(loadAuditLedger());
    setVerification(
      result.valid
        ? {
            label: `Ledger verified — ${entries.length} entries intact`,
            valid: true,
          }
        : {
            label: `Verification FAILED at entry #${result.brokenAt ?? '?'}`,
            valid: false,
            detail: result.reason,
          },
    );
  };

  const exportCsv = () => {
    downloadAuditExport(
      exportAuditCsv(loadAuditLedger()),
      `sorotask-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      'text/csv',
    );
  };

  const exportJson = () => {
    downloadAuditExport(
      exportAuditJson(loadAuditLedger()),
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
      entry.actor.toLowerCase().includes(query)
    );
  });

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-2 text-3xl font-bold text-neutral-900">
          Client Audit Ledger
        </h1>
        <p className="mb-8 text-neutral-600">
          Every administrative action is recorded with its wallet actor,
          timestamp, and a verifiable ECDSA signature proof. The ledger is
          hash-chained, so any modification breaks verification.
        </p>

        <section className="mb-6 rounded-lg bg-white p-4 shadow-md">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <input
              type="text"
              value={actionInput}
              onChange={(event) => setActionInput(event.target.value)}
              placeholder="Describe an administrative action (e.g. 'Adjusted task 42 gas limit')"
              aria-label="New audit action"
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={recordAction}
              disabled={isRecording || !actionInput.trim()}
              className="shrink-0 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isRecording ? 'Recording…' : 'Sign & record action'}
            </button>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Acting wallet: <span className="font-mono">{actor}</span>
          </p>
        </section>

        <section className="mb-6 flex flex-wrap items-center gap-3 rounded-lg bg-white p-4 shadow-md">
          <input
            type="search"
            value={filters.searchQuery}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                searchQuery: event.target.value,
              }))
            }
            placeholder="Search actions or wallets"
            aria-label="Search audit trail"
            className="w-56 rounded border border-neutral-300 px-3 py-2 text-sm"
          />
          <select
            value={filters.severityFilter}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                severityFilter: event.target
                  .value as AuditLogFilterOptions['severityFilter'],
              }))
            }
            aria-label="Filter by severity"
            className="rounded border border-neutral-300 px-3 py-2 text-sm"
          >
            <option value="all">All severities</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
          <button
            type="button"
            onClick={verify}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Verify ledger
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={exportJson}
            className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Export JSON
          </button>
          <span
            className={`ml-auto rounded-full px-3 py-1 text-sm font-medium ${
              verification.valid === true
                ? 'bg-emerald-500/15 text-emerald-700'
                : verification.valid === false
                  ? 'bg-rose-500/15 text-rose-700'
                  : 'bg-neutral-100 text-neutral-500'
            }`}
          >
            {verification.label}
            {verification.detail ? ` — ${verification.detail}` : ''}
          </span>
        </section>

        <div className="overflow-x-auto rounded-lg bg-white shadow-md">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Actor (wallet)</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Entry hash</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">
                    No audit entries yet.
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry) => (
                  <tr key={entry.id} className="border-t border-neutral-100">
                    <td className="px-4 py-3 font-mono text-xs text-neutral-400">
                      {entry.sequence}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-neutral-600">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-neutral-800">{entry.action}</td>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-600">
                      {entry.actor}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityTone(entry.severity)}`}
                      >
                        {entry.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-400">
                      {entry.payloadHash.slice(0, 16)}…
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default withRouteGuard(
  AuditPage,
  ['admin:users', 'admin:system', 'admin:settings'],
  {
    redirectTo: '/unauthorized',
    requireAll: false, // any admin permission grants audit access
  },
);
