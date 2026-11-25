"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createCanvasRenderPipeline,
  type CanvasEdge,
  type CanvasNode,
} from "@/src/lib/graph/canvasRenderPipeline";

export interface CanvasNodeGraphEditorProps {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  width?: number;
  height?: number;
  className?: string;
}

export function CanvasNodeGraphEditor({
  nodes,
  edges,
  width = 960,
  height = 520,
  className,
}: CanvasNodeGraphEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pipelineRef = useRef<ReturnType<typeof createCanvasRenderPipeline> | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  const state = useMemo(() => ({ nodes, edges }), [nodes, edges]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const pipeline = createCanvasRenderPipeline({
      canvas,
      onError: (error) => {
        setRenderError(error.message);
      },
    });

    pipelineRef.current = pipeline;
    pipeline.updateState(state);

    return () => {
      pipeline.dispose();
      pipelineRef.current = null;
    };
  }, []);

  useEffect(() => {
    pipelineRef.current?.updateState(state);
  }, [state]);

  return (
    <div className={`rounded-xl border border-neutral-700/50 bg-neutral-950 p-2 ${className ?? ""}`}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full rounded-lg border border-neutral-800 bg-neutral-900"
        data-testid="canvas-node-graph"
        role="img"
        aria-label="Canvas node graph editor"
      />
      {renderError && (
        <div
          role="alert"
          data-testid="canvas-node-graph-error"
          className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
        >
          {renderError}
        </div>
      )}
    </div>
  );
}

export default CanvasNodeGraphEditor;
