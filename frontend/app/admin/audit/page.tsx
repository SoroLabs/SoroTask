'use client';

import { useMemo, useState } from 'react';
import {
  assessAllowance,
  createRevokeReviewBundle,
  isAllowanceActive,
  MAX_ALLOWANCE_EXPORT_BYTES,
  parseAllowanceExport,
  summarizeAllowances,
  type TokenAllowance,
} from '@/src/lib/auditLedger';

export default function AllowanceAuditPage() {
  const [allowances, setAllowances] = useState<TokenAllowance[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importedFile, setImportedFile] = useState<string | null>(null);
  const [bundleReady, setBundleReady] = useState(false);
  const activeAllowances = useMemo(
    () => allowances.filter(isAllowanceActive).map(assessAllowance),
    [allowances],
  );
  const summary = useMemo(() => summarizeAllowances(allowances), [allowances]);
  const selectedActiveCount = selectedIds.filter((id) =>
    activeAllowances.some((allowance) => allowance.id === id),
  ).length;

  const importFile = async (file?: File) => {
    setError(null);
    setBundleReady(false);
    if (!file) {
      return;
    }
    if (file.size > MAX_ALLOWANCE_EXPORT_BYTES) {
      setError('Export exceeds the 2 MB safety limit.');
      return;
    }

    try {
      const parsed = parseAllowanceExport(await file.text());
      setAllowances(parsed);
      setSelectedIds(parsed.filter(isAllowanceActive).map((allowance) => allowance.id));
      setImportedFile(file.name);
    } catch (cause) {
      setAllowances([]);
      setSelectedIds([]);
      setImportedFile(null);
      setError(cause instanceof Error ? cause.message : 'Unable to read this allowance export.');
    }
  };

  const selectHighRisk = () => {
    setSelectedIds(activeAllowances
      .filter((allowance) => allowance.risk === 'high')
      .map((allowance) => allowance.id));
    setBundleReady(false);
  };

  const prepareReviewBundle = () => {
    setError(null);
    try {
      const bundle = createRevokeReviewBundle(allowances, selectedIds);
      const blob = new Blob(
        [JSON.stringify({
          type: 'sorotask-allowance-revoke-review',
          createdAt: new Date().toISOString(),
          warning: 'Review and revoke these allowances using a trusted wallet and network interface. This file does not execute transactions.',
          ...bundle,
        }, null, 2)],
        { type: 'application/json' },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'sorotask-allowance-revoke-review.json';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setBundleReady(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to prepare the review bundle.');
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 text-slate-900 dark:text-slate-100 sm:px-6 lg:px-8">
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">
          Account security
        </p>
        <h1 className="mt-2 text-3xl font-bold">Token Allowance Auditor</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
          Review an allowance snapshot from a trusted indexer. Soroban token approvals cannot be
          enumerated from account trustlines alone, and no indexer or wallet signing integration is
          configured in this app.
        </p>
      </header>

      <section
        className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
        role="note"
      >
        <h2 className="font-semibold">Read-only audit mode</h2>
        <p className="mt-1">
          Import a JSON allowance snapshot to see risk badges and calculate a posture score.
          This page never signs or submits transactions. The review bundle is not a revocation.
        </p>
      </section>

      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-lg font-semibold">Import allowance snapshot</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          JSON format: <code>{'{ "allowances": [...] }'}</code>. Amounts must be integer token base
          units; keep the export private because it contains account and spender addresses.
        </p>
        <label htmlFor="allowance-export" className="sr-only">Allowance snapshot JSON file</label>
        <input
          id="allowance-export"
          type="file"
          accept=".json,application/json"
          onChange={(event) => void importFile(event.target.files?.[0])}
          className="mt-4 block w-full max-w-xl rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200 dark:file:bg-slate-800"
          aria-describedby="allowance-export-help"
        />
        <p id="allowance-export-help" className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Maximum file size: 2 MB; maximum entries: 500. Importing replaces the current snapshot.
        </p>
        {importedFile && (
          <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300" role="status">
            Imported {allowances.length} allowance{allowances.length === 1 ? '' : 's'} from {importedFile}.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
      </section>

      <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Allowance security posture">
        <SummaryCard
          label="Security posture"
          value={allowances.length === 0 ? '—' : `${summary.postureScore}/100`}
          detail={allowances.length === 0 ? 'Import a snapshot to calculate' : 'Heuristic score from active approvals'}
        />
        <SummaryCard label="Active allowances" value={String(summary.activeCount)} detail="From imported snapshot" />
        <SummaryCard label="Unlimited approvals" value={String(summary.highRiskCount)} detail="High-risk allowance amounts" />
        <SummaryCard label="Non-expiring approvals" value={String(summary.moderateRiskCount)} detail="Review expiration settings" />
      </section>

      {summary.highRiskCount > 0 && (
        <section
          className="mb-6 rounded-xl border border-red-300 bg-red-50 p-4 text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
          role="alert"
        >
          <h2 className="font-semibold">Unlimited token approvals detected</h2>
          <p className="mt-1 text-sm">
            These spenders may transfer the approved token balance under the token contract rules.
            Review each spender and revoke approvals you no longer need.
          </p>
          <button
            type="button"
            onClick={selectHighRisk}
            className="mt-3 rounded-lg border border-red-400 px-3 py-2 text-sm font-medium hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 dark:hover:bg-red-900/50"
          >
            Select unlimited approvals
          </button>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-semibold">Allowance ledger</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {activeAllowances.length} active allowance{activeAllowances.length === 1 ? '' : 's'}
            </p>
          </div>
          <button
            type="button"
            onClick={prepareReviewBundle}
            disabled={selectedActiveCount === 0}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            Export selected revoke review ({selectedActiveCount})
          </button>
        </div>

        {bundleReady && (
          <p className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="status">
            Review bundle downloaded. No permissions have been revoked.
          </p>
        )}
        {error && <p className="border-b border-red-200 px-4 py-3 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}

        {activeAllowances.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
            {allowances.length === 0
              ? 'No allowance snapshot loaded. Import a trusted indexer export to begin an audit.'
              : 'No active allowances found in this snapshot.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <caption className="sr-only">Active token allowances and risk assessment</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Select</span>
                  </th>
                  <th scope="col" className="px-4 py-3">Token</th>
                  <th scope="col" className="px-4 py-3">Spender</th>
                  <th scope="col" className="px-4 py-3">Allowance</th>
                  <th scope="col" className="px-4 py-3">Expiration</th>
                  <th scope="col" className="px-4 py-3">Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {activeAllowances.map((allowance) => (
                  <tr key={allowance.id}>
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(allowance.id)}
                        onChange={(event) => {
                          setBundleReady(false);
                          setSelectedIds((current) => event.target.checked
                            ? [...current, allowance.id]
                            : current.filter((id) => id !== allowance.id));
                        }}
                        aria-label={`Select ${allowance.tokenSymbol} allowance for ${allowance.spenderAddress}`}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </td>
                    <th scope="row" className="px-4 py-4">
                      <div className="font-semibold">{allowance.tokenSymbol}</div>
                      <div className="max-w-48 truncate font-mono text-xs text-slate-500" title={allowance.tokenAddress}>
                        {allowance.tokenAddress}
                      </div>
                    </th>
                    <td className="max-w-56 truncate px-4 py-4 font-mono text-xs" title={allowance.spenderAddress}>
                      {allowance.spenderAddress}
                    </td>
                    <td className="px-4 py-4 font-medium tabular-nums">
                      {allowance.formattedAmount} {!allowance.isUnlimited && allowance.tokenSymbol}
                    </td>
                    <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                      {allowance.expirationLedger === null
                        ? 'No expiry reported'
                        : `Ledger ${allowance.expirationLedger}`}
                    </td>
                    <td className="px-4 py-4">
                      <RiskBadge risk={allowance.risk} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-sm text-slate-500 dark:text-slate-400">{label}</h2>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{detail}</p>
    </article>
  );
}

function RiskBadge({ risk }: { risk: 'high' | 'moderate' | 'low' }) {
  const styles = {
    high: 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200',
    moderate: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
    low: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200',
  };
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold uppercase ${styles[risk]}`}>
      {risk}
    </span>
  );
}
