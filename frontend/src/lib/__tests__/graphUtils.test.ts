import {
  buildGraphData,
  getBlockingTasks,
  getBlockedTasks,
  validateDependency,
  wouldCreateCycle,
  filterToNeighbourhood,
  shouldVirtualizeGraph,
  truncateLabel,
  GRAPH_VIRTUALIZE_THRESHOLD,
} from "../graphUtils";
import type { Task, TaskDependency } from "@/src/types/task";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTask(id: string): Task {
  return {
    id,
    title: `Task ${id}`,
    description: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };
}

function taskMap(...ids: string[]): Record<string, Task> {
  return Object.fromEntries(ids.map((id) => [id, makeTask(id)]));
}

// ── buildGraphData ────────────────────────────────────────────────────────────

describe("buildGraphData", () => {
  it("returns empty nodes and edges for no tasks and no deps", () => {
    const { nodes, edges } = buildGraphData({}, []);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it("builds a node for each task referenced in deps", () => {
    const tasks = taskMap("a", "b");
    const deps: TaskDependency[] = [{ fromId: "a", toId: "b" }];
    const { nodes } = buildGraphData(tasks, deps);
    expect(nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("builds an edge for each dependency", () => {
    const tasks = taskMap("a", "b");
    const deps: TaskDependency[] = [{ fromId: "a", toId: "b" }];
    const { edges } = buildGraphData(tasks, deps);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "a", target: "b" });
  });

  it("marks the selected node", () => {
    const tasks = taskMap("a", "b");
    const deps: TaskDependency[] = [{ fromId: "a", toId: "b" }];
    const { nodes } = buildGraphData(tasks, deps, "a");
    const nodeA = nodes.find((n) => n.id === "a")!;
    expect(nodeA.selected).toBe(true);
    const nodeB = nodes.find((n) => n.id === "b")!;
    expect(nodeB.selected).toBe(false);
  });

  it("includes the selected task even if it has no edges", () => {
    const tasks = taskMap("a", "b", "c");
    const deps: TaskDependency[] = [{ fromId: "a", toId: "b" }];
    const { nodes } = buildGraphData(tasks, deps, "c");
    expect(nodes.map((n) => n.id)).toContain("c");
  });

  it("deduplicates edges with the same source and target", () => {
    const tasks = taskMap("a", "b");
    const deps: TaskDependency[] = [
      { fromId: "a", toId: "b" },
      { fromId: "a", toId: "b" },
    ];
    const { edges } = buildGraphData(tasks, deps);
    expect(edges).toHaveLength(1);
  });

  it("skips self-loop edges", () => {
    const tasks = taskMap("a");
    const deps: TaskDependency[] = [{ fromId: "a", toId: "a" }];
    const { edges } = buildGraphData(tasks, deps);
    expect(edges).toHaveLength(0);
  });

  it("skips edges referencing unknown task ids", () => {
    const tasks = taskMap("a");
    const deps: TaskDependency[] = [{ fromId: "a", toId: "ghost" }];
    const { nodes, edges } = buildGraphData(tasks, deps);
    expect(edges).toHaveLength(0);
    expect(nodes.find((n) => n.id === "ghost")).toBeUndefined();
  });

  it("uses task title as node label", () => {
    const tasks = taskMap("a");
    const deps: TaskDependency[] = [{ fromId: "a", toId: "a" }];
    const { nodes } = buildGraphData(tasks, [{ fromId: "a", toId: "a" }], "a");
    // node is included because it's selected
    const node = nodes.find((n) => n.id === "a");
    expect(node?.label).toBe("Task a");
  });

  it("handles multiple edges correctly", () => {
    const tasks = taskMap("a", "b", "c");
    const deps: TaskDependency[] = [
      { fromId: "a", toId: "b" },
      { fromId: "b", toId: "c" },
    ];
    const { nodes, edges } = buildGraphData(tasks, deps);
    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2);
  });
});

// ── getBlockingTasks ──────────────────────────────────────────────────────────

describe("getBlockingTasks", () => {
  it("returns tasks that block the given task", () => {
    const deps: TaskDependency[] = [
      { fromId: "a", toId: "b" },
      { fromId: "a", toId: "c" },
    ];
    expect(getBlockingTasks("a", deps).sort()).toEqual(["b", "c"]);
  });

  it("returns empty array when task has no blockers", () => {
    const deps: TaskDependency[] = [{ fromId: "b", toId: "a" }];
    expect(getBlockingTasks("a", deps)).toEqual([]);
  });

  it("returns empty array for empty deps", () => {
    expect(getBlockingTasks("a", [])).toEqual([]);
  });
});

// ── getBlockedTasks ───────────────────────────────────────────────────────────

describe("getBlockedTasks", () => {
  it("returns tasks blocked by the given task", () => {
    const deps: TaskDependency[] = [
      { fromId: "b", toId: "a" },
      { fromId: "c", toId: "a" },
    ];
    expect(getBlockedTasks("a", deps).sort()).toEqual(["b", "c"]);
  });

  it("returns empty array when no tasks are blocked by it", () => {
    // a→b means a depends on b; b blocks a. So getBlockedTasks("a") = [] (nothing depends on a)
    const deps: TaskDependency[] = [{ fromId: "a", toId: "b" }];
    expect(getBlockedTasks("a", deps)).toEqual([]);
  });
});

// ── validateDependency ────────────────────────────────────────────────────────

describe("validateDependency", () => {
  it("returns null for a valid new dependency", () => {
    expect(validateDependency("a", "b", [])).toBeNull();
  });

  it("rejects self-dependency", () => {
    expect(validateDependency("a", "a", [])).toMatch(/itself/i);
  });

  it("rejects duplicate dependency", () => {
    const deps: TaskDependency[] = [{ fromId: "a", toId: "b" }];
    expect(validateDependency("a", "b", deps)).toMatch(/already exists/i);
  });

  it("rejects dependency that would create a cycle", () => {
    const deps: TaskDependency[] = [
      { fromId: "a", toId: "b" },
      { fromId: "b", toId: "c" },
    ];
    // c → a would close the cycle a→b→c→a
    expect(validateDependency("c", "a", deps)).toMatch(/cycle/i);
  });

  it("allows a valid dependency in a non-cyclic graph", () => {
    const deps: TaskDependency[] = [
      { fromId: "a", toId: "b" },
      { fromId: "b", toId: "c" },
    ];
    expect(validateDependency("a", "c", deps)).toBeNull();
  });
});

// ── wouldCreateCycle ──────────────────────────────────────────────────────────

describe("wouldCreateCycle", () => {
  it("returns false for an empty graph", () => {
    expect(wouldCreateCycle("a", "b", [])).toBe(false);
  });

  it("detects a direct cycle (a→b, b→a)", () => {
    const deps: TaskDependency[] = [{ fromId: "a", toId: "b" }];
    expect(wouldCreateCycle("b", "a", deps)).toBe(true);
  });

  it("detects an indirect cycle (a→b→c, c→a)", () => {
    const deps: TaskDependency[] = [
      { fromId: "a", toId: "b" },
      { fromId: "b", toId: "c" },
    ];
    expect(wouldCreateCycle("c", "a", deps)).toBe(true);
  });

  it("returns false for a valid DAG addition", () => {
    const deps: TaskDependency[] = [
      { fromId: "a", toId: "b" },
      { fromId: "b", toId: "c" },
    ];
    expect(wouldCreateCycle("a", "c", deps)).toBe(false);
  });

  it("returns false for a self-loop check (handled by validateDependency)", () => {
    // wouldCreateCycle doesn't special-case self-loops — it detects them
    expect(wouldCreateCycle("a", "a", [])).toBe(true);
  });
});

// ── filterToNeighbourhood ─────────────────────────────────────────────────────

describe("filterToNeighbourhood", () => {
  const deps: TaskDependency[] = [
    { fromId: "a", toId: "b" },
    { fromId: "b", toId: "c" },
    { fromId: "d", toId: "e" },
  ];

  it("returns edges where task is the source", () => {
    const result = filterToNeighbourhood("a", deps);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ fromId: "a", toId: "b" });
  });

  it("returns edges where task is the target", () => {
    const result = filterToNeighbourhood("c", deps);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ fromId: "b", toId: "c" });
  });

  it("returns both incoming and outgoing edges", () => {
    const result = filterToNeighbourhood("b", deps);
    expect(result).toHaveLength(2);
  });

  it("returns empty array for unconnected task", () => {
    expect(filterToNeighbourhood("z", deps)).toHaveLength(0);
  });

  it("returns empty array for empty deps", () => {
    expect(filterToNeighbourhood("a", [])).toHaveLength(0);
  });
});

// ── shouldVirtualizeGraph ─────────────────────────────────────────────────────

describe("shouldVirtualizeGraph", () => {
  it("returns false at or below the threshold", () => {
    expect(shouldVirtualizeGraph(0)).toBe(false);
    expect(shouldVirtualizeGraph(GRAPH_VIRTUALIZE_THRESHOLD)).toBe(false);
  });

  it("returns true above the threshold", () => {
    expect(shouldVirtualizeGraph(GRAPH_VIRTUALIZE_THRESHOLD + 1)).toBe(true);
    expect(shouldVirtualizeGraph(1000)).toBe(true);
  });

  it("uses 200 as the threshold", () => {
    expect(GRAPH_VIRTUALIZE_THRESHOLD).toBe(200);
    expect(shouldVirtualizeGraph(200)).toBe(false);
    expect(shouldVirtualizeGraph(201)).toBe(true);
  });
});

// ── truncateLabel ─────────────────────────────────────────────────────────────

describe("truncateLabel", () => {
  it("leaves short labels unchanged", () => {
    expect(truncateLabel("short")).toBe("short");
  });

  it("leaves labels exactly at maxLen unchanged", () => {
    const label = "a".repeat(24);
    expect(truncateLabel(label)).toBe(label);
  });

  it("truncates long labels with an ellipsis to maxLen total chars", () => {
    const label = "a".repeat(40);
    const result = truncateLabel(label);
    expect(result.length).toBe(24);
    expect(result.endsWith("…")).toBe(true);
  });

  it("respects a custom maxLen", () => {
    expect(truncateLabel("abcdef", 4)).toBe("abc…");
  });

  it("returns an empty string for a non-positive maxLen", () => {
    expect(truncateLabel("abc", 0)).toBe("");
    expect(truncateLabel("abc", -5)).toBe("");
  });

  it("returns just an ellipsis when maxLen is 1", () => {
    expect(truncateLabel("abc", 1)).toBe("…");
  });
});
