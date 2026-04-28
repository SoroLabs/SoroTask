import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import TaskDependencyGraph from "../TaskDependencyGraph";
import { useTaskStore } from "@/src/store/taskStore";
import type { Task } from "@/src/types/task";

// ReactFlow requires a browser canvas and ResizeObserver — mock it entirely.
jest.mock("reactflow", () => {
  const React = require("react");

  const MockReactFlow = ({
    nodes,
    onNodeClick,
  }: {
    nodes: { id: string; data: { label: string } }[];
    onNodeClick?: (event: React.MouseEvent, node: { id: string }) => void;
  }) => (
    <div data-testid="react-flow-mock">
      {nodes.map((n) => (
        <button
          key={n.id}
          data-testid={`node-${n.id}`}
          onClick={(e) => onNodeClick?.(e, n)}
        >
          {n.data.label}
        </button>
      ))}
    </div>
  );

  return {
    __esModule: true,
    default: MockReactFlow,
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    MarkerType: { ArrowClosed: "arrowclosed" },
    useNodesState: (init: unknown[]) => [init, jest.fn(), jest.fn()],
    useEdgesState: (init: unknown[]) => [init, jest.fn(), jest.fn()],
  };
});

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTask(id: string, title = `Task ${id}`): Task {
  return {
    id,
    title,
    description: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };
}

function seedStore(
  tasks: Task[],
  deps: { fromId: string; toId: string }[] = []
) {
  act(() => {
    useTaskStore.getState().setTasks(tasks);
    useTaskStore.getState().setDependencies(deps);
  });
}

beforeEach(() => {
  act(() => useTaskStore.getState().reset());
});

// ── empty state ───────────────────────────────────────────────────────────────

describe("empty state", () => {
  it("shows empty message when there are no tasks", () => {
    render(<TaskDependencyGraph />);
    expect(
      screen.getByText(/no dependency relationships/i)
    ).toBeInTheDocument();
  });

  it("shows empty message when tasks exist but no dependencies", () => {
    seedStore([makeTask("a"), makeTask("b")], []);
    render(<TaskDependencyGraph />);
    expect(
      screen.getByText(/no dependency relationships/i)
    ).toBeInTheDocument();
  });

  it("empty state has role=status", () => {
    render(<TaskDependencyGraph />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("applies testid suffix -empty", () => {
    render(<TaskDependencyGraph data-testid="graph" />);
    expect(screen.getByTestId("graph-empty")).toBeInTheDocument();
  });
});

// ── rendering nodes ───────────────────────────────────────────────────────────

describe("rendering nodes", () => {
  beforeEach(() => {
    seedStore([makeTask("a"), makeTask("b"), makeTask("c")], [
      { fromId: "a", toId: "b" },
      { fromId: "b", toId: "c" },
    ]);
  });

  it("renders the ReactFlow canvas", () => {
    render(<TaskDependencyGraph />);
    expect(screen.getByTestId("react-flow-mock")).toBeInTheDocument();
  });

  it("renders a node for each task in the dependency graph", () => {
    render(<TaskDependencyGraph />);
    expect(screen.getByTestId("node-a")).toBeInTheDocument();
    expect(screen.getByTestId("node-b")).toBeInTheDocument();
    expect(screen.getByTestId("node-c")).toBeInTheDocument();
  });

  it("renders node labels from task titles", () => {
    render(<TaskDependencyGraph />);
    expect(screen.getByText("Task a")).toBeInTheDocument();
    expect(screen.getByText("Task b")).toBeInTheDocument();
  });

  it("applies data-testid to the wrapper", () => {
    render(<TaskDependencyGraph data-testid="dep-graph" />);
    expect(screen.getByTestId("dep-graph")).toBeInTheDocument();
  });

  it("renders the graph canvas with aria-label", () => {
    render(<TaskDependencyGraph />);
    expect(
      screen.getByRole("img", { name: /task dependency graph/i })
    ).toBeInTheDocument();
  });
});

// ── node click / selection ────────────────────────────────────────────────────

describe("node click and selection", () => {
  beforeEach(() => {
    seedStore([makeTask("a"), makeTask("b")], [{ fromId: "a", toId: "b" }]);
  });

  it("calls onNodeClick with the task id when a node is clicked", () => {
    const onNodeClick = jest.fn();
    render(<TaskDependencyGraph onNodeClick={onNodeClick} />);
    fireEvent.click(screen.getByTestId("node-a"));
    expect(onNodeClick).toHaveBeenCalledWith("a");
  });

  it("updates the store selectedTaskId on node click", () => {
    render(<TaskDependencyGraph />);
    fireEvent.click(screen.getByTestId("node-b"));
    expect(useTaskStore.getState().selectedTaskId).toBe("b");
  });

  it("shows selected task detail strip after clicking a node", () => {
    render(<TaskDependencyGraph />);
    fireEvent.click(screen.getByTestId("node-a"));
    expect(screen.getByTestId("graph-selected-task")).toBeInTheDocument();
    // The strip contains the title inside a <span> — use within to be specific
    const strip = screen.getByTestId("graph-selected-task");
    expect(strip).toHaveTextContent("Task a");
  });

  it("clears selection when clear button is clicked", () => {
    render(<TaskDependencyGraph />);
    fireEvent.click(screen.getByTestId("node-a"));
    fireEvent.click(screen.getByRole("button", { name: /clear selection/i }));
    expect(screen.queryByTestId("graph-selected-task")).not.toBeInTheDocument();
    expect(useTaskStore.getState().selectedTaskId).toBeNull();
  });

  it("does not show selected strip when nothing is selected", () => {
    render(<TaskDependencyGraph />);
    expect(screen.queryByTestId("graph-selected-task")).not.toBeInTheDocument();
  });
});

// ── filter bar ────────────────────────────────────────────────────────────────

describe("filter bar", () => {
  beforeEach(() => {
    seedStore(
      [
        makeTask("a", "Alpha task"),
        makeTask("b", "Beta task"),
        makeTask("c", "Gamma task"),
      ],
      [{ fromId: "a", toId: "b" }, { fromId: "b", toId: "c" }]
    );
  });

  it("renders the filter input", () => {
    render(<TaskDependencyGraph />);
    expect(
      screen.getByRole("searchbox", { name: /filter graph nodes/i })
    ).toBeInTheDocument();
  });

  it("shows node count when filter is active", () => {
    render(<TaskDependencyGraph />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "alpha" },
    });
    expect(screen.getByText(/\/ 3 nodes/)).toBeInTheDocument();
  });

  it("hides node count when filter is empty", () => {
    render(<TaskDependencyGraph />);
    expect(screen.queryByText(/nodes/)).not.toBeInTheDocument();
  });

  it("filters nodes by title (case-insensitive)", () => {
    render(<TaskDependencyGraph />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "ALPHA" },
    });
    expect(screen.getByTestId("node-a")).toBeInTheDocument();
    expect(screen.queryByTestId("node-b")).not.toBeInTheDocument();
  });
});

// ── focusTaskId (neighbourhood filter) ───────────────────────────────────────

describe("focusTaskId prop", () => {
  beforeEach(() => {
    seedStore(
      [makeTask("a"), makeTask("b"), makeTask("c"), makeTask("d")],
      [
        { fromId: "a", toId: "b" },
        { fromId: "b", toId: "c" },
        { fromId: "d", toId: "c" }, // unrelated to a
      ]
    );
  });

  it("limits graph to neighbourhood of focusTaskId", () => {
    render(<TaskDependencyGraph focusTaskId="a" />);
    // Only a→b edge is in a's neighbourhood
    expect(screen.getByTestId("node-a")).toBeInTheDocument();
    expect(screen.getByTestId("node-b")).toBeInTheDocument();
    // c and d are not in a's direct neighbourhood
    expect(screen.queryByTestId("node-c")).not.toBeInTheDocument();
    expect(screen.queryByTestId("node-d")).not.toBeInTheDocument();
  });

  it("shows all nodes when focusTaskId is null", () => {
    render(<TaskDependencyGraph focusTaskId={null} />);
    expect(screen.getByTestId("node-a")).toBeInTheDocument();
    expect(screen.getByTestId("node-b")).toBeInTheDocument();
    expect(screen.getByTestId("node-c")).toBeInTheDocument();
    expect(screen.getByTestId("node-d")).toBeInTheDocument();
  });
});
