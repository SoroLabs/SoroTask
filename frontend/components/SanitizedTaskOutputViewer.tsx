"use client";

import React, { useMemo } from "react";
import { sanitizeResolverOutput } from "@/src/lib/sanitize";

export interface SanitizedTaskOutputViewerProps {
  title?: string;
  output: unknown;
  className?: string;
  "data-testid"?: string;
}

/**
 * Renders dynamic task execution outputs and resolver return values safely
 * in a sandboxed code block or JSON tree viewer, protected by DOMPurify.
 */
export function SanitizedTaskOutputViewer({
  title = "Task Execution Output",
  output,
  className = "",
  "data-testid": testId = "task-output-viewer",
}: SanitizedTaskOutputViewerProps) {
  const sanitizedContent = useMemo(() => {
    return sanitizeResolverOutput(output);
  }, [output]);

  const isFormattedJson = useMemo(() => {
    if (typeof output === "object" && output !== null) {
      return true;
    }
    if (typeof output === "string") {
      try {
        JSON.parse(output);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }, [output]);

  return (
    <div
      data-testid={testId}
      className={`rounded-2xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs shadow-inner ${className}`}
    >
      <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-2">
        <span className="font-sans text-xs font-semibold text-slate-300">
          {title}
        </span>
        <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/20">
          {isFormattedJson ? "JSON Output" : "Plain Output"} (Sanitized)
        </span>
      </div>

      <pre
        data-testid="sanitized-output-text"
        className="max-h-64 overflow-x-auto whitespace-pre-wrap break-words text-slate-200"
      >
        <code>{sanitizedContent}</code>
      </pre>
    </div>
  );
}

export default SanitizedTaskOutputViewer;
