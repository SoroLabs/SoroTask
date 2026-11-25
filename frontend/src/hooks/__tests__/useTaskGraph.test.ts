import { renderHook, act } from "@testing-library/react";
import { useTaskGraph } from "../useTaskGraph";
import { useTaskStore } from "@/src/store/taskStore";
import type { Task } from "@/src/types/task";

// Mock the dagre-backed layout so the hook stays fast and deterministic.
jest.mock("@/src/lib/graphLayout", () => ({
  __esModule: true,
  DEFAULT_NODE_HEIGHT: 60,
  layoutGraph: (
    nodes: { id: string; width: number; height: number }[]
  ) =>
    nodes.map((n, i) => ({ ...n, x: i * 100, y: i * 50 })),
}));

// reactflow only needs MarkerType in this hook.
jest.mock("reactflow", () => ({
  __esModule: true,
  MarkerType: { ArrowClosed: "arrowclosed" },
}));

function makeTask(id: string, title = `Task ${id}`): Task {
  return {
    id,
    title,
    description: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };
}

function seed(tasks: Task[], deps: { fromId: string; toId: string }[] = []) {
  act(() => {
    useTaskStore.getState().setTasks(tasks);
    useTaskStore.getState().setDependencies(deps);
  });
}

beforeEach(() => {
  act(() => useTaskStore.getState().reset());
});

describe("useTaskGraph", () => {
  it("returns isEmpty=true with no tasks", () => {
    const { result } = renderHook(() => useTaskGraph());
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.nodes).toHaveLength(0);
    expect(result.current.edges).toHaveLength(0);
  });

  it("builds RF nodes and edges from the store", () => {
    seed([makeTask("a"), makeTask("b")], [{ fromId: "a", toId: "b" }]);
    const { result } = renderHook(() => useTaskGraph());
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(result.current.edges).toHaveLength(1);
    expect(result.current.edges[0]).toMatchObject({ source: "a", target: "b" });
  });

  it("assigns the taskNode type and laid-out positions", () => {
    seed([makeTask("a"), makeTask("b")], [{ fromId: "a", toId: "b" }]);
    const { result } = renderHook(() => useTaskGraph());
    const node = result.current.nodes[0];
    expect(node.type).toBe("taskNode");
    expect(node.position).toEqual({ x: 0, y: 0 });
  });

  it("marks the selected node with selected status", () => {
    seed([makeTask("a"), makeTask("b")], [{ fromId: "a", toId: "b" }]);
    act(() => useTaskStore.getState().selectTask("a"));
    const { result } = renderHook(() => useTaskGraph());
    const a = result.current.nodes.find((n) => n.id === "a")!;
    expect(a.data.status).toBe("selected");
    expect(a.selected).toBe(true);
  });

  it("applies the text filter case-insensitively", () => {
    seed(
      [makeTask("a", "Alpha"), makeTask("b", "Beta")],
      [{ fromId: "a", toId: "b" }]
    );
    const { result } = renderHook(() => useTaskGraph({ filterText: "ALPHA" }));
    expect(result.current.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(result.current.totalNodeCount).toBe(1);
    expect(result.current.unfilteredNodeCount).toBe(2);
  });

  it("drops edges whose endpoints are filtered out", () => {
    seed(
      [makeTask("a", "Alpha"), makeTask("b", "Beta")],
      [{ fromId: "a", toId: "b" }]
    );
    const { result } = renderHook(() => useTaskGraph({ filterText: "Alpha" }));
    expect(result.current.edges).toHaveLength(0);
  });

  it("limits to the neighbourhood when focusTaskId is set", () => {
    seed(
      [makeTask("a"), makeTask("b"), makeTask("c"), makeTask("d")],
      [
        { fromId: "a", toId: "b" },
        { fromId: "b", toId: "c" },
        { fromId: "d", toId: "c" },
      ]
    );
    const { result } = renderHook(() => useTaskGraph({ focusTaskId: "a" }));
    const ids = result.current.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("flags and slices large graphs above the threshold", () => {
    const tasks: Task[] = [];
    const deps: { fromId: string; toId: string }[] = [];
    for (let i = 0; i < 250; i++) tasks.push(makeTask(`n${i}`));
    // Chain them so every node is referenced.
    for (let i = 0; i < 249; i++) {
      deps.push({ fromId: `n${i}`, toId: `n${i + 1}` });
    }
    seed(tasks, deps);
    const { result } = renderHook(() => useTaskGraph());
    expect(result.current.isLargeGraph).toBe(true);
    expect(result.current.totalNodeCount).toBe(250);
    expect(result.current.nodes).toHaveLength(200);
  });

  it("does not flag graphs at or below the threshold", () => {
    seed([makeTask("a"), makeTask("b")], [{ fromId: "a", toId: "b" }]);
    const { result } = renderHook(() => useTaskGraph());
    expect(result.current.isLargeGraph).toBe(false);
  });

  it("returns stable node references across re-renders with unchanged inputs", () => {
    seed([makeTask("a"), makeTask("b")], [{ fromId: "a", toId: "b" }]);
    const { result, rerender } = renderHook(() => useTaskGraph());
    const first = result.current.nodes;
    rerender();
    expect(result.current.nodes).toBe(first);
  });
});
