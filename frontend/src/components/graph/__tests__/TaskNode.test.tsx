import { render, screen } from "@testing-library/react";
import { TaskNode, nodeTypes, type TaskNodeData } from "../TaskNode";
import type { NodeProps } from "reactflow";

jest.mock("reactflow", () => ({
  __esModule: true,
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}));

function renderNode(
  id: string,
  data: TaskNodeData,
  selected = false
) {
  const props = {
    id,
    data,
    selected,
    type: "taskNode",
    dragging: false,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    zIndex: 0,
  } as unknown as NodeProps<TaskNodeData>;
  return render(<TaskNode {...props} />);
}

describe("TaskNode", () => {
  it("renders the task title", () => {
    renderNode("a", { label: "Build the thing", status: "pending" });
    expect(screen.getByText("Build the thing")).toBeInTheDocument();
  });

  it("truncates long titles to 24 chars with an ellipsis", () => {
    const long = "This title is definitely longer than twenty four chars";
    renderNode("a", { label: long, status: "pending" });
    const text = screen.getByText(/…$/);
    expect(text.textContent!.length).toBe(24);
  });

  it("renders the node id in monospace", () => {
    renderNode("node-xyz", { label: "T", status: "pending" });
    expect(screen.getByText("node-xyz")).toBeInTheDocument();
  });

  it("shows a yellow dot for pending status", () => {
    renderNode("a", { label: "T", status: "pending" });
    expect(screen.getByTestId("task-node-status-a")).toHaveClass("bg-yellow-500");
  });

  it("shows a green dot for has_run status", () => {
    renderNode("a", { label: "T", status: "has_run" });
    expect(screen.getByTestId("task-node-status-a")).toHaveClass("bg-green-500");
  });

  it("shows a blue dot when the node is selected (overrides data status)", () => {
    renderNode("a", { label: "T", status: "has_run" }, true);
    expect(screen.getByTestId("task-node-status-a")).toHaveClass("bg-blue-500");
  });

  it("applies selected styling when selected", () => {
    renderNode("a", { label: "T", status: "pending" }, true);
    expect(screen.getByTestId("task-node-a")).toHaveClass("bg-blue-600");
  });

  it("applies default styling when not selected", () => {
    renderNode("a", { label: "T", status: "pending" });
    expect(screen.getByTestId("task-node-a")).toHaveClass("bg-neutral-900");
  });

  it("gives the status dot an accessible label", () => {
    renderNode("a", { label: "T", status: "has_run" });
    expect(screen.getByLabelText("Has run")).toBeInTheDocument();
  });

  it("exports a nodeTypes map keyed by taskNode", () => {
    expect(nodeTypes.taskNode).toBe(TaskNode);
  });
});
