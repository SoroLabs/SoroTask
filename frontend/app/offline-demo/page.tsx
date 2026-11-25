"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { OfflineStatusBar } from "../../src/components/OfflineStatusBar";
import { QueuedActionsList } from "../../src/components/QueuedActionsList";
import {
  createActionQueue,
  type ActionQueue,
  type QueuedAction,
} from "../../src/lib/queue/actionQueue";
import { useActionQueue } from "../../src/lib/queue/useActionQueue";
import { useOnlineStatus } from "../../src/lib/network/useOnlineStatus";
import {
  offlineStore,
  type TaskRecord,
  type OutboxMutation,
  type SyncConflict,
} from "../../src/lib/offlineStore";

interface RegisterTaskPayload {
  contract: string;
  fn: string;
}

const STORAGE_KEY = "sorotask:offline-demo-queue";

export default function OfflineDemoPage() {
  const { online: realOnline } = useOnlineStatus();
  const [forceOffline, setForceOffline] = useState(false);
  const [failureRate, setFailureRate] = useState(0);

  // Task form state
  const [taskName, setTaskName] = useState("Yield Harvester Pipeline");
  const [contract, setContract] = useState("CABCDEF1234567890ABCDEF1234567890ABCDEF12");
  const [fn, setFn] = useState("harvest_yield");
  const [interval, setInterval] = useState(3600);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  // Offline store state
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [outbox, setOutbox] = useState<OutboxMutation[]>([]);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);

  const failureRateRef = useRef(failureRate);
  useEffect(() => {
    failureRateRef.current = failureRate;
  }, [failureRate]);

  const effectiveOnline = realOnline && !forceOffline;
  const prevOnlineRef = useRef(effectiveOnline);

  const loadOfflineData = useCallback(async () => {
    const [allTasks, allOutbox, allConflicts] = await Promise.all([
      offlineStore.getAllTasks(),
      offlineStore.getOutbox(),
      offlineStore.getConflicts(),
    ]);
    setTasks(allTasks);
    setOutbox(allOutbox);
    setConflicts(allConflicts);
  }, []);

  useEffect(() => {
    loadOfflineData();
    const unsubscribe = offlineStore.subscribe(() => {
      loadOfflineData();
    });
    return () => unsubscribe();
  }, [loadOfflineData]);

  // Handle automatic CRDT sync when network reconnects
  const triggerAutoSync = useCallback(async () => {
    setIsSyncing(true);
    setSyncStatusMsg("Reconnecting... Running CRDT optimistic sync");
    try {
      // Simulate remote server tasks for sync verification
      const remoteMockTasks: TaskRecord[] = tasks.map((t) => ({ ...t }));
      const result = await offlineStore.syncWithRemote(remoteMockTasks);
      setSyncStatusMsg(
        `Sync completed: ${result.syncedCount} mutations applied, ${result.conflictsCount} conflicts detected.`
      );
    } catch (err: any) {
      setSyncStatusMsg(`Sync failed: ${err?.message || "Unknown error"}`);
    } finally {
      setIsSyncing(false);
      loadOfflineData();
    }
  }, [tasks, loadOfflineData]);

  useEffect(() => {
    if (!prevOnlineRef.current && effectiveOnline) {
      // Reconnected!
      triggerAutoSync();
    }
    prevOnlineRef.current = effectiveOnline;
  }, [effectiveOnline, triggerAutoSync]);

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

  useEffect(() => {
    queue.registerHandler<RegisterTaskPayload>(
      "register-task",
      async (action) => {
        await new Promise((r) => setTimeout(r, 600));
        if (Math.random() < failureRateRef.current) {
          throw new Error("Simulated RPC error");
        }
        void action;
      },
    );
  }, [queue]);

  useEffect(() => {
    queue.setOnline(effectiveOnline);
  }, [queue, effectiveOnline]);

  const { actions, retry, cancel, remove, clearCompleted } =
    useActionQueue(queue);

  const queuedCount = actions.filter(
    (a) => a.status === "pending" || a.status === "in_flight",
  ).length + outbox.length;
  const resyncing = isSyncing || (effectiveOnline && actions.some((a) => a.status === "in_flight"));

  // Task creation/update handler
  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskName || !contract || !fn) return;

    const id = editingTaskId || "task_" + Math.random().toString(36).substring(2, 9);
    await offlineStore.saveTask(
      {
        id,
        name: taskName,
        contract,
        fn,
        interval,
        status: "active",
      },
      effectiveOnline
    );

    // Also push to actionQueue for backward demo compatibility
    queue.enqueue<RegisterTaskPayload>("register-task", {
      contract,
      fn,
    });

    setEditingTaskId(null);
    setTaskName("Yield Harvester Pipeline " + (tasks.length + 1));
  };

  const handleEditTask = (task: TaskRecord) => {
    setEditingTaskId(task.id);
    setTaskName(task.name);
    setContract(task.contract);
    setFn(task.fn);
    setInterval(task.interval);
  };

  const handleDeleteTask = async (id: string) => {
    await offlineStore.deleteTask(id);
  };

  // Simulate remote concurrent modification to generate a visual CRDT conflict
  const handleSimulateConflict = async (task: TaskRecord) => {
    const remoteVersion: TaskRecord = {
      ...task,
      name: `${task.name} (Remote Server Edit)`,
      fn: `${task.fn}_v2`,
      updatedAt: Date.now() + 5000,
      nodeId: "remote_validator_node",
      crdtClock: {
        ...(task.crdtClock || {}),
        remote_validator_node: 5,
      },
    };
    await offlineStore.recordConflict(task, remoteVersion);
  };

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="space-y-1">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Offline-First Task Management & CRDT Sync</h1>
            <span
              className={`px-3 py-1 text-xs font-semibold rounded-full ${
                effectiveOnline
                  ? "bg-emerald-950 text-emerald-400 border border-emerald-700/50"
                  : "bg-amber-950 text-amber-400 border border-amber-700/50"
              }`}
            >
              {effectiveOnline ? "● ONLINE" : "○ OFFLINE (IndexedDB Mode)"}
            </span>
          </div>
          <p className="text-sm text-neutral-400">
            Create, edit, and organize automation pipelines offline with zero data loss.
            Changes are persisted in IndexedDB, queued in the mutation outbox, and automatically synchronized using CRDTs upon network reconnection.
          </p>
        </header>

        <OfflineStatusBar
          online={effectiveOnline}
          queuedCount={queuedCount}
          resyncing={resyncing}
        />

        {syncStatusMsg && (
          <div className="p-3 text-xs rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-300 flex items-center justify-between">
            <span>{syncStatusMsg}</span>
            <button
              onClick={() => setSyncStatusMsg(null)}
              className="text-neutral-500 hover:text-neutral-300"
            >
              ✕
            </button>
          </div>
        )}

        {/* Demo Controls */}
        <section className="space-y-3 rounded-xl border border-neutral-700/50 bg-neutral-800/40 p-4">
          <h2 className="text-lg font-semibold">Connection & Sync Controls</h2>
          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={forceOffline}
                onChange={(e) => setForceOffline(e.target.checked)}
                data-testid="force-offline-toggle"
                className="rounded border-neutral-700 bg-neutral-900"
              />
              <span className="font-medium text-amber-300">Simulate Network Disconnection</span>
            </label>
            <button
              type="button"
              onClick={triggerAutoSync}
              disabled={!effectiveOnline || isSyncing}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition-colors"
            >
              {isSyncing ? "Syncing CRDT Outbox..." : "Force Trigger Sync Now"}
            </button>
            <div className="text-xs text-neutral-400">
              Outbox queued: <span className="font-mono text-amber-400 font-bold">{outbox.length}</span> |
              Conflicts: <span className="font-mono text-rose-400 font-bold">{conflicts.length}</span>
            </div>
          </div>
        </section>

        {/* Visual Conflict Resolution UI */}
        {conflicts.length > 0 && (
          <section className="space-y-4 rounded-xl border border-rose-500/40 bg-rose-950/20 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-rose-300 flex items-center gap-2">
                  <span>⚠️</span> CRDT Concurrent Conflict Resolution
                </h2>
                <p className="text-xs text-neutral-400 mt-1">
                  Concurrent modifications detected across offline client and remote network. Choose a resolution strategy below:
                </p>
              </div>
              <span className="text-xs px-2 py-1 bg-rose-900 text-rose-200 rounded font-mono">
                {conflicts.length} pending conflict{conflicts.length > 1 ? "s" : ""}
              </span>
            </div>

            <div className="space-y-4">
              {conflicts.map((conflict) => (
                <div
                  key={conflict.id}
                  className="rounded-lg border border-neutral-700 bg-neutral-900/90 p-4 space-y-3"
                >
                  <div className="text-xs font-mono text-neutral-400">
                    Task ID: <span className="text-neutral-200">{conflict.taskId}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Local Version */}
                    <div className="p-3 rounded border border-blue-800/40 bg-blue-950/20 space-y-1 text-xs">
                      <div className="font-bold text-blue-400 flex justify-between">
                        <span>[Local Offline Version]</span>
                        <span className="font-mono text-neutral-400">Node: {conflict.local.nodeId}</span>
                      </div>
                      <div>Name: <span className="text-neutral-200 font-medium">{conflict.local.name}</span></div>
                      <div>Function: <span className="font-mono text-neutral-300">{conflict.local.fn}</span></div>
                      <div className="text-neutral-500">Updated: {new Date(conflict.local.updatedAt).toLocaleTimeString()}</div>
                    </div>

                    {/* Remote Version */}
                    <div className="p-3 rounded border border-purple-800/40 bg-purple-950/20 space-y-1 text-xs">
                      <div className="font-bold text-purple-400 flex justify-between">
                        <span>[Remote Network Version]</span>
                        <span className="font-mono text-neutral-400">Node: {conflict.remote.nodeId}</span>
                      </div>
                      <div>Name: <span className="text-neutral-200 font-medium">{conflict.remote.name}</span></div>
                      <div>Function: <span className="font-mono text-neutral-300">{conflict.remote.fn}</span></div>
                      <div className="text-neutral-500">Updated: {new Date(conflict.remote.updatedAt).toLocaleTimeString()}</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-neutral-800">
                    <button
                      type="button"
                      onClick={() => offlineStore.resolveConflict(conflict.id, "local")}
                      className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium"
                    >
                      Keep Local Version
                    </button>
                    <button
                      type="button"
                      onClick={() => offlineStore.resolveConflict(conflict.id, "remote")}
                      className="px-3 py-1 text-xs rounded bg-purple-600 hover:bg-purple-500 text-white font-medium"
                    >
                      Accept Remote Version
                    </button>
                    <button
                      type="button"
                      onClick={() => offlineStore.resolveConflict(conflict.id, "merged")}
                      className="px-3 py-1 text-xs rounded bg-emerald-700 hover:bg-emerald-600 text-white font-medium"
                    >
                      Auto-Merge CRDT (LWW)
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Task Management Form */}
        <section className="space-y-4 rounded-xl border border-neutral-700/50 bg-neutral-800/40 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {editingTaskId ? "Edit Task (Offline/Online)" : "Draft Automation Task"}
            </h2>
            {editingTaskId && (
              <button
                type="button"
                onClick={() => {
                  setEditingTaskId(null);
                  setTaskName("");
                }}
                className="text-xs text-neutral-400 hover:text-neutral-200"
              >
                Cancel Edit
              </button>
            )}
          </div>

          <form onSubmit={handleSaveTask} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="block text-neutral-400 mb-1">Task Pipeline Name</span>
                <input
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="e.g. Daily Liquidity Rebalance"
                  className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-2.5 py-1.5 text-sm"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="block text-neutral-400 mb-1">Interval (seconds)</span>
                <input
                  type="number"
                  value={interval}
                  onChange={(e) => setInterval(Number(e.target.value))}
                  className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-2.5 py-1.5 font-mono text-sm"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="block text-neutral-400 mb-1">Contract Address</span>
                <input
                  value={contract}
                  onChange={(e) => setContract(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-2.5 py-1.5 font-mono text-sm"
                  required
                />
              </label>
              <label className="text-sm">
                <span className="block text-neutral-400 mb-1">Function Name</span>
                <input
                  value={fn}
                  onChange={(e) => setFn(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-2.5 py-1.5 font-mono text-sm"
                  required
                />
              </label>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                className="px-4 py-2 rounded-md text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {editingTaskId ? "Update Task" : "Save Task Locally (IndexedDB)"}
              </button>
              <span className="text-xs text-neutral-400">
                {effectiveOnline
                  ? "Saves to IndexedDB and queues for blockchain submission."
                  : "Saved offline in IndexedDB. Will sync when reconnected."}
              </span>
            </div>
          </form>
        </section>

        {/* Browsable & Editable Tasks List */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Persisted Tasks ({tasks.length})
            </h2>
            <span className="text-xs text-neutral-400">
              Storage: IndexedDB (<code className="text-emerald-400">sorotask-crdt-offline</code>)
            </span>
          </div>

          {tasks.length === 0 ? (
            <div className="p-8 text-center border border-dashed border-neutral-700 rounded-xl text-neutral-500 text-sm">
              No tasks stored in IndexedDB. Use the form above to draft one while offline!
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-xl border border-neutral-700/60 bg-neutral-800/40 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-neutral-100">{task.name}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-neutral-700 text-neutral-300 font-mono">
                        {task.status}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-neutral-400">
                      <code>{task.fn}</code> @ <code>{task.contract.slice(0, 12)}...</code> | Interval: {task.interval}s
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      Last edited: {new Date(task.updatedAt).toLocaleTimeString()} · Clock: {JSON.stringify(task.crdtClock)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-center">
                    <button
                      type="button"
                      onClick={() => handleEditTask(task)}
                      className="px-2.5 py-1 text-xs rounded border border-neutral-600 bg-neutral-700/50 hover:bg-neutral-600 text-neutral-200"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSimulateConflict(task)}
                      className="px-2.5 py-1 text-xs rounded border border-amber-600/50 bg-amber-950/30 text-amber-300 hover:bg-amber-900/40"
                      title="Simulate remote concurrent edit to test CRDT conflict resolution"
                    >
                      Simulate Conflict
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTask(task.id)}
                      className="px-2.5 py-1 text-xs rounded border border-rose-700/40 bg-rose-950/20 text-rose-300 hover:bg-rose-900/40"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Mutation Outbox */}
        <section className="space-y-3 rounded-xl border border-neutral-700/50 bg-neutral-800/40 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Offline Mutation Outbox ({outbox.length})</h2>
            {outbox.length > 0 && (
              <button
                type="button"
                onClick={() => offlineStore.clearOutbox()}
                className="text-xs text-neutral-400 hover:text-neutral-200"
              >
                Clear Outbox
              </button>
            )}
          </div>
          {outbox.length === 0 ? (
            <p className="text-xs text-neutral-500">Outbox is empty. All local edits are synchronized.</p>
          ) : (
            <div className="space-y-2">
              {outbox.map((mut) => (
                <div
                  key={mut.id}
                  className="flex items-center justify-between p-2 rounded bg-neutral-900/70 border border-neutral-800 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-amber-400 uppercase font-semibold">
                      [{mut.action}]
                    </span>
                    <span className="font-mono text-neutral-300">Task: {mut.taskId}</span>
                  </div>
                  <div className="flex items-center gap-3 text-neutral-500 font-mono text-[11px]">
                    <span>Status: {mut.status}</span>
                    <span>{new Date(mut.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Action Queue List */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Replay Action Queue</h2>
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
