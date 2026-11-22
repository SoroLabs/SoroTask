'use client';

import React, { useMemo } from 'react';
import { useCrossChainTasks } from '../useCrossChainTasks';
import BridgeLifecycleTracker from './BridgeLifecycleTracker';
import { CrossChainTaskRow } from './CrossChainTaskRow';
import { NETWORKS, type NetworkId, type CrossChainTaskStatus } from '../types';
import { StateProofVerifierPanel } from './StateProofVerifierPanel';

const STATUS_FILTERS: Array<CrossChainTaskStatus | 'all'> = ['all', 'active', 'paused', 'completed', 'failed'];

const BRIDGE_EVENT_LABELS = {
  initiated: { text: 'Initiated', color: 'text-blue-400' },
  in_flight: { text: 'In Flight', color: 'text-yellow-400' },
  settled:   { text: 'Settled',   color: 'text-green-400' },
  failed:    { text: 'Failed',    color: 'text-red-400' },
};

export function CrossChainTaskManager() {
  const {
    tasks,
    allTasks,
    bridgeEvents,
    networkFilter,
    statusFilter,
    setNetworkFilter,
    setStatusFilter,
  } = useCrossChainTasks();

  // Union of all networks appearing in visible tasks (for column headers)
  const allNetworks = useMemo<NetworkId[]>(() => {
    const seen = new Set<NetworkId>();
    tasks.forEach((t) => t.networks.forEach((n) => seen.add(n)));
    // Ensure stable order matching NETWORKS definition
    return (Object.keys(NETWORKS) as NetworkId[]).filter((n) => seen.has(n));
  }, [tasks]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900 px-6 py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold">Cross-Chain Task Manager</h1>
            <p className="text-sm text-neutral-400 mt-0.5">
              Monitor tasks spanning multiple networks in real-time
            </p>
          </div>
          <span className="text-xs text-neutral-500 bg-neutral-800 px-3 py-1 rounded-full">
            {tasks.length} task{tasks.length !== 1 ? 's' : ''}
          </span>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {/* Network filter tabs */}
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by network">
          <button
            role="tab"
            aria-selected={networkFilter === 'all'}
            onClick={() => setNetworkFilter('all')}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              networkFilter === 'all'
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'border-neutral-700 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            All networks
          </button>
          {(Object.keys(NETWORKS) as NetworkId[]).map((netId) => {
            const net = NETWORKS[netId];
            return (
              <button
                key={netId}
                role="tab"
                aria-selected={networkFilter === netId}
                onClick={() => setNetworkFilter(netId)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  networkFilter === netId
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : `border-neutral-700 ${net.color} hover:border-neutral-500`
                }`}
              >
                {net.icon} {net.label}
              </button>
            );
          })}
        </div>

        {/* Status filter */}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s === 'all' ? 'all' : s as CrossChainTaskStatus)}
              aria-pressed={statusFilter === s}
              className={`px-3 py-1 rounded text-xs capitalize font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-neutral-700 text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Task table */}
        {tasks.length === 0 ? (
          <div className="text-center py-16 text-neutral-500">
            <p className="text-3xl mb-3" aria-hidden="true">🔗</p>
            <p className="text-sm">No tasks match the current filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-800">
            <table className="w-full text-sm" aria-label="Cross-chain tasks">
              <thead className="bg-neutral-900 border-b border-neutral-800">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-400">Task</th>
                  {allNetworks.map((netId) => (
                    <th key={netId} className="px-4 py-3 text-center text-xs font-medium text-neutral-400">
                      {NETWORKS[netId].icon} {NETWORKS[netId].label}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-400">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-400">Updated</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <CrossChainTaskRow
                    key={task.id}
                    task={task}
                    allNetworks={allNetworks}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Bridge event log */}
        <section aria-label="Bridge event log">
          <h2 className="text-sm font-semibold text-neutral-300 mb-3">Bridge Event Log</h2>
          {bridgeEvents.length === 0 ? (
            <p className="text-xs text-neutral-600">No bridge events recorded.</p>
          ) : (
            <div className="space-y-1.5">
              {bridgeEvents.map((ev) => {
                const label = BRIDGE_EVENT_LABELS[ev.eventType];
                const from = NETWORKS[ev.fromNetwork];
                const to = NETWORKS[ev.toNetwork];
                return (
                  <div
                    key={ev.id}
                    data-testid={`bridge-event-${ev.id}`}
                    className="flex items-center gap-3 bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-2 text-xs"
                  >
                    <span className={`font-medium w-16 shrink-0 ${label.color}`}>{label.text}</span>
                    <span className="text-neutral-400">
                      {from.icon} {from.label} → {to.icon} {to.label}
                    </span>
                    <span className="text-neutral-600 font-mono ml-auto">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Message lifecycle per task (Issue #1252). Rendered per task rather
            than as one aggregate view: "where is my message" is a question
            about one message, and averaging several hides the stuck one. */}
        <section aria-label="Cross-chain message lifecycles" className="space-y-4">
          <h2 className="text-sm font-semibold text-neutral-300">Message Lifecycle</h2>
          {tasks.length === 0 ? (
            <p className="text-xs text-neutral-600">No tasks to track.</p>
          ) : (
            tasks.map((task) => (
              <BridgeLifecycleTracker key={task.id} task={task} events={bridgeEvents} />
            ))
          )}
        </section>

        <StateProofVerifierPanel tasks={allTasks} bridgeEvents={bridgeEvents} />
      </div>
    </div>
  );
}
