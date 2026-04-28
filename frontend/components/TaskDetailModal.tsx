'use client';

import { Task } from './TaskDependencyManager';
import TaskDependencyManager from './TaskDependencyManager';

interface TaskDetailModalProps {
  task: Task | null;
  allTasks: Task[];
  onClose: () => void;
  onAddDependency: (taskId: number, dependsOnId: number) => Promise<void>;
  onRemoveDependency: (taskId: number, dependsOnId: number) => Promise<void>;
}

export default function TaskDetailModal({
  task,
  allTasks,
  onClose,
  onAddDependency,
  onRemoveDependency,
}: TaskDetailModalProps) {
  if (!task) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-neutral-900 border border-neutral-700/50 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-neutral-900 border-b border-neutral-800 p-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-neutral-100">
            Task #{task.id}
          </h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Task Status */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${
                task.isActive
                  ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                  : 'bg-neutral-700 text-neutral-400'
              }`}
            >
              {task.isActive ? 'Active' : 'Paused'}
            </span>
            {task.lastRun === 0 && (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Not Executed Yet
              </span>
            )}
          </div>

          {/* Task Details */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-400 mb-1">Creator</label>
              <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg px-4 py-2 font-mono text-sm text-neutral-300">
                {task.creator}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-400 mb-1">Target Contract</label>
              <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg px-4 py-2 font-mono text-sm text-neutral-300">
                {task.target}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-1">Function</label>
                <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg px-4 py-2 font-mono text-sm text-neutral-300">
                  {task.function}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-1">Interval</label>
                <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg px-4 py-2 text-sm text-neutral-300">
                  {task.interval} seconds
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-1">Gas Balance</label>
                <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg px-4 py-2 font-mono text-sm text-neutral-300">
                  {task.gasBalance}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-1">Last Run</label>
                <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg px-4 py-2 text-sm text-neutral-300">
                  {task.lastRun === 0 ? 'Never' : new Date(task.lastRun * 1000).toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          {/* Dependency Management */}
          <div className="border-t border-neutral-800 pt-6">
            <TaskDependencyManager
              task={task}
              allTasks={allTasks}
              onAddDependency={onAddDependency}
              onRemoveDependency={onRemoveDependency}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
