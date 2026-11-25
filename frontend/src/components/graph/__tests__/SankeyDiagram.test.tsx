import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { parseTokenomicsData } from "../../../lib/tokenomics/parser";
import SankeyDiagram from "../SankeyDiagram";

describe("Tokenomics Data Parser", () => {
  it("should parse normal DAG structures correctly", () => {
    const data = {
      nodes: [
        { id: "A", name: "Node A", color: "red" },
        { id: "B", name: "Node B", color: "blue" },
      ],
      links: [{ source: "A", target: "B", value: 10 }],
    };

    const parsed = parseTokenomicsData(data);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.links).toHaveLength(1);
    expect(parsed.feedbackLinks).toHaveLength(0);
    expect(parsed.warnings).toHaveLength(0);
    expect(parsed.nodes.find((n) => n.id === "A")?.depth).toBe(0);
    expect(parsed.nodes.find((n) => n.id === "B")?.depth).toBe(1);
  });

  it("should gracefully handle null/empty structures", () => {
    const parsed = parseTokenomicsData(null);
    expect(parsed.nodes).toHaveLength(0);
    expect(parsed.links).toHaveLength(0);
    expect(parsed.warnings).toContain("Invalid root data structure");
  });

  it("should filter out duplicate node IDs and invalid links", () => {
    const data = {
      nodes: [
        { id: "A", name: "Node A" },
        { id: "A", name: "Node A Duplicate" },
        { id: "B", name: "Node B" },
      ],
      links: [
        { source: "A", target: "C", value: 10 }, // missing C
        { source: "B", target: "A", value: -5 }, // invalid value
      ],
    };

    const parsed = parseTokenomicsData(data);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.links).toHaveLength(0);
    expect(parsed.warnings).toContain("Duplicate node ID detected and skipped: A");
    expect(parsed.warnings).toContain("Skipped link referencing missing target node: C");
    expect(parsed.warnings).toContain("Skipped link with invalid value: source=B, target=A, value=-5");
  });

  it("should isolate cycle loops as feedback loops", () => {
    const data = {
      nodes: [
        { id: "A", name: "Node A" },
        { id: "B", name: "Node B" },
      ],
      links: [
        { source: "A", target: "B", value: 10 },
        { source: "B", target: "A", value: 5 }, // cycle link
      ],
    };

    const parsed = parseTokenomicsData(data);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.links).toHaveLength(1); // A -> B is kept
    expect(parsed.feedbackLinks).toHaveLength(1); // B -> A isolated
    expect(parsed.feedbackLinks[0].source).toBe("B");
    expect(parsed.feedbackLinks[0].target).toBe("A");
  });
});

describe("SankeyDiagram Component", () => {
  it("renders with header and query inputs", () => {
    render(<SankeyDiagram />);
    expect(screen.getByTestId("sankey-diagram-container")).toBeInTheDocument();
    expect(screen.getByText("Token Flow Sankey Diagram")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Filter nodes by token name...")).toBeInTheDocument();
  });

  it("supports switching datasets and triggers rendering", () => {
    render(<SankeyDiagram initialDatasetKey="simple" />);
    
    // Switch to Complex DeFi Engine
    const complexBtn = screen.getByText("Complex DeFi Engine");
    expect(complexBtn).toBeInTheDocument();
    fireEvent.click(complexBtn);

    // Switch to Bridge Cyclic Flow
    const cyclicBtn = screen.getByText("Bridge Cyclic Flow");
    expect(cyclicBtn).toBeInTheDocument();
    fireEvent.click(cyclicBtn);
    
    expect(screen.getByText(/Feedback Loops Isolated/)).toBeInTheDocument();
  });

  it("handles node filtering input", () => {
    render(<SankeyDiagram />);
    const input = screen.getByPlaceholderText("Filter nodes by token name...");
    fireEvent.change(input, { target: { value: "Treasury" } });
    expect(input).toHaveValue("Treasury");
  });

  it("captures mouse drag events on nodes", () => {
    const { container } = render(<SankeyDiagram />);
    const nodeElement = container.querySelector("g.cursor-ns-resize");
    expect(nodeElement).toBeInTheDocument();

    if (nodeElement) {
      fireEvent.mouseDown(nodeElement, { clientY: 100 });
      // Simulate moving mouse vertically by 50px
      const moveEvent = new MouseEvent("mousemove", { clientY: 150 });
      window.dispatchEvent(moveEvent);
      // Release mouse
      const upEvent = new MouseEvent("mouseup");
      window.dispatchEvent(upEvent);
    }
  });
});
