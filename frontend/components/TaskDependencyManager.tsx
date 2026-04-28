'use client';

import React, { useState } from 'react';

export interface Task {
  id: number;
  creator: string;
  target: string;
  function: string;
  interval: number;
  lastRun: number;
  gasBalance: number;
  isActive: boolean;
  blockedBy: number[];
}

interface TaskDependencyManagerProps {
  task: Task;
  allTasks: Task[];
  onAddDependency: (taskId: number, dependsOnId: number) => Promise<void>;
  onRemoveDependency: (taskId: number, dependsOnId: number) => Promise<void>;
}

export default function TaskDependencyManager({
  task,
  allTasks,
  onAddDependency,
  onRemoveDependency,
}: TaskDependencyManagerProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableTasks = allTasks.filter(
    (t) => t.id !== task.id && !task.blockedBy.includes(t.id)
  );

  const handleAddDependency = async () => {
    if (!selectedTaskId) return;

    setIsAdding(true);
    setError(null);

    try {
      await onAddDependency(task.id, parseInt(selectedTaskId));
      setSelectedTaskId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add dependency');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveDependency = async (dependsOnId: number) => {
    setError(null);
    try {
      await onRemoveDependency(task.id, dependsOnId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove dependency');
    }
  };

  const getDependencyTask = (id: number) => allTasks.find((t) => t.id === id);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-neutral-200 mb-3">Dependencies</h3>
        
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        {task.blockedBy.length === 0 ? (
          <p className="text-neutral-500 text-sm">No dependencies</p>
        ) : (
          <div className="space-y-2">
            {task.blockedBy.map((depId) => {
              const depTask = getDependencyTask(depId);
              return (
                <div
                  key={depId}
                  className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-3 flex items-center justify-between"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-neutral-300">
                        Task #{depId}
                      </span>
                      {depTask && depTask.lastRun === 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                          Blocking
                        </span>
                      )}
                      {depTask && depTask.lastRun > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                          Completed
                        </span>
                      )}
                    </div>
                    {depTask && (
                      <p className="text-xs text-neutral-500 mt-1">
                        {depTask.target.slice(0, 8)}...{depTask.target.slice(-6)} · {depTask.function}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemoveDependency(depId)}
                    className="text-red-400 hover:text-red-300 transition-colors text-sm"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-sm font-medium text-neutral-400 mb-2">Add Dependency</h4>
        <div className="flex gap-2">
          <select
            value={selectedTaskId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedTaskId(e.target.value)}
            className="flex-1 bg-neutral-900 border border-neutral-700/50 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            disabled={isAdding || availableTasks.length === 0}
          >
            <option value="">Select a task...</option>
            {availableTasks.map((t) => (
              <option key={t.id} value={t.id}>
                Task #{t.id} - {t.function} ({t.target.slice(0, 8)}...)
              </option>
            ))}
          </select>
          <button
            onClick={handleAddDependency}
            disabled={!selectedTaskId || isAdding}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {isAdding ? 'Adding...' : 'Add'}
          </button>
        </div>
        {availableTasks.length === 0 && (
          <p className="text-xs text-neutral-500 mt-2">No available tasks to add as dependencies</p>
        )}
      </div>
    </div>
  );
}
