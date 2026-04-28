"use client";

import { useEffect, useRef } from "react";
import { useTask } from "@/src/hooks/tasks";
import { useLayoutStore } from "@/src/store/layoutStore";

// Simple icon components to avoid external dependencies
const XMarkIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const ArrowLeftIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
  </svg>
);

// ── Types ─────────────────────────────────────────────────────────────────────

interface TaskDetailPaneProps {
  taskId: string;
  onClose: () => void;
  showBackButton?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TaskDetailPane({
  taskId,
  onClose,
  showBackButton = false,
}: TaskDetailPaneProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { data: task, isLoading, isError } = useTask(taskId);
  const { closeDetailPane } = useLayoutStore();

  // Focus management: focus close button when pane opens
  useEffect(() => {
    if (closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
  }, [taskId]);

  // Handle invalid task: silently close pane
  useEffect(() => {
    if (isError) {
      closeDetailPane();
    }
  }, [isError, closeDetailPane]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      role="complementary"
      aria-label="Task detail"
      className="h-full flex flex-col bg-neutral-900"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-700 flex-shrink-0">
        <div className="flex items-center gap-3">
          {showBackButton && (
            <button
              onClick={onClose}
              className="p-2 hover:bg-neutral-800 rounded-lg transition-colors"
              aria-label="Back to list"
            >
              <ArrowLeftIcon className="w-5 h-5 text-neutral-300" />
            </button>
          )}
          <h2 className="text-lg font-semibold text-neutral-100">
            Task Details
          </h2>
        </div>
        {!showBackButton && (
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-2 hover:bg-neutral-800 rounded-lg transition-colors"
            aria-label="Close task detail"
          >
            <XMarkIcon className="w-5 h-5 text-neutral-300" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {isLoading && (
          <div className="space-y-4">
            <div className="h-8 bg-neutral-800 rounded animate-pulse" />
            <div className="h-4 bg-neutral-800 rounded animate-pulse w-3/4" />
            <div className="h-4 bg-neutral-800 rounded animate-pulse w-1/2" />
            <div className="space-y-2 mt-6">
              <div className="h-4 bg-neutral-800 rounded animate-pulse" />
              <div className="h-4 bg-neutral-800 rounded animate-pulse" />
              <div className="h-4 bg-neutral-800 rounded animate-pulse w-5/6" />
            </div>
          </div>
        )}

        {task && (
          <div className="space-y-6">
            {/* Task Title */}
            <div>
              <h3 className="text-2xl font-bold text-neutral-100 mb-2">
                {task.title}
              </h3>
              <div className="flex items-center gap-2 text-sm text-neutral-400">
                <span>ID: {task.id}</span>
                <span>•</span>
                <span>
                  Created {new Date(task.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>

            {/* Task Description */}
            {task.description && (
              <div>
                <h4 className="text-sm font-semibold text-neutral-300 mb-2 uppercase tracking-wide">
                  Description
                </h4>
                <div className="prose prose-invert prose-sm max-w-none">
                  <TaskDescriptionRenderer content={task.description} />
                </div>
              </div>
            )}

            {/* Task Metadata */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-neutral-800 rounded-lg p-4">
                <div className="text-xs text-neutral-400 mb-1">Status</div>
                <div className="text-sm font-medium text-neutral-100">
                  {getTaskStatus(task)}
                </div>
              </div>
              <div className="bg-neutral-800 rounded-lg p-4">
                <div className="text-xs text-neutral-400 mb-1">Updated</div>
                <div className="text-sm font-medium text-neutral-100">
                  {new Date(task.updatedAt).toLocaleDateString()}
                </div>
              </div>
            </div>

            {/* Additional task fields if they exist */}
            {(task as any).contract && (
              <div>
                <h4 className="text-sm font-semibold text-neutral-300 mb-2 uppercase tracking-wide">
                  Contract Details
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between py-2 border-b border-neutral-800">
                    <span className="text-sm text-neutral-400">Contract</span>
                    <span className="text-sm text-neutral-100 font-mono">
                      {(task as any).contract}
                    </span>
                  </div>
                  {(task as any).fn && (
                    <div className="flex justify-between py-2 border-b border-neutral-800">
                      <span className="text-sm text-neutral-400">Function</span>
                      <span className="text-sm text-neutral-100 font-mono">
                        {(task as any).fn}
                      </span>
                    </div>
                  )}
                  {(task as any).intervalSec && (
                    <div className="flex justify-between py-2 border-b border-neutral-800">
                      <span className="text-sm text-neutral-400">Interval</span>
                      <span className="text-sm text-neutral-100">
                        {(task as any).intervalSec}s
                      </span>
                    </div>
                  )}
                  {(task as any).gas !== undefined && (
                    <div className="flex justify-between py-2 border-b border-neutral-800">
                      <span className="text-sm text-neutral-400">Gas</span>
                      <span className="text-sm text-neutral-100">
                        {(task as any).gas}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helper components ─────────────────────────────────────────────────────────

function TaskDescriptionRenderer({ content }: { content: any }) {
  // Simple renderer for Tiptap JSON content
  // In production, use a proper Tiptap renderer with DOMPurify
  if (!content || !content.content) {
    return <p className="text-neutral-400">No description</p>;
  }

  return (
    <div className="text-neutral-300">
      {content.content.map((node: any, idx: number) => {
        if (node.type === "paragraph") {
          return (
            <p key={idx} className="mb-2">
              {node.content?.map((child: any, childIdx: number) => {
                if (child.type === "text") {
                  return <span key={childIdx}>{child.text}</span>;
                }
                return null;
              })}
            </p>
          );
        }
        return null;
      })}
    </div>
  );
}

function getTaskStatus(task: any): string {
  if (task.status) {
    return task.status.charAt(0).toUpperCase() + task.status.slice(1);
  }
  return "Active";
}
