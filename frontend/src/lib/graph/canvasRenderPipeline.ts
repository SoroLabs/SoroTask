import { captureSentryException } from "@/src/lib/errors/sentry";

export interface CanvasNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  selected?: boolean;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
}

export interface CanvasGraphState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface CanvasRenderPipelineOptions {
  canvas: HTMLCanvasElement;
  onError?: (error: Error) => void;
  onRender?: (state: CanvasGraphState) => void;
}

export interface CanvasRenderPipeline {
  updateState: (nextState: CanvasGraphState) => void;
  forceRender: () => void;
  dispose: () => void;
  getStats: () => {
    renderCount: number;
    skippedFrames: number;
    contextLost: boolean;
  };
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

function hashState(state: CanvasGraphState): string {
  const nodeHash = state.nodes
    .map((node) => `${node.id}:${node.x}:${node.y}:${node.width}:${node.height}:${node.selected ? 1 : 0}`)
    .join("|");
  const edgeHash = state.edges.map((edge) => `${edge.id}:${edge.from}->${edge.to}`).join("|");
  return `${nodeHash}::${edgeHash}`;
}

function reportPipelineError(error: Error, onError?: (error: Error) => void) {
  captureSentryException(error, {
    section: "canvas-render-pipeline",
  });
  onError?.(error);
}

export function createCanvasRenderPipeline(
  options: CanvasRenderPipelineOptions,
): CanvasRenderPipeline {
  const context = options.canvas.getContext("2d");

  if (!context) {
    const error = new Error("Canvas 2D context is unavailable.");
    reportPipelineError(error, options.onError);

    return {
      updateState: () => undefined,
      forceRender: () => undefined,
      dispose: () => undefined,
      getStats: () => ({ renderCount: 0, skippedFrames: 0, contextLost: true }),
    };
  }

  let frameId: number | null = null;
  let renderCount = 0;
  let skippedFrames = 0;
  let contextLost = false;
  let disposed = false;

  let currentState: CanvasGraphState = { nodes: [], edges: [] };
  let lastRenderedHash = "";

  const draw = () => {
    if (disposed || contextLost) {
      return;
    }

    const nextHash = hashState(currentState);
    if (nextHash === lastRenderedHash) {
      skippedFrames += 1;
      return;
    }

    try {
      context.clearRect(0, 0, options.canvas.width, options.canvas.height);
      context.lineWidth = 1;
      context.strokeStyle = "#6b7280";

      const nodeById = new Map(currentState.nodes.map((node) => [node.id, node]));

      for (const edge of currentState.edges) {
        const from = nodeById.get(edge.from);
        const to = nodeById.get(edge.to);
        if (!from || !to) {
          continue;
        }

        context.beginPath();
        context.moveTo(from.x + from.width / 2, from.y + from.height / 2);
        context.lineTo(to.x + to.width / 2, to.y + to.height / 2);
        context.stroke();
      }

      for (const node of currentState.nodes) {
        context.fillStyle = node.selected ? "#2563eb" : "#1f2937";
        context.fillRect(node.x, node.y, node.width, node.height);
        context.fillStyle = "#e5e7eb";
        context.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
        context.fillText(node.label, node.x + 8, node.y + 18);
      }

      lastRenderedHash = nextHash;
      renderCount += 1;
      options.onRender?.(currentState);
    } catch (error) {
      reportPipelineError(normalizeError(error), options.onError);
    }
  };

  const schedule = () => {
    if (disposed || frameId != null) {
      return;
    }

    frameId = requestAnimationFrame(() => {
      frameId = null;
      draw();
    });
  };

  const handleContextLost = (event: Event) => {
    contextLost = true;
    if (event && typeof (event as { preventDefault?: () => void }).preventDefault === "function") {
      (event as { preventDefault: () => void }).preventDefault();
    }
    reportPipelineError(new Error("Canvas context lost."), options.onError);
  };

  const handleContextRestored = () => {
    contextLost = false;
    lastRenderedHash = "";
    schedule();
  };

  options.canvas.addEventListener("contextlost", handleContextLost as EventListener);
  options.canvas.addEventListener("contextrestored", handleContextRestored as EventListener);

  return {
    updateState: (nextState: CanvasGraphState) => {
      currentState = nextState;
      schedule();
    },
    forceRender: () => {
      lastRenderedHash = "";
      draw();
    },
    dispose: () => {
      disposed = true;
      if (frameId != null) {
        cancelAnimationFrame(frameId);
      }
      options.canvas.removeEventListener("contextlost", handleContextLost as EventListener);
      options.canvas.removeEventListener("contextrestored", handleContextRestored as EventListener);
    },
    getStats: () => ({
      renderCount,
      skippedFrames,
      contextLost,
    }),
  };
}
