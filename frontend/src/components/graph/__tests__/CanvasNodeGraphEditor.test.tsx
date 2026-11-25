import { render, screen } from "@testing-library/react";
import { CanvasNodeGraphEditor } from "../CanvasNodeGraphEditor";
import { createCanvasRenderPipeline } from "@/src/lib/graph/canvasRenderPipeline";

jest.mock("@/src/lib/graph/canvasRenderPipeline", () => ({
  createCanvasRenderPipeline: jest.fn(),
}));

describe("CanvasNodeGraphEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a render pipeline and pushes initial state", () => {
    const updateState = jest.fn();
    const dispose = jest.fn();

    (createCanvasRenderPipeline as jest.Mock).mockReturnValue({
      updateState,
      forceRender: jest.fn(),
      dispose,
      getStats: jest.fn(() => ({ renderCount: 0, skippedFrames: 0, contextLost: false })),
    });

    render(
      <CanvasNodeGraphEditor
        nodes={[{ id: "a", x: 10, y: 10, width: 120, height: 48, label: "A" }]}
        edges={[]}
      />,
    );

    expect(createCanvasRenderPipeline).toHaveBeenCalled();
    expect(updateState).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: [expect.objectContaining({ id: "a" })],
        edges: [],
      }),
    );
    expect(screen.getByTestId("canvas-node-graph")).toBeInTheDocument();
  });

  it("updates pipeline state when nodes change", () => {
    const updateState = jest.fn();
    (createCanvasRenderPipeline as jest.Mock).mockReturnValue({
      updateState,
      forceRender: jest.fn(),
      dispose: jest.fn(),
      getStats: jest.fn(() => ({ renderCount: 0, skippedFrames: 0, contextLost: false })),
    });

    const { rerender } = render(
      <CanvasNodeGraphEditor
        nodes={[{ id: "a", x: 10, y: 10, width: 120, height: 48, label: "A" }]}
        edges={[]}
      />,
    );

    rerender(
      <CanvasNodeGraphEditor
        nodes={[{ id: "b", x: 20, y: 20, width: 120, height: 48, label: "B" }]}
        edges={[]}
      />,
    );

    expect(updateState).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [expect.objectContaining({ id: "b" })] }),
    );
  });

  it("shows fallback alert when pipeline reports errors", () => {
    (createCanvasRenderPipeline as jest.Mock).mockImplementation(({ onError }) => {
      onError(new Error("Canvas context lost."));
      return {
        updateState: jest.fn(),
        forceRender: jest.fn(),
        dispose: jest.fn(),
        getStats: jest.fn(() => ({ renderCount: 0, skippedFrames: 0, contextLost: true })),
      };
    });

    render(<CanvasNodeGraphEditor nodes={[]} edges={[]} />);

    expect(screen.getByTestId("canvas-node-graph-error")).toHaveTextContent(
      "Canvas context lost.",
    );
  });

  it("disposes pipeline on unmount", () => {
    const dispose = jest.fn();
    (createCanvasRenderPipeline as jest.Mock).mockReturnValue({
      updateState: jest.fn(),
      forceRender: jest.fn(),
      dispose,
      getStats: jest.fn(() => ({ renderCount: 0, skippedFrames: 0, contextLost: false })),
    });

    const { unmount } = render(<CanvasNodeGraphEditor nodes={[]} edges={[]} />);

    unmount();
    expect(dispose).toHaveBeenCalled();
  });
});
