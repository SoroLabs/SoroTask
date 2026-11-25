"use client";

import React, { useState, useMemo } from "react";
import { tracingClient, Trace, Span } from "../../lib/tracing/tracingClient";
import {
  FiActivity,
  FiFilter,
  FiLayers,
  FiCopy,
  FiCheck,
  FiCornerDownRight,
  FiAlertTriangle,
  FiSearch,
} from "react-icons/fi";

export default function DistributedTracingClient() {
  const [traces, setTraces] = useState<Trace[]>(() => tracingClient.getHistory());
  const [selectedTraceId, setSelectedTraceId] = useState<string>(
    traces[0]?.traceId || ""
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);

  const selectedTrace = useMemo(() => {
    return traces.find((t) => t.traceId === selectedTraceId) || null;
  }, [traces, selectedTraceId]);

  // Handle refresh
  function handleRefresh() {
    setTraces([...tracingClient.getHistory()]);
  }

  // Handle Trace Export Copy
  function handleCopyTrace() {
    if (!selectedTrace) return;
    const jsonStr = JSON.stringify(selectedTrace, null, 2);
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(jsonStr);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Recursive Tree Generation with Loop protection
  const nestedTimeline = useMemo(() => {
    if (!selectedTrace) return [];

    const spans = selectedTrace.spans;
    const rootSpans = spans.filter((s) => !s.parentId || !spans.some((ps) => ps.id === s.parentId));
    const parentToChildren = new Map<string, Span[]>();

    spans.forEach((span) => {
      if (span.parentId) {
        if (!parentToChildren.has(span.parentId)) {
          parentToChildren.set(span.parentId, []);
        }
        parentToChildren.get(span.parentId)?.push(span);
      }
    });

    const orderedList: { span: Span; depth: number }[] = [];
    const visited = new Set<string>();

    function traverse(span: Span, depth: number) {
      if (visited.has(span.id)) {
        // Prevent infinite loops from circular spans parentage
        return;
      }
      visited.add(span.id);
      orderedList.push({ span, depth });

      const children = parentToChildren.get(span.id) || [];
      // Sort children by startTime
      children.sort((a, b) => a.startTime - b.startTime);

      children.forEach((c) => {
        traverse(c, depth + 1);
      });
    }

    // Sort roots by startTimes
    rootSpans.sort((a, b) => a.startTime - b.startTime);
    rootSpans.forEach((r) => traverse(r, 0));

    // Append any orphan spans not reached (in case trace parent hierarchy is corrupted)
    spans.forEach((s) => {
      if (!visited.has(s.id)) {
        orderedList.push({ span: s, depth: 0 });
      }
    });

    return orderedList;
  }, [selectedTrace]);

  // Compute Trace timelines parameters
  const timingStats = useMemo(() => {
    if (!selectedTrace || selectedTrace.spans.length === 0) {
      return { minStart: 0, maxEnd: 0, totalDurationMs: 1 };
    }
    const starts = selectedTrace.spans.map((s) => s.startTime);
    const ends = selectedTrace.spans.map((s) => s.endTime || s.startTime);
    const minStart = Math.min(...starts);
    const maxEnd = Math.max(...ends);
    return {
      minStart,
      maxEnd,
      totalDurationMs: Math.max(1, maxEnd - minStart),
    };
  }, [selectedTrace]);

  // Filter traces
  const filteredTraces = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return traces;
    return traces.filter((t) =>
      t.traceId.toLowerCase().includes(q) ||
      t.spans.some((s) => s.name.toLowerCase().includes(q) || s.serviceName.toLowerCase().includes(q))
    );
  }, [traces, searchQuery]);

  // Color scheme tags per service
  const serviceColors = {
    frontend: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    "api-gateway": "bg-purple-500/10 text-purple-400 border-purple-500/20",
    "keeper-resolver": "bg-amber-500/10 text-amber-400 border-amber-500/20",
    "soroban-rpc": "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
    ledger: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  };

  return (
    <div
      className="grid gap-6 lg:grid-cols-[280px_1fr] rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-2xl backdrop-blur-md"
      data-testid="tracing-client-container"
    >
      {/* Left Column: Trace List Searcher */}
      <section className="flex flex-col gap-4 border-r border-white/10 pr-0 lg:pr-6">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <FiActivity className="text-sky-400" />
            Transaction Traces
          </h2>
          <p className="text-xs text-slate-400">Select active trace history</p>
        </div>

        <div className="relative">
          <input
            type="text"
            placeholder="Search traces..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 pl-8 text-xs text-white placeholder-slate-500 focus:border-sky-400 focus:outline-none"
          />
          <FiSearch className="absolute left-2.5 top-2.5 size-3.5 text-slate-500" />
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 max-h-[400px]">
          {filteredTraces.length === 0 ? (
            <p className="text-xs text-slate-500 italic p-2">No trace runs found.</p>
          ) : (
            filteredTraces.map((trace) => {
              const hasErrors = trace.spans.some((s) => s.status === "error");
              const isSelected = trace.traceId === selectedTraceId;
              const totalTimeMs = Math.max(
                0,
                Math.max(...trace.spans.map((s) => s.endTime || s.startTime)) -
                  Math.min(...trace.spans.map((s) => s.startTime))
              );

              return (
                <button
                  key={trace.traceId}
                  onClick={() => setSelectedTraceId(trace.traceId)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    isSelected
                      ? "border-sky-500/30 bg-sky-500/10 text-white"
                      : "border-white/5 bg-slate-950/40 text-slate-300 hover:bg-white/5"
                  }`}
                  type="button"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold">{trace.traceId}</span>
                    {hasErrors && (
                      <FiAlertTriangle className="size-3 text-rose-400 animate-pulse" title="Error in trace" />
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                    <span>{trace.spans.length} spans</span>
                    <span>{totalTimeMs} ms</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <button
          onClick={handleRefresh}
          className="rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-bold text-slate-300 hover:bg-white/10 transition"
          type="button"
        >
          Refresh Logs
        </button>
      </section>

      {/* Right Column: Waterfall chart & Spans Inspection */}
      <section className="space-y-6">
        {selectedTrace ? (
          <>
            {/* Trace waterfall header metadata */}
            <header className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-white font-mono">Trace: {selectedTrace.traceId}</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Duration: <span className="font-bold text-white font-mono">{timingStats.totalDurationMs} ms</span> ·{" "}
                  Spans: <span className="font-bold text-white">{selectedTrace.spans.length}</span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyTrace}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-white/10 flex items-center gap-1.5 transition"
                  type="button"
                >
                  {copied ? (
                    <>
                      <FiCheck className="text-emerald-400" /> Copied!
                    </>
                  ) : (
                    <>
                      <FiCopy /> Copy Trace JSON
                    </>
                  )}
                </button>
              </div>
            </header>

            {/* Waterfall Timeline Graphic Grid */}
            <div className="rounded-xl border border-white/5 bg-slate-950/40 p-4 space-y-3" data-testid="trace-waterfall">
              {/* Duration scale header */}
              <div className="flex border-b border-white/5 pb-2 text-[10px] font-mono text-slate-500 select-none">
                <div className="w-[200px] font-bold">Span / Operation</div>
                <div className="flex-1 flex justify-between px-2">
                  <span>0 ms</span>
                  <span>{Math.round(timingStats.totalDurationMs / 2)} ms</span>
                  <span>{timingStats.totalDurationMs} ms</span>
                </div>
              </div>

              {/* Nested Spans timeline list */}
              <div className="space-y-2">
                {nestedTimeline.map(({ span, depth }) => {
                  const hasParent = depth > 0;
                  const startMs = span.startTime - timingStats.minStart;
                  const durationMs = (span.endTime || span.startTime) - span.startTime;

                  // Compute percentage positions for timeline bar
                  const leftPct = (startMs / timingStats.totalDurationMs) * 100;
                  const widthPct = Math.max(1.5, (durationMs / timingStats.totalDurationMs) * 100);

                  const isSelected = selectedSpan?.id === span.id;

                  return (
                    <div
                      key={span.id}
                      onClick={() => setSelectedSpan(span)}
                      className={`group flex items-center rounded-lg p-2 transition cursor-pointer hover:bg-white/5 ${
                        isSelected ? "bg-white/10" : ""
                      }`}
                      data-testid={`span-row-${span.id}`}
                    >
                      {/* Left side: Span label hierarchy indentation */}
                      <div
                        className="w-[200px] flex-shrink-0 flex items-center text-xs truncate text-slate-200"
                        style={{ paddingLeft: `${depth * 14}px` }}
                      >
                        {hasParent && <FiCornerDownRight className="text-slate-500 mr-1.5 flex-shrink-0" />}
                        <span className="truncate" title={span.name}>
                          {span.name}
                        </span>
                      </div>

                      {/* Right side: horizontal timeline bar */}
                      <div className="flex-1 px-2 relative h-5 flex items-center">
                        <div
                          className={`h-2.5 rounded-full transition-all relative ${
                            span.status === "error"
                              ? "bg-rose-500"
                              : span.status === "pending"
                              ? "bg-amber-400 animate-pulse"
                              : "bg-sky-400"
                          }`}
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                          }}
                          title={`${durationMs} ms`}
                        />
                        <span
                          className="absolute text-[8px] font-mono text-slate-400 ml-1.5"
                          style={{ left: `${leftPct + widthPct}%` }}
                        >
                          {durationMs}ms
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Span Inspection Panel */}
            {selectedSpan ? (
              <div
                className="rounded-xl border border-white/10 bg-slate-950/60 p-5 space-y-4"
                data-testid="span-details"
              >
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-3">
                  <div>
                    <h4 className="text-sm font-bold text-white font-mono">{selectedSpan.name}</h4>
                    <p className="text-[10px] text-slate-400 mt-0.5">Span ID: {selectedSpan.id}</p>
                  </div>
                  <span
                    className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${
                      serviceColors[selectedSpan.serviceName] || "text-slate-300 border-slate-500/20"
                    }`}
                  >
                    {selectedSpan.serviceName}
                  </span>
                </div>

                {/* Metadata details */}
                <div className="grid gap-3 sm:grid-cols-2 text-xs">
                  <div>
                    <span className="text-slate-400 block font-semibold mb-1">Timing details</span>
                    <p className="text-slate-200">Start: {new Date(selectedSpan.startTime).toLocaleTimeString()}</p>
                    <p className="text-slate-200">
                      Duration: {selectedSpan.endTime ? `${selectedSpan.endTime - selectedSpan.startTime} ms` : "Pending"}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-semibold mb-1">Status</span>
                    <p
                      className={`font-bold ${
                        selectedSpan.status === "success"
                          ? "text-emerald-400"
                          : selectedSpan.status === "error"
                          ? "text-rose-400"
                          : "text-amber-400"
                      }`}
                    >
                      {selectedSpan.status.toUpperCase()}
                    </p>
                  </div>
                </div>

                {/* Span tags metadata list */}
                <div>
                  <span className="text-slate-400 text-xs block font-semibold mb-2 flex items-center gap-1">
                    <FiLayers /> Metadata Tags
                  </span>
                  <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
                    {Object.entries(selectedSpan.tags).length === 0 ? (
                      <p className="text-xs text-slate-500 italic">No tags attached.</p>
                    ) : (
                      Object.entries(selectedSpan.tags).map(([key, val]) => (
                        <div key={key} className="rounded bg-white/5 p-2 border border-white/5 font-mono text-[10px]">
                          <span className="text-slate-400 block">{key}</span>
                          <span className="text-white font-semibold break-all">{String(val)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Unhandled Exception readouts */}
                {selectedSpan.status === "error" && (
                  <div className="rounded-lg border border-rose-500/10 bg-rose-500/5 p-3 text-xs text-rose-300">
                    <h5 className="font-bold flex items-center gap-1.5 text-rose-400 mb-1">
                      <FiAlertTriangle /> Span Exception Details:
                    </h5>
                    <p className="font-mono text-[10px]">{selectedSpan.errorMessage}</p>
                    <p className="text-[10px] text-slate-400 mt-2">
                      Error details forwarded directly to Sentry context contextually.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-xs text-slate-500">
                Click on any span row in the timeline above to inspect detailed execution metadata tags and stack traces.
              </div>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 p-16 text-center text-xs text-slate-500">
            No trace logs selected. Refresh logs or select a transaction run on the left.
          </div>
        )}
      </section>
    </div>
  );
}
