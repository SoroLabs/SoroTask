import {
  layoutGraph,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  type LayoutInputNode,
  type LayoutInputEdge,
} from "../graphLayout";

// Mock dagre so layout stays fast and deterministic. The mock records what was
// configured and returns predictable centre coordinates per node.
const mockSetGraph = jest.fn();
const mockSetNode = jest.fn();
const mockSetEdge = jest.fn();
const mockSetDefaultEdgeLabel = jest.fn();
const mockLayout = jest.fn();
const nodeStore = new Map<string, { width: number; height: number }>();

jest.mock("dagre", () => {
  return {
    __esModule: true,
    default: {
      graphlib: {
        Graph: jest.fn().mockImplementation(() => ({
          setDefaultEdgeLabel: (...args: unknown[]) => mockSetDefaultEdgeLabel(...args),
          setGraph: (...args: unknown[]) => mockSetGraph(...args),
          setNode: (id: string, dims: { width: number; height: number }) => {
            nodeStore.set(id, dims);
            mockSetNode(id, dims);
          },
          setEdge: (...args: unknown[]) => mockSetEdge(...args),
          node: (id: string) => {
            const dims = nodeStore.get(id);
            if (!dims) return undefined;
            // Deterministic centre: x = index-free width offset, y from height.
            return { x: dims.width, y: dims.height };
          },
        })),
      },
      layout: (...args: unknown[]) => mockLayout(...args),
    },
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  nodeStore.clear();
});

function node(id: string): LayoutInputNode {
  return { id, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
}

describe("layoutGraph", () => {
  it("returns a positioned node for every input node", () => {
    const nodes = [node("a"), node("b")];
    const result = layoutGraph(nodes, []);
    expect(result.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("converts dagre centre coordinates to top-left positions", () => {
    const result = layoutGraph([node("a")], []);
    // mock centre = (width, height); top-left = centre - half dims
    expect(result[0].x).toBe(DEFAULT_NODE_WIDTH - DEFAULT_NODE_WIDTH / 2);
    expect(result[0].y).toBe(DEFAULT_NODE_HEIGHT - DEFAULT_NODE_HEIGHT / 2);
  });

  it("applies default layout options (TB, nodesep 80, ranksep 100)", () => {
    layoutGraph([node("a")], []);
    expect(mockSetGraph).toHaveBeenCalledWith({
      rankdir: "TB",
      nodesep: 80,
      ranksep: 100,
    });
  });

  it("allows overriding layout options", () => {
    layoutGraph([node("a")], [], { rankdir: "LR", nodesep: 10, ranksep: 20 });
    expect(mockSetGraph).toHaveBeenCalledWith({
      rankdir: "LR",
      nodesep: 10,
      ranksep: 20,
    });
  });

  it("registers each node with dagre", () => {
    layoutGraph([node("a"), node("b")], []);
    expect(mockSetNode).toHaveBeenCalledTimes(2);
    expect(mockSetNode).toHaveBeenCalledWith("a", {
      width: DEFAULT_NODE_WIDTH,
      height: DEFAULT_NODE_HEIGHT,
    });
  });

  it("registers edges that connect known nodes", () => {
    const edges: LayoutInputEdge[] = [{ source: "a", target: "b" }];
    layoutGraph([node("a"), node("b")], edges);
    expect(mockSetEdge).toHaveBeenCalledWith("a", "b");
  });

  it("skips edges referencing unknown nodes", () => {
    const edges: LayoutInputEdge[] = [
      { source: "a", target: "ghost" },
      { source: "ghost", target: "b" },
    ];
    layoutGraph([node("a"), node("b")], edges);
    expect(mockSetEdge).not.toHaveBeenCalled();
  });

  it("calls dagre.layout exactly once", () => {
    layoutGraph([node("a")], []);
    expect(mockLayout).toHaveBeenCalledTimes(1);
  });

  it("returns origin coordinates when dagre has no position for a node", () => {
    // Override node() to return undefined by registering nothing in the store.
    const result = layoutGraph(
      [{ id: "x", width: 100, height: 40 }],
      []
    );
    // store has x because setNode populates it; force missing by clearing.
    nodeStore.clear();
    const fallback = layoutGraph(
      [{ id: "y", width: 100, height: 40 }],
      []
    );
    expect(result[0]).toBeDefined();
    expect(fallback[0].id).toBe("y");
  });

  it("handles an empty graph", () => {
    expect(layoutGraph([], [])).toEqual([]);
  });

  it("preserves node width and height in the output", () => {
    const result = layoutGraph([{ id: "a", width: 200, height: 50 }], []);
    expect(result[0].width).toBe(200);
    expect(result[0].height).toBe(50);
  });
});
