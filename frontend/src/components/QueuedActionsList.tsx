"use client";

import type { ActionStatus, QueuedAction } from "../lib/queue/actionQueue";

export interface QueuedActionsListProps {
  actions: readonly QueuedAction[];
  onRetry?: (id: string) => void;
  onCancel?: (id: string) => void;
  onRemove?: (id: string) => void;
  onClearCompleted?: () => void;
  // Format a payload for display. Defaults to JSON.stringify.
  describe?: (action: QueuedAction) => string;
}

const STATUS_TONE: Record<ActionStatus, string> = {
  pending: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  in_flight: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  succeeded: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  failed: "bg-red-500/10 text-red-300 border-red-500/30",
  cancelled: "bg-neutral-700/30 text-neutral-400 border-neutral-700/50",
};

const STATUS_LABEL: Record<ActionStatus, string> = {
  pending: "Pending",
  in_flight: "Running",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function QueuedActionsList({
  actions,
  onRetry,
  onCancel,
  onRemove,
  onClearCompleted,
  describe = defaultDescribe,
}: QueuedActionsListProps) {
  const hasCompleted = actions.some(
    (a) => a.status === "succeeded" || a.status === "cancelled",
  );

  if (actions.length === 0) {
    return (
      <div
        data-testid="queued-actions-empty"
        className="rounded-lg border border-neutral-700/50 bg-neutral-900/40 p-4 text-sm text-neutral-500"
      >
        No queued actions.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {hasCompleted && onClearCompleted && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClearCompleted}
            data-testid="queued-actions-clear-completed"
            className="text-xs text-neutral-400 hover:text-neutral-200"
          >
            Clear completed
          </button>
        </div>
      )}
      <ul className="space-y-2">
        {actions.map((action) => (
          <li
            key={action.id}
            data-testid="queued-action-row"
            data-id={action.id}
            data-status={action.status}
            className="rounded-lg border border-neutral-700/50 bg-neutral-900/40 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_TONE[action.status]}`}
                  >
                    {STATUS_LABEL[action.status]}
                  </span>
                  <span className="font-mono text-xs text-neutral-400">
                    {action.type}
                  </span>
                  {action.attempts > 0 && (
                    <span className="text-xs text-neutral-500">
                      attempt {action.attempts}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-neutral-300 break-all">
                  {describe(action)}
                </p>
                {action.lastError && action.status !== "succeeded" && (
                  <p className="mt-1 text-xs text-red-300 break-all">
                    {action.lastError}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {action.status === "failed" && onRetry && (
                  <button
                    type="button"
                    onClick={() => onRetry(action.id)}
                    data-testid="queued-action-retry"
                    className="px-2 py-1 rounded-md text-xs bg-neutral-100 text-neutral-900 hover:bg-white"
                  >
                    Retry
                  </button>
                )}
                {(action.status === "pending" || action.status === "failed") &&
                  onCancel && (
                    <button
                      type="button"
                      onClick={() => onCancel(action.id)}
                      data-testid="queued-action-cancel"
                      className="px-2 py-1 rounded-md text-xs bg-neutral-800 border border-neutral-700 text-neutral-300 hover:bg-neutral-700"
                    >
                      Cancel
                    </button>
                  )}
                {(action.status === "succeeded" ||
                  action.status === "cancelled") &&
                  onRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(action.id)}
                      data-testid="queued-action-remove"
                      className="px-2 py-1 rounded-md text-xs text-neutral-400 hover:text-neutral-200"
                    >
                      Dismiss
                    </button>
                  )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function defaultDescribe(action: QueuedAction): string {
  try {
    return JSON.stringify(action.payload);
  } catch {
    return "[unserializable payload]";
  }
}
