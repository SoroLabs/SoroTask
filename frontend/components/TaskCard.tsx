'use client';

import { useState } from 'react';
import { Task } from './TaskDependencyManager';
import { ConfirmDialog } from './ConfirmDialog';

interface TaskCardProps {
  task: Task;
  onViewDetails: (task: Task) => void;
  onPause?: (taskId: string) => void;
  onResume?: (taskId: string) => void;
  onCancel?: (taskId: string) => void;
  isBlocked?: boolean;
}

export default function TaskCard({ task, onViewDetails, onPause, onResume, onCancel, isBlocked }: TaskCardProps) {
  const [showActions, setShowActions] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ type: string; label: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const hasBlockingDependencies = task.blockedBy.length > 0 && task.lastRun === 0;

  const handleAction = (type: string, label: string) => {
    setConfirmAction({ type, label });
  };

  const executeAction = async () => {
    if (!confirmAction) return;
    setIsLoading(true);
    try {
      if (confirmAction.type === 'pause' && onPause) {
        onPause(task.id);
      } else if (confirmAction.type === 'resume' && onResume) {
        onResume(task.id);
      } else if (confirmAction.type === 'cancel' && onCancel) {
        onCancel(task.id);
      }
    } finally {
      setIsLoading(false);
      setConfirmAction(null);
    }
  };

  return (
    <>
    <div
      className={`bg-neutral-800/50 border rounded-xl p-4 hover:border-neutral-600 transition-all cursor-pointer relative ${
        isBlocked ? 'border-yellow-500/30' : 'border-neutral-700/50'
      }`}
      onClick={() => onViewDetails(task)}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-lg font-semibold text-neutral-200">
            #{task.id}
          </span>
          {!task.isActive && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-neutral-700 text-neutral-400">
              Paused
            </span>
          )}
          {hasBlockingDependencies && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
              Blocked
            </span>
          )}
        </div>
        <div className="text-right">
          <button
            onClick={(e) => { e.stopPropagation(); setShowActions(!showActions); }}
            className="p-1 hover:bg-neutral-700 rounded text-neutral-400 hover:text-neutral-200 mb-1"
          >
            ⋮
          </button>
          <div className="text-xs text-neutral-500">Gas Balance</div>
          <div className="font-mono text-sm text-neutral-300">{task.gasBalance}</div>
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <div className="text-xs text-neutral-500">Target</div>
          <div className="font-mono text-sm text-neutral-300 truncate">
            {task.target.slice(0, 12)}...{task.target.slice(-8)}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-xs text-neutral-500">Function</div>
            <div className="font-mono text-sm text-neutral-300">{task.function}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Interval</div>
            <div className="text-sm text-neutral-300">{task.interval}s</div>
          </div>
        </div>

        {task.blockedBy.length > 0 && (
          <div className="pt-2 border-t border-neutral-700/50">
            <div className="text-xs text-neutral-500 mb-1">Dependencies</div>
            <div className="flex flex-wrap gap-1">
              {task.blockedBy.map((depId) => (
                <span
                  key={depId}
                  className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono bg-neutral-700/50 text-neutral-400"
                >
                  #{depId}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {showActions && (
        <div className="mt-3 pt-3 border-t border-neutral-700/50">
          <div className="flex gap-2">
            {task.isActive ? (
              <button
                onClick={(e) => { e.stopPropagation(); handleAction('pause', 'Pause Task'); }}
                className="flex-1 px-3 py-1.5 text-xs font-medium bg-neutral-700 hover:bg-neutral-600 text-neutral-300 rounded transition-colors"
              >
                ⏸ Pause
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); handleAction('resume', 'Resume Task'); }}
                className="flex-1 px-3 py-1.5 text-xs font-medium bg-neutral-700 hover:bg-neutral-600 text-neutral-300 rounded transition-colors"
              >
                ▶ Resume
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); handleAction('cancel', 'Cancel Task'); }}
              className="flex-1 px-3 py-1.5 text-xs font-medium bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded transition-colors"
            >
              ✕ Cancel
            </button>
          </div>
        </div>
      )}
    </div>

    <ConfirmDialog
      open={!!confirmAction}
      onClose={() => setConfirmAction(null)}
      onConfirm={executeAction}
      title={confirmAction?.label || ''}
      description={`Are you sure you want to ${confirmAction?.type} this task? This action cannot be undone.`}
      confirmLabel={confirmAction?.type === 'cancel' ? 'Cancel Task' : 'Confirm'}
      isLoading={isLoading}
      intent={confirmAction?.type === 'cancel' ? 'danger' : 'primary'}
    />
    </>
  );
}