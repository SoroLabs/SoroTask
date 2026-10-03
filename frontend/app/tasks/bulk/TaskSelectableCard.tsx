'use client';

import React from 'react';
import { useTaskSelection } from '@/src/hooks/useTaskSelection';
import {
  isBatchSelected,
  taskCheckboxLabel,
  useTaskBulkSelection,
} from './bulkSelectionStore';

// Same flexible task shape as components/TaskCardWithSelection so the card can
// render list, board and indexer-driven task shapes without over-constraining.
interface BaseTask {
  id: string | number;
  target?: string;
  function?: string;
  interval?: number;
  gasBalance?: number;
  isActive?: boolean;
  blockedBy?: number[];
  lastRun?: number;
}

interface TaskSelectableCardProps {
  task: BaseTask;
  isBlocked?: boolean;
}

/**
 * A task card (or "table row", for the tasks list) with a batch checkbox.
 * Clicking the card still opens the detail pane; the checkbox toggles the
 * multi-select used by the batch console (#1265).
 */
export default function TaskSelectableCard({ task, isBlocked }: TaskSelectableCardProps) {
  const taskId = String(task.id);
  const { selectTask } = useTaskSelection();
  const { selectedIds, toggle } = useTaskBulkSelection();
  const isSelected = isBatchSelected(selectedIds, taskId);
  const hasBlockingDependencies = task.blockedBy && task.blockedBy.length > 0 && task.lastRun === 0;

  const handleSelect = () => {
    selectTask(taskId);
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    toggle(taskId);
  };

  return (
    <div
      className={`flex gap-3 bg-neutral-800/50 border rounded-xl p-4 hover:border-neutral-600 transition-all cursor-pointer ${
        isSelected
          ? 'border-primary-500 ring-2 ring-primary-500/50 bg-primary-500/5'
          : isBlocked
          ? 'border-yellow-500/30'
          : 'border-neutral-700/50'
      }`}
      onClick={handleSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleSelect();
        }
      }}
      aria-pressed={isSelected}
      data-task-id={taskId}
      data-testid="task-card"
    >
      <div className="flex items-start pt-0.5">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleCheckboxChange}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label={taskCheckboxLabel(taskId)}
          data-testid={`task-checkbox-${taskId}`}
          className="mt-1 h-4 w-4 rounded border-neutral-600 bg-neutral-900 text-primary-500 focus:ring-primary-500"
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-semibold text-neutral-200">
              #{task.id}
            </span>
            {task.isActive === false && (
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
          {task.gasBalance !== undefined && (
            <div className="text-right">
              <div className="text-xs text-neutral-500">Gas Balance</div>
              <div className="font-mono text-sm text-neutral-300">{task.gasBalance}</div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          {task.target && (
            <div>
              <div className="text-xs text-neutral-500">Target</div>
              <div className="font-mono text-sm text-neutral-300 truncate">
                {task.target.slice(0, 12)}...{task.target.slice(-8)}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            {task.function && (
              <div>
                <div className="text-xs text-neutral-500">Function</div>
                <div className="font-mono text-sm text-neutral-300">{task.function}</div>
              </div>
            )}
            {task.interval !== undefined && (
              <div>
                <div className="text-xs text-neutral-500">Interval</div>
                <div className="text-sm text-neutral-300">{task.interval}s</div>
              </div>
            )}
          </div>

          {task.blockedBy && task.blockedBy.length > 0 && (
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
      </div>
    </div>
  );
}