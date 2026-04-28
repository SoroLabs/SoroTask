"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { OfflineStatusBar } from "../../src/components/OfflineStatusBar";
import { QueuedActionsList } from "../../src/components/QueuedActionsList";
import {
  createActionQueue,
  type ActionQueue,
  type QueuedAction,
} from "../../src/lib/queue/actionQueue";
import { useActionQueue } from "../../src/lib/queue/useActionQueue";
import { useOnlineStatus } from "../../src/lib/network/useOnlineStatus";

interface RegisterTaskPayload {
  contract: string;
  fn: string;
}

const STORAGE_KEY = "sorotask:offline-demo-queue";

export default function OfflineDemoPage() {
  const { online: realOnline } = useOnlineStatus();
  const [forceOffline, setForceOffline] = useState(false);
  const [failureRate, setFailureRate] = useState(0);
  const [contract, setContract] = useState("CABCDEF1234");
  const [fn, setFn] = useState("harvest_yield");

  // Read from refs inside the handler so updates to failureRate take
  // effect immediately for in-flight retries without re-registering.
  const failureRateRef = useRef(failureRate);
  useEffect(() => {
    failureRateRef.current = failureRate;
  }, [failureRate]);

  const effectiveOnline = realOnline && !forceOffline;

  const queue: ActionQueue = useMemo(
    () =>
      createActionQueue({
        storageKey: STORAGE_KEY,
        baseDelayMs: 800,
        maxDelayMs: 4_000,
        maxAttempts: 4,
      }),
    [],
  );

  // Register the mock handler once.
  useEffect(() => {
    queue.registerHandler<RegisterTaskPayload>(
      "register-task",
      async (action) => {
        // Simulate a real network round-trip.
        await new Promise((r) => setTimeout(r, 600));
        if (Math.random() < failureRateRef.current) {
          throw new Error("Simulated RPC error");
        }
        // Success path: nothing to return.
        void action;
      },
    );
  }, [queue]);

  // Drive the queue's online state from the effective signal.
  useEffect(() => {
    queue.setOnline(effectiveOnline);
  }, [queue, effectiveOnline]);

  const { actions, retry, cancel, remove, clearCompleted } =
    useActionQueue(queue);

  const queuedCount = actions.filter(
    (a) => a.status === "pending" || a.status === "in_flight",
  ).length;
  const resyncing = effectiveOnline && actions.some((a) => a.status === "in_flight");

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold">Offline Support — Spike</h1>
          <p className="text-sm text-neutral-400">
            Primitives only: online status hook + status bar + persisted action
            queue with replay on reconnect. No service worker. See{" "}
            <code>frontend/docs/offline-support.md</code> for scope and
            limitations.
          </p>
        </header>

        <OfflineStatusBar
          online={effectiveOnline}
          queuedCount={queuedCount}
          resyncing={resyncing}
        />

        <section className="space-y-3 rounded-xl border border-neutral-700/50 bg-neutral-800/40 p-4">
          <h2 className="text-lg font-semibold">Demo controls</h2>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={forceOffline}
                onChange={(e) => setForceOffline(e.target.checked)}
                data-testid="force-offline-toggle"
              />
              Force offline mode
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span>Simulated failure rate:</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={failureRate * 100}
                onChange={(e) =>
                  setFailureRate(Number(e.target.value) / 100)
                }
              />
              <span className="font-mono text-xs w-10 text-right">
                {Math.round(failureRate * 100)}%
              </span>
            </label>
            <span className="text-xs text-neutral-500">
              Browser reports{" "}
              <code>{realOnline ? "online" : "offline"}</code>.
            </span>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-neutral-700/50 bg-neutral-800/40 p-4">
          <h2 className="text-lg font-semibold">Enqueue a mock action</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block text-neutral-400 mb-1">Contract</span>
              <input
                value={contract}
                onChange={(e) => setContract(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 font-mono text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="block text-neutral-400 mb-1">Function</span>
              <input
                value={fn}
                onChange={(e) => setFn(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 font-mono text-sm"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() =>
              queue.enqueue<RegisterTaskPayload>("register-task", {
                contract,
                fn,
              })
            }
            data-testid="enqueue-action"
            className="px-3 py-1 rounded-md text-sm bg-blue-600 hover:bg-blue-500 text-white"
          >
            Enqueue
          </button>
          <p className="text-xs text-neutral-500">
            While offline, the action stays <em>pending</em> and replays
            automatically on reconnect.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Queue</h2>
          <QueuedActionsList
            actions={actions}
            onRetry={retry}
            onCancel={cancel}
            onRemove={remove}
            onClearCompleted={clearCompleted}
            describe={describeAction}
          />
        </section>
      </div>
    </div>
  );
}

function describeAction(action: QueuedAction): string {
  if (action.type === "register-task") {
    const p = action.payload as RegisterTaskPayload;
    return `${p.fn} @ ${p.contract}`;
  }
  try {
    return JSON.stringify(action.payload);
  } catch {
    return "[unserializable]";
  }
}
