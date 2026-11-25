import dagre from "dagre";

export interface LayoutInputNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutInputEdge {
  source: string;
  target: string;
}

export interface LayoutPositionedNode extends LayoutInputNode {
  /** Top-left x coordinate (dagre reports node centres; we convert to top-left) */
  x: number;
  /** Top-left y coordinate */
  y: number;
}

export interface LayoutOptions {
  rankdir?: "TB" | "BT" | "LR" | "RL";
  nodesep?: number;
  ranksep?: number;
}

export const DEFAULT_NODE_WIDTH = 180;
export const DEFAULT_NODE_HEIGHT = 60;

const DEFAULT_OPTIONS: Required<LayoutOptions> = {
  rankdir: "TB",
  nodesep: 80,
  ranksep: 100,
};

/**
 * Runs a dagre directed-acyclic layout over the given nodes/edges and returns
 * the nodes with computed top-left `x`/`y` positions.
 *
 * dagre stores node centres, so we shift by half the node's dimensions to give
 * ReactFlow the top-left origin it expects.
 */
export function layoutGraph(
  nodes: LayoutInputNode[],
  edges: LayoutInputEdge[],
  options: LayoutOptions = {}
): LayoutPositionedNode[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: opts.rankdir,
    nodesep: opts.nodesep,
    ranksep: opts.ranksep,
  });

  for (const node of nodes) {
    g.setNode(node.id, { width: node.width, height: node.height });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const positioned = g.node(node.id) as
      | { x: number; y: number }
      | undefined;
    const centreX = positioned?.x ?? 0;
    const centreY = positioned?.y ?? 0;
    return {
      ...node,
      x: centreX - node.width / 2,
      y: centreY - node.height / 2,
    };
  });
}
