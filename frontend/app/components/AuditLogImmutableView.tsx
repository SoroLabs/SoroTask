import React, { useState, useTransition, useDeferredValue, useMemo } from 'react';
import { AuditLogEntry, AuditLogFilterOptions } from '../types/auditLog';
import { ShieldCheck, Search, AlertOctagon, RefreshCw } from 'lucide-react';

interface AuditLogImmutableViewProps {
    initialLogs: AuditLogEntry[];
    onVerifyEntryTamper: (entryId: string) => boolean;
}

export const AuditLogImmutableView: React.FC<AuditLogImmutableViewProps> = ({
    initialLogs,
    onVerifyEntryTamper,
}) => {
    // Concurrent mode transition handle for filter operations
    const [isPending, startTransition] = useTransition();
    
    const [rawFilters, setRawFilters] = useState<AuditLogFilterOptions>({
        searchQuery: '',
        severityFilter: 'all',
    });

    // Defer the filter configuration state to allow background rendering paths
    const deferredFilters = useDeferredValue(rawFilters);

    /**
     * Compute filtered logs matching deferred filter options.
     * Large list recalculations are decoupled from immediate input rendering.
     */
    const processedLogs = useMemo(() => {
        return initialLogs.filter((log) => {
            const matchesSeverity =
                deferredFilters.severityFilter === 'all' ||
                log.severity === deferredFilters.severityFilter;
            
            const matchesSearch =
                log.action.toLowerCase().includes(deferredFilters.searchQuery.toLowerCase()) ||
                log.actor.toLowerCase().includes(deferredFilters.searchQuery.toLowerCase()) ||
                log.id.toLowerCase().includes(deferredFilters.searchQuery.toLowerCase());

            return matchesSeverity && matchesSearch;
        });
    }, [initialLogs, deferredFilters]);

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        // High priority update: Keep input typing fast and snappy
        const query = e.target.value;
        
        // Low priority transition: Defer rendering the long lists matching the filter
        startTransition(() => {
            setRawFilters((prev) => ({ ...prev, searchQuery: query }));
        });
    };

    const handleSeverityChange = (severity: AuditLogFilterOptions['severityFilter']) => {
        startTransition(() => {
            setRawFilters((prev) => ({ ...prev, severityFilter: severity }));
        });
    };

    return (
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-white shadow-xl">
            {/* Header section */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="h-5 w-5 text-emerald-400" />
                        <h2 className="text-base font-bold tracking-tight">Immutable Governance Audit Log</h2>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">Cryptographically signed ledger tracking SoroTask operations</p>
                </div>
                {isPending && (
                    <div className="flex items-center gap-1.5 font-mono text-[11px] text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2.5 py-1 rounded">
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        Refining View Matrix...
                    </div>
                )}
            </div>

            {/* Filter controls */}
            <div className="mb-4 flex flex-wrap gap-3">
                <div className="relative flex-1 min-w-[240px]">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <input
                        type="text"
                        placeholder="Search by action signature, hash, or actor account..."
                        onChange={handleSearchChange}
                        className="w-full rounded-md border border-slate-800 bg-slate-900/60 py-2 pl-9 pr-4 text-xs placeholder:text-slate-500 focus:border-sky-500 focus:outline-none transition-colors"
                    />
                </div>
                <div className="flex rounded-md border border-slate-800 p-0.5 bg-slate-900/40 text-xs">
                    {(['all', 'info', 'warning', 'critical'] as const).map((sev) => (
                        <button
                            key={sev}
                            type="button"
                            onClick={() => handleSeverityChange(sev)}
                            className={`rounded px-3 py-1.5 font-medium capitalize transition-all ${
                                rawFilters.severityFilter === sev
                                    ? 'bg-slate-800 text-white shadow'
                                    : 'text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            {sev}
                        </button>
                    ))}
                </div>
            </div>

            {/* Logs datagrid rendering */}
            <div className="overflow-x-auto rounded-md border border-slate-800 bg-slate-900/20">
                <table className="w-full text-left border-collapse text-xs">
                    <thead>
                        <tr className="border-b border-slate-800 bg-slate-900/60 font-semibold text-slate-400">
                            <th className="p-3">Timestamp</th>
                            <th className="p-3">Action Signature</th>
                            <th className="p-3">Actor Entity</th>
                            <th className="p-3 text-center">Immutability Check</th>
                        </tr>
                    </thead>
                    <tbody className={`divide-y divide-slate-800 transition-opacity duration-150 ${isPending ? 'opacity-60' : 'opacity-100'}`}>
                        {processedLogs.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="p-8 text-center text-slate-500 font-mono">
                                    No log footprints found inside active telemetry boundaries.
                                </td>
                            </tr>
                        ) : (
                            processedLogs.map((log) => {
                                const isTamperFree = onVerifyEntryTamper(log.id);
                                return (
                                    <tr key={log.id} className="hover:bg-slate-900/40 font-mono transition-colors">
                                        <td className="p-3 text-slate-400">
                                            {new Date(log.timestamp).toISOString().replace('T', ' ').substring(0, 19)}
                                        </td>
                                        <td className="p-3">
                                            <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${
                                                log.severity === 'critical' ? 'bg-rose-500' : log.severity === 'warning' ? 'bg-amber-400' : 'bg-sky-400'
                                            }`} />
                                            <span className="font-semibold text-slate-200">{log.action}</span>
                                        </td>
                                        <td className="p-3 text-slate-300 truncate max-w-[150px]" title={log.actor}>
                                            {log.actor}
                                        </td>
                                        <td className="p-3 text-center">
                                            {isTamperFree ? (
                                                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                                                    VERIFIED SECURE
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-[10px] text-rose-400 font-bold bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded animate-pulse">
                                                    <AlertOctagon className="h-3 w-3" /> TAMPER DETECTED
                                                </span>
                                            )}
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
};