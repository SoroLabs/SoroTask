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

      {/* Selected task detail strip */}
      {selectedTask && (
        <div
          data-testid="graph-selected-task"
          className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-300"
        >
          Selected:{" "}
          <span className="font-semibold">{selectedTask.title}</span>
          <button
            type="button"
            onClick={() => selectTask(null)}
            className="ml-3 text-xs text-neutral-400 hover:text-neutral-100"
            aria-label="Clear selection"
          >
            ✕ clear
          </button>
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
