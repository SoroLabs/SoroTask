"use client";

import React, {
  memo,
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
  useTransition,
} from "react";
import { AuditLogEntry, AuditLogFilterOptions } from "../types/auditLog";
import {
  ShieldCheck,
  Search,
  AlertOctagon,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from "lucide-react";

export interface AuditLogImmutableViewProps {
  initialLogs: AuditLogEntry[];
  onVerifyEntryTamper: (entryId: string) => boolean;
  pageSize?: number;
  title?: string;
  subtitle?: string;
}

const DEFAULT_PAGE_SIZE = 25;

function formatSafeTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp)) {
    return "Invalid timestamp";
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Invalid timestamp";
  }
  return date.toISOString().replace("T", " ").substring(0, 19);
}

interface AuditLogRowProps {
  log: AuditLogEntry;
  isTamperFree: boolean;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
}

const AuditLogRow = memo(function AuditLogRow({
  log,
  isTamperFree,
  isExpanded,
  onToggleExpand,
}: AuditLogRowProps) {
  const formattedTime = formatSafeTimestamp(log.timestamp);
  const dotClass =
    log.severity === "critical"
      ? "bg-rose-500"
      : log.severity === "warning"
        ? "bg-amber-400"
        : "bg-sky-400";

  return (
    <>
      <tr className="hover:bg-slate-900/40 font-mono transition-colors">
        <td className="p-3 whitespace-nowrap text-slate-400">
          {formattedTime}
        </td>
        <td className="p-3">
          <span
            aria-hidden="true"
            className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${dotClass}`}
          />
          <span className="sr-only">Severity: {log.severity}. </span>
          <span className="font-semibold text-slate-200">{log.action}</span>
        </td>
        <td
          className="p-3 text-slate-300 truncate max-w-[160px]"
          title={log.actor}
        >
          {log.actor}
        </td>
        <td className="p-3 text-center">
          {isTamperFree ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
              VERIFIED SECURE
            </span>
          ) : (
            <span
              role="alert"
              className="inline-flex items-center gap-1 text-[10px] text-rose-400 font-bold bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded animate-pulse"
            >
              <AlertOctagon className="h-3 w-3" aria-hidden="true" /> TAMPER
              DETECTED
            </span>
          )}
        </td>
        <td className="p-3 text-right">
          <button
            type="button"
            onClick={() => onToggleExpand(log.id)}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? "Hide" : "Inspect"} cryptographic proof for ${log.action}`}
            className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[10px] font-sans font-medium text-slate-300 hover:border-sky-500 hover:text-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {isExpanded ? (
              <>
                Hide <ChevronUp className="h-3 w-3" aria-hidden="true" />
              </>
            ) : (
              <>
                Hash <ChevronDown className="h-3 w-3" aria-hidden="true" />
              </>
            )}
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-slate-900/60">
          <td colSpan={5} className="p-3 font-mono text-[11px] text-slate-300">
            <div className="grid grid-cols-1 gap-2 rounded border border-slate-800 bg-slate-950/80 p-3 sm:grid-cols-2">
              <div>
                <span className="text-slate-400">Entry ID: </span>
                <span className="break-all text-slate-100">{log.id}</span>
              </div>
              <div>
                <span className="text-slate-400">Severity: </span>
                <span className="uppercase text-slate-100">{log.severity}</span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-slate-400">Payload Hash: </span>
                <span className="break-all text-sky-300">
                  {log.payloadHash}
                </span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-slate-400">Full Actor: </span>
                <span className="break-all text-slate-200">{log.actor}</span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
});

export const AuditLogImmutableView: React.FC<AuditLogImmutableViewProps> = ({
  initialLogs,
  onVerifyEntryTamper,
  pageSize = DEFAULT_PAGE_SIZE,
  title = "Immutable Governance Audit Log",
  subtitle = "Cryptographically signed ledger tracking SoroTask operations",
}) => {
  const [isPending, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState("");
  const [rawFilters, setRawFilters] = useState<AuditLogFilterOptions>({
    searchQuery: "",
    severityFilter: "all",
  });
  const [tamperedOnly, setTamperedOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const deferredFilters = useDeferredValue(rawFilters);
  const safePageSize = Math.max(1, Math.floor(pageSize));

  // Memoize tamper verification per entry so search/filter/UI renders do not re-run checks
  const verificationMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const log of initialLogs) {
      map.set(log.id, onVerifyEntryTamper(log.id));
    }
    return map;
  }, [initialLogs, onVerifyEntryTamper]);

  const integritySummary = useMemo(() => {
    let verified = 0;
    let tampered = 0;
    for (const log of initialLogs) {
      if (verificationMap.get(log.id)) {
        verified += 1;
      } else {
        tampered += 1;
      }
    }
    return { total: initialLogs.length, verified, tampered };
  }, [initialLogs, verificationMap]);

  const processedLogs = useMemo(() => {
    const query = deferredFilters.searchQuery.trim().toLowerCase();
    return initialLogs.filter((log) => {
      const matchesSeverity =
        deferredFilters.severityFilter === "all" ||
        log.severity === deferredFilters.severityFilter;

      if (!matchesSeverity) return false;

      if (tamperedOnly && verificationMap.get(log.id) !== false) {
        return false;
      }

      if (!query) return true;

      return (
        log.action.toLowerCase().includes(query) ||
        log.actor.toLowerCase().includes(query) ||
        log.id.toLowerCase().includes(query) ||
        log.payloadHash.toLowerCase().includes(query)
      );
    });
  }, [initialLogs, deferredFilters, tamperedOnly, verificationMap]);

  const totalPages = Math.max(
    1,
    Math.ceil(processedLogs.length / safePageSize),
  );
  const clampedPage = Math.min(currentPage, totalPages);

  const visibleLogs = useMemo(() => {
    const start = (clampedPage - 1) * safePageSize;
    return processedLogs.slice(start, start + safePageSize);
  }, [processedLogs, clampedPage, safePageSize]);

  const hasActiveFilters =
    searchInput.trim().length > 0 ||
    rawFilters.severityFilter !== "all" ||
    tamperedOnly;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const query = e.target.value;
      setSearchInput(query);
      startTransition(() => {
        setRawFilters((prev) => ({ ...prev, searchQuery: query }));
        setCurrentPage(1);
      });
    },
    [],
  );

  const handleSeverityChange = useCallback(
    (severity: AuditLogFilterOptions["severityFilter"]) => {
      startTransition(() => {
        setRawFilters((prev) => ({ ...prev, severityFilter: severity }));
        setCurrentPage(1);
      });
    },
    [],
  );

  const handleToggleTamperedOnly = useCallback(() => {
    startTransition(() => {
      setTamperedOnly((prev) => !prev);
      setCurrentPage(1);
    });
  }, []);

  const handleResetFilters = useCallback(() => {
    setSearchInput("");
    startTransition(() => {
      setRawFilters({ searchQuery: "", severityFilter: "all" });
      setTamperedOnly(false);
      setCurrentPage(1);
    });
  }, []);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <section
      aria-label={title}
      className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-white shadow-xl"
    >
      {/* Header section */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck
              className="h-5 w-5 text-emerald-400"
              aria-hidden="true"
            />
            <h2 className="text-base font-bold tracking-tight">{title}</h2>
          </div>
          <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="status"
            aria-live="polite"
            className="flex flex-wrap items-center gap-2 font-mono text-[11px]"
          >
            <span className="rounded border border-slate-800 bg-slate-900 px-2 py-1 text-slate-300">
              Total: {integritySummary.total}
            </span>
            <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-300">
              Verified: {integritySummary.verified}
            </span>
            {integritySummary.tampered > 0 && (
              <span className="rounded border border-rose-500/30 bg-rose-500/15 px-2 py-1 text-rose-300 font-semibold">
                Tampered: {integritySummary.tampered}
              </span>
            )}
          </div>

          {isPending && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-1.5 font-mono text-[11px] text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2.5 py-1 rounded"
            >
              <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
              Refining View Matrix...
            </div>
          )}
        </div>
      </div>

      {/* Filter controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search
            className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchInput}
            aria-label="Search audit log entries by action, hash, ID, or actor"
            placeholder="Search by action signature, hash, or actor account..."
            onChange={handleSearchChange}
            className="w-full rounded-md border border-slate-800 bg-slate-900/60 py-2 pl-9 pr-4 text-xs text-white placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40 transition-colors"
          />
        </div>

        <div
          role="group"
          aria-label="Filter audit logs by severity"
          className="flex rounded-md border border-slate-800 p-0.5 bg-slate-900/40 text-xs"
        >
          {(["all", "info", "warning", "critical"] as const).map((sev) => {
            const active = rawFilters.severityFilter === sev;
            return (
              <button
                key={sev}
                type="button"
                aria-pressed={active}
                onClick={() => handleSeverityChange(sev)}
                className={`rounded px-3 py-1.5 font-medium capitalize transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                  active
                    ? "bg-slate-800 text-white shadow"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {sev}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          aria-pressed={tamperedOnly}
          onClick={handleToggleTamperedOnly}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-rose-500 ${
            tamperedOnly
              ? "border-rose-500/40 bg-rose-500/20 text-rose-200"
              : "border-slate-800 bg-slate-900/40 text-slate-300 hover:text-white"
          }`}
        >
          <AlertOctagon className="h-3.5 w-3.5" aria-hidden="true" />
          Tampered Only
        </button>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleResetFilters}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Reset
          </button>
        )}
      </div>

      {/* Logs datagrid rendering */}
      <div className="overflow-x-auto rounded-md border border-slate-800 bg-slate-900/20">
        <table
          aria-label="Immutable governance audit entries"
          className="w-full text-left border-collapse text-xs"
        >
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/60 font-semibold text-slate-300">
              <th scope="col" className="p-3">
                Timestamp
              </th>
              <th scope="col" className="p-3">
                Action Signature
              </th>
              <th scope="col" className="p-3">
                Actor Entity
              </th>
              <th scope="col" className="p-3 text-center">
                Immutability Check
              </th>
              <th scope="col" className="p-3 text-right">
                Proof
              </th>
            </tr>
          </thead>
          <tbody
            className={`divide-y divide-slate-800 transition-opacity duration-150 ${
              isPending ? "opacity-60" : "opacity-100"
            }`}
          >
            {visibleLogs.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="p-8 text-center text-slate-400 font-mono"
                >
                  No log footprints found inside active telemetry boundaries.
                </td>
              </tr>
            ) : (
              visibleLogs.map((log) => (
                <AuditLogRow
                  key={log.id}
                  log={log}
                  isTamperFree={verificationMap.get(log.id) ?? false}
                  isExpanded={expandedId === log.id}
                  onToggleExpand={handleToggleExpand}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination footer when rows exceed pageSize */}
      {processedLogs.length > safePageSize && (
        <nav
          aria-label="Audit log pagination"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400"
        >
          <span>
            Showing {(clampedPage - 1) * safePageSize + 1}–
            {Math.min(clampedPage * safePageSize, processedLogs.length)} of{" "}
            {processedLogs.length} entries
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={clampedPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 rounded border border-slate-800 bg-slate-900 px-2.5 py-1 text-slate-200 hover:bg-slate-800 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Previous
            </button>
            <span className="font-mono text-slate-300">
              Page {clampedPage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={clampedPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 rounded border border-slate-800 bg-slate-900 px-2.5 py-1 text-slate-200 hover:bg-slate-800 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </nav>
      )}
    </section>
  );
};
