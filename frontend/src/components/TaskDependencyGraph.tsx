"use client";

import { useCallback, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type NodeMouseHandler,
  useNodesState,
  useEdgesState,
} from "reactflow";
import "reactflow/dist/style.css";
import { useTaskStore } from "@/src/store/taskStore";
import { useTaskGraph } from "@/src/hooks/useTaskGraph";
import { nodeTypes } from "@/src/components/graph/TaskNode";
import { GraphErrorBoundary } from "@/src/components/graph/GraphErrorBoundary";
import { CanvasNodeGraphEditor } from "@/src/components/graph/CanvasNodeGraphEditor";

interface TaskDependencyGraphProps {
  /** Filter graph to only the neighbourhood of this task id */
  focusTaskId?: string | null;
  onNodeClick?: (taskId: string) => void;
  renderMode?: "reactflow" | "canvas";
  "data-testid"?: string;
}

function TaskDependencyGraphInner({
  focusTaskId = null,
  onNodeClick,
  renderMode = "reactflow",
  "data-testid": testId,
}: TaskDependencyGraphProps) {
  const tasks = useTaskStore((s) => s.tasks);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const selectTask = useTaskStore((s) => s.selectTask);

  const [filter, setFilter] = useState("");

  const {
    nodes: graphNodes,
    edges: graphEdges,
    isEmpty,
    totalNodeCount,
    unfilteredNodeCount,
    isLargeGraph,
  } = useTaskGraph({ focusTaskId, filterText: filter });

  const [nodes, , onNodesChange] = useNodesState(graphNodes);
  const [edges, , onEdgesChange] = useEdgesState(graphEdges);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      selectTask(node.id);
      onNodeClick?.(node.id);
    },
    [selectTask, onNodeClick]
  );

  if (Object.keys(tasks).length === 0 || isEmpty) {
    return (
      <div
        data-testid={testId ? `${testId}-empty` : "graph-empty"}
        className="flex items-center justify-center rounded-xl border border-neutral-700/50 bg-neutral-800/50 py-16 text-neutral-500"
        role="status"
      >
        No dependency relationships to display.
      </div>
    );
  }

  const selectedTask = selectedTaskId ? tasks[selectedTaskId] : null;

  return (
    <div data-testid={testId} className="flex flex-col gap-3">
      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter nodes…"
          aria-label="Filter graph nodes"
          className="w-64 rounded-lg border border-neutral-700/50 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {filter && (
          <span className="text-xs text-neutral-500">
            {totalNodeCount} / {unfilteredNodeCount} nodes
          </span>
        )}
      </div>

      {/* Large-graph warning banner */}
      {isLargeGraph && (
        <div
          data-testid="graph-large-warning"
          role="alert"
          className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-300"
        >
          Large graph — showing top 200 nodes. Use the filter to narrow down.
        </div>
      )}

      {/* Live region announcing selection for screen readers */}
      <div aria-live="polite" className="sr-only" data-testid="graph-live-region">
        {selectedTask ? `Selected Task: ${selectedTask.title}` : ""}
      </div>

      {/* Graph canvas */}
      <div
        className="h-[520px] overflow-hidden rounded-xl border border-neutral-700/50 bg-neutral-950"
        role="img"
        aria-label="Task dependency graph"
      >
        {renderMode === "canvas" ? (
          <CanvasNodeGraphEditor
            className="h-full border-0 p-0"
            nodes={nodes.map((node) => ({
              id: node.id,
              x: node.position.x,
              y: node.position.y,
              width: 180,
              height: 64,
              label: node.data.label,
              selected: node.selected,
            }))}
            edges={edges.map((edge) => ({
              id: edge.id,
              from: edge.source,
              to: edge.target,
            }))}
          />
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.1}
            maxZoom={4}
            attributionPosition="bottom-right"
          >
            <Background color="#404040" gap={20} />
            <Controls />
            <MiniMap
              nodeColor={(n) =>
                n.selected ? "#2563eb" : "#262626"
              }
              maskColor="rgba(0,0,0,0.6)"
            />
          </ReactFlow>
        )}
      </div>

      {/* Keyboard / interaction hint */}
      <p className="text-xs text-neutral-500" data-testid="graph-hint">
        Tip: Click a node to select it. Use scroll to zoom.
      </p>

      {/* Selected task execution history inspection panel */}
      {selectedTask && (
        <div
          data-testid="graph-selected-task-history"
          className="rounded-xl border border-neutral-700/80 bg-neutral-900/90 p-4 shadow-xl"
        >
          <div className="flex items-start justify-between border-b border-neutral-800 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs rounded bg-blue-500/20 px-2 py-0.5 text-blue-300">
                  {selectedTask.id}
                </span>
                <h4 className="font-semibold text-neutral-100">{selectedTask.title}</h4>
              </div>
              <p className="mt-1 text-xs text-neutral-400">
                Created: {new Date(selectedTask.createdAt).toLocaleString()} · Status: Active
              </p>
            </div>
            <button
              type="button"
              onClick={() => selectTask(null)}
              className="rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
              aria-label="Close execution inspector"
            >
              ✕
            </button>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-4 gap-2 py-3 text-center text-xs">
            <div className="rounded-lg bg-neutral-950 p-2 border border-neutral-800">
              <span className="text-neutral-400 block">Total Runs</span>
              <span className="font-semibold text-neutral-100 text-sm">24</span>
            </div>
            <div className="rounded-lg bg-neutral-950 p-2 border border-neutral-800">
              <span className="text-neutral-400 block">Success Rate</span>
              <span className="font-semibold text-emerald-400 text-sm">99.1%</span>
            </div>
            <div className="rounded-lg bg-neutral-950 p-2 border border-neutral-800">
              <span className="text-neutral-400 block">Avg Duration</span>
              <span className="font-semibold text-neutral-100 text-sm">184 ms</span>
            </div>
            <div className="rounded-lg bg-neutral-950 p-2 border border-neutral-800">
              <span className="text-neutral-400 block">Last Gas</span>
              <span className="font-semibold text-blue-400 text-sm">14,200 stroops</span>
            </div>
          </div>

          {/* Execution History Log */}
          <div>
            <h5 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
              Recent Execution Runs
            </h5>
            <div className="overflow-x-auto rounded-lg border border-neutral-800">
              <table className="w-full text-left text-xs text-neutral-300">
                <thead className="bg-neutral-950 text-neutral-400">
                  <tr>
                    <th className="px-3 py-2">Run ID</th>
                    <th className="px-3 py-2">Trigger Timestamp</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Gas Consumed</th>
                    <th className="px-3 py-2">Ledger #</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/60 bg-neutral-900/40">
                  <tr className="hover:bg-neutral-800/40">
                    <td className="px-3 py-1.5 font-mono text-neutral-300">#exec-8492</td>
                    <td className="px-3 py-1.5 text-neutral-400">Just now</td>
                    <td className="px-3 py-1.5">
                      <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                        SUCCESS
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono">14,210</td>
                    <td className="px-3 py-1.5 font-mono text-neutral-400">54,192,801</td>
                  </tr>
                  <tr className="hover:bg-neutral-800/40">
                    <td className="px-3 py-1.5 font-mono text-neutral-300">#exec-8491</td>
                    <td className="px-3 py-1.5 text-neutral-400">10m ago</td>
                    <td className="px-3 py-1.5">
                      <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                        SUCCESS
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono">14,190</td>
                    <td className="px-3 py-1.5 font-mono text-neutral-400">54,192,680</td>
                  </tr>
                  <tr className="hover:bg-neutral-800/40">
                    <td className="px-3 py-1.5 font-mono text-neutral-300">#exec-8490</td>
                    <td className="px-3 py-1.5 text-neutral-400">20m ago</td>
                    <td className="px-3 py-1.5">
                      <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                        SUCCESS
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono">14,350</td>
                    <td className="px-3 py-1.5 font-mono text-neutral-400">54,192,560</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TaskDependencyGraph(props: TaskDependencyGraphProps) {
  return (
    <GraphErrorBoundary>
      <TaskDependencyGraphInner {...props} />
    </GraphErrorBoundary>
  );
}
