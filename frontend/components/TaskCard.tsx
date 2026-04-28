'use client';

import { Task } from './TaskDependencyManager';

interface TaskCardProps {
  task: Task;
  onViewDetails: (task: Task) => void;
  isBlocked?: boolean;
}

export default function TaskCard({ task, onViewDetails, isBlocked }: TaskCardProps) {
  const hasBlockingDependencies = task.blockedBy.length > 0 && task.lastRun === 0;

  return (
    <div
      className={`bg-neutral-800/50 border rounded-xl p-4 hover:border-neutral-600 transition-all cursor-pointer ${
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
    </div>
  );
}
