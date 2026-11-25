import { useMemo } from "react";
import { MarkerType, type Node, type Edge } from "reactflow";
import { useTaskStore } from "@/src/store/taskStore";
import {
  buildGraphData,
  filterToNeighbourhood,
  shouldVirtualizeGraph,
  GRAPH_VIRTUALIZE_THRESHOLD,
} from "@/src/lib/graphUtils";
import {
  layoutGraph,
  DEFAULT_NODE_HEIGHT,
} from "@/src/lib/graphLayout";
import { TASK_NODE_WIDTH, type TaskNodeData } from "@/src/components/graph/TaskNode";

export interface UseTaskGraphOptions {
  focusTaskId?: string | null;
  filterText?: string;
}

export interface UseTaskGraphResult {
  nodes: Node<TaskNodeData>[];
  edges: Edge[];
  isEmpty: boolean;
  /** Number of nodes after the text filter is applied. */
  totalNodeCount: number;
  /** Number of nodes before the text filter is applied. */
  unfilteredNodeCount: number;
  isLargeGraph: boolean;
}

/**
 * Builds ReactFlow-ready nodes and edges from the task store, applying an
 * optional focus-neighbourhood filter, a text filter, large-graph slicing, and
 * a dagre layout. Heavily memoized so ReactFlow doesn't re-render on every
 * keystroke when inputs are unchanged.
 */
export function useTaskGraph(
  options: UseTaskGraphOptions = {}
): UseTaskGraphResult {
  const { focusTaskId = null, filterText = "" } = options;

  const tasks = useTaskStore((s) => s.tasks);
  const allDeps = useTaskStore((s) => s.dependencies);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);

  const deps = useMemo(
    () => (focusTaskId ? filterToNeighbourhood(focusTaskId, allDeps) : allDeps),
    [focusTaskId, allDeps]
  );

  const { nodes: gNodes, edges: gEdges } = useMemo(
    () => buildGraphData(tasks, deps, selectedTaskId),
    [tasks, deps, selectedTaskId]
  );

  const filteredNodes = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return gNodes;
    return gNodes.filter((n) => n.label.toLowerCase().includes(q));
  }, [gNodes, filterText]);

  const totalNodeCount = filteredNodes.length;
  const isLargeGraph = shouldVirtualizeGraph(totalNodeCount);

  const visibleNodes = useMemo(
    () =>
      isLargeGraph
        ? filteredNodes.slice(0, GRAPH_VIRTUALIZE_THRESHOLD)
        : filteredNodes,
    [filteredNodes, isLargeGraph]
  );

  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map((n) => n.id)),
    [visibleNodes]
  );

  const visibleEdges = useMemo(
    () =>
      gEdges.filter(
        (e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)
      ),
    [gEdges, visibleNodeIds]
  );

  const nodes = useMemo<Node<TaskNodeData>[]>(() => {
    const positioned = layoutGraph(
      visibleNodes.map((n) => ({
        id: n.id,
        width: TASK_NODE_WIDTH,
        height: DEFAULT_NODE_HEIGHT,
      })),
      visibleEdges.map((e) => ({ source: e.source, target: e.target }))
    );
    const posById = new Map(positioned.map((p) => [p.id, p]));

    return visibleNodes.map((n) => {
      const pos = posById.get(n.id);
      return {
        id: n.id,
        type: "taskNode",
        position: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
        selected: n.selected,
        data: {
          label: n.label,
          status: n.selected ? "selected" : "pending",
        },
      };
    });
  }, [visibleNodes, visibleEdges]);

  const edges = useMemo<Edge[]>(
    () =>
      visibleEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280" },
        style: { stroke: "#6b7280" },
      })),
    [visibleEdges]
  );

  return {
    nodes,
    edges,
    isEmpty: gNodes.length === 0,
    totalNodeCount,
    unfilteredNodeCount: gNodes.length,
    isLargeGraph,
  };
}
