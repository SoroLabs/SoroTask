"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { ErrorPayload, ProcessedError } from '../lib/errorRecoveryWorker';

export function ErrorBoundaryGranularRecoveryDashboard() {
  const workerRef = useRef<Worker | null>(null);
  const [errors, setErrors] = useState<ErrorPayload[]>([]);
  const [processedErrors, setProcessedErrors] = useState<ProcessedError[]>([]);
  const [isWorkerReady, setIsWorkerReady] = useState(false);

  useEffect(() => {
    // Initialize Web Worker for off-main-thread processing
    try {
      workerRef.current = new Worker(
        new URL('../lib/errorRecoveryWorker.ts', import.meta.url),
        { type: 'module' }
      );

      workerRef.current.onmessage = (event: MessageEvent) => {
        const { type, payload } = event.data;
        if (type === 'ERROR_PROCESSED') {
          setProcessedErrors((prev) => [payload, ...prev]);
        }
      };

      setIsWorkerReady(true);
    } catch (e) {
      console.error("Failed to initialize Error Recovery Worker:", e);
      setIsWorkerReady(false);
    }

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const simulateError = useCallback((message: string) => {
    const newError: ErrorPayload = {
      id: crypto.randomUUID(),
      message,
      timestamp: Date.now(),
      componentStack: 'Simulated Component Stack',
    };
    
    setErrors((prev) => [newError, ...prev]);

    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'PROCESS_ERROR',
        payload: newError,
      });
    }
  }, []);

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-10 bg-slate-950 text-slate-200">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="rounded-[32px] border border-white/10 bg-[linear-gradient(145deg,rgba(220,38,38,0.15),rgba(15,23,42,0.92)_45%,rgba(34,197,94,0.16))] p-6 shadow-[0_30px_90px_rgba(2,8,23,0.45)]">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl space-y-3">
              <p className="text-sm uppercase tracking-[0.32em] text-red-300/80">
                System Resilience
              </p>
              <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Error Boundary Granular Recovery
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-200/85 sm:text-base">
                Advanced dashboard utilizing Web Workers for off-main-thread error processing and fault-tolerant data pipelines to maintain platform stability.
              </p>
            </div>
            <div className="grid min-w-[280px] gap-3 rounded-3xl border border-white/10 bg-slate-950/45 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span>Worker Status</span>
                <span className={`rounded-full px-3 py-1 font-medium ${isWorkerReady ? 'bg-emerald-500/15 text-emerald-100' : 'bg-rose-500/15 text-rose-100'}`}>
                  {isWorkerReady ? 'Active' : 'Offline'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Total Errors</span>
                <span className="rounded-full bg-white/10 px-3 py-1 font-medium text-white">{errors.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Processed</span>
                <span className="rounded-full bg-white/10 px-3 py-1 font-medium text-white">{processedErrors.length}</span>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-2">
          {/* Controls and Raw Errors */}
          <section className="space-y-6">
            <div className="rounded-[28px] border border-white/10 bg-slate-900/50 p-6 shadow-[0_24px_70px_rgba(2,8,23,0.3)]">
              <h2 className="text-2xl font-semibold text-white mb-4">Simulate Failures</h2>
              <div className="flex flex-wrap gap-4">
                <button
                  onClick={() => simulateError("Recoverable: Network timeout fetching config")}
                  className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                >
                  Simulate Recoverable
                </button>
                <button
                  onClick={() => simulateError("Warning: High memory usage detected")}
                  className="rounded-full bg-amber-500/10 border border-amber-500/20 px-4 py-2 text-amber-300 hover:bg-amber-500/20 transition-colors"
                >
                  Simulate Warning
                </button>
                <button
                  onClick={() => simulateError("Critical: Main database connection lost")}
                  className="rounded-full bg-rose-500/10 border border-rose-500/20 px-4 py-2 text-rose-300 hover:bg-rose-500/20 transition-colors"
                >
                  Simulate Critical
                </button>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-slate-900/50 p-6 shadow-[0_24px_70px_rgba(2,8,23,0.3)] h-[500px] overflow-y-auto">
              <h2 className="text-2xl font-semibold text-white mb-4">Raw Error Stream</h2>
              <div className="space-y-3">
                {errors.length === 0 ? (
                  <p className="text-slate-400 italic">No errors detected.</p>
                ) : (
                  errors.map(err => (
                    <div key={err.id} className="p-4 rounded-2xl bg-white/5 border border-white/10">
                      <p className="text-sm font-mono text-slate-300">{err.id}</p>
                      <p className="text-white mt-1">{err.message}</p>
                      <p className="text-xs text-slate-500 mt-2">{new Date(err.timestamp).toLocaleTimeString()}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          {/* Processed Errors */}
          <section className="rounded-[28px] border border-white/10 bg-slate-900/50 p-6 shadow-[0_24px_70px_rgba(2,8,23,0.3)] h-[692px] overflow-y-auto">
            <h2 className="text-2xl font-semibold text-white mb-4">Granular Recovery Pipeline</h2>
            <div className="space-y-4">
              {processedErrors.length === 0 ? (
                <p className="text-slate-400 italic">No processed errors.</p>
              ) : (
                processedErrors.map(err => (
                  <div key={err.id} className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-3">
                    <div className="flex justify-between items-start">
                      <span className={`px-2 py-1 text-xs rounded font-medium ${
                        err.recoveryStatus === 'Critical' ? 'bg-rose-500/20 text-rose-300' :
                        err.recoveryStatus === 'Warning' ? 'bg-amber-500/20 text-amber-300' :
                        'bg-emerald-500/20 text-emerald-300'
                      }`}>
                        {err.recoveryStatus}
                      </span>
                      <span className="text-xs text-slate-500">
                        Processed in {err.processedAt - err.timestamp}ms
                      </span>
                    </div>
                    <p className="text-white font-medium">{err.message}</p>
                    <div className="bg-black/20 p-3 rounded-xl border border-white/5">
                      <p className="text-sm text-slate-300">
                        <span className="text-slate-500">Action:</span> {err.suggestedAction}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
