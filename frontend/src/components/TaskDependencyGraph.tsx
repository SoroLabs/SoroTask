"use client";

import { useCallback, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeMouseHandler,
  MarkerType,
  useNodesState,
  useEdgesState,
} from "reactflow";
import "reactflow/dist/style.css";
import type { TaskDependency } from "@/src/types/task";
import {
  buildGraphData,
  filterToNeighbourhood,
} from "@/src/lib/graphUtils";
import { useTaskStore } from "@/src/store/taskStore";

interface TaskDependencyGraphProps {
  /** Filter graph to only the neighbourhood of this task id */
  focusTaskId?: string | null;
  onNodeClick?: (taskId: string) => void;
  "data-testid"?: string;
}

/** Convert our GraphNode/GraphEdge into ReactFlow Node/Edge shapes */
function toRFNodes(
  nodes: ReturnType<typeof buildGraphData>["nodes"]
): Node[] {
  return nodes.map((n, i) => ({
    id: n.id,
    data: { label: n.label },
    position: { x: (i % 5) * 200, y: Math.floor(i / 5) * 120 },
    style: n.selected
      ? {
          background: "#2563eb",
          color: "#fff",
          border: "2px solid #1d4ed8",
          borderRadius: 8,
          fontWeight: 600,
        }
      : {
          background: "#262626",
          color: "#e5e5e5",
          border: "1px solid #404040",
          borderRadius: 8,
        },
  }));
}

function toRFEdges(
  edges: ReturnType<typeof buildGraphData>["edges"]
): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280" },
    style: { stroke: "#6b7280" },
    animated: false,
  }));
}

export default function TaskDependencyGraph({
  focusTaskId = null,
  onNodeClick,
  "data-testid": testId,
}: TaskDependencyGraphProps) {
  const tasks = useTaskStore((s) => s.tasks);
  const allDeps = useTaskStore((s) => s.dependencies);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const selectTask = useTaskStore((s) => s.selectTask);

  const [filter, setFilter] = useState("");

  // Optionally narrow to neighbourhood of focusTaskId
  const deps: TaskDependency[] = useMemo(
    () =>
      focusTaskId
        ? filterToNeighbourhood(focusTaskId, allDeps)
        : allDeps,
    [focusTaskId, allDeps]
  );

  const { nodes: gNodes, edges: gEdges } = useMemo(
    () => buildGraphData(tasks, deps, selectedTaskId),
    [tasks, deps, selectedTaskId]
  );

  // Apply text filter
  const filteredNodes = useMemo(() => {
    if (!filter.trim()) return gNodes;
    const q = filter.toLowerCase();
    return gNodes.filter((n) => n.label.toLowerCase().includes(q));
  }, [gNodes, filter]);

  const filteredNodeIds = useMemo(
    () => new Set(filteredNodes.map((n) => n.id)),
    [filteredNodes]
  );

  const filteredEdges = useMemo(
    () =>
      gEdges.filter(
        (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
      ),
    [gEdges, filteredNodeIds]
  );

  const [nodes, , onNodesChange] = useNodesState(toRFNodes(filteredNodes));
  const [edges, , onEdgesChange] = useEdgesState(toRFEdges(filteredEdges));

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      selectTask(node.id);
      onNodeClick?.(node.id);
    },
    [selectTask, onNodeClick]
  );

  if (Object.keys(tasks).length === 0 || gNodes.length === 0) {
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

  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-3"
    >
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
            {filteredNodes.length} / {gNodes.length} nodes
          </span>
        )}
      </div>

      {/* Graph canvas */}
      <div
        className="h-[520px] overflow-hidden rounded-xl border border-neutral-700/50 bg-neutral-950"
        role="img"
        aria-label="Task dependency graph"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
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
              (n.style?.background as string) ?? "#262626"
            }
            maskColor="rgba(0,0,0,0.6)"
          />
        </ReactFlow>
      </div>

      {/* Selected task detail strip */}
      {selectedTaskId && tasks[selectedTaskId] && (
        <div
          data-testid="graph-selected-task"
          className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-300"
        >
          Selected:{" "}
          <span className="font-semibold">
            {tasks[selectedTaskId].title}
          </span>
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
