'use client';

import React, { useState } from 'react';
import { Task } from '../types';
import { useTimeTracking } from '../context/TimeTrackingContext';
import { TimeDisplay } from './TimeDisplay';
import { TimerControls } from './TimerControls';
import { ManualTimeEntry } from './ManualTimeEntry';
import { MentionRenderer } from './MentionRenderer';
import { TaskHistory } from './TaskHistory';

interface TaskDetailProps {
  task: Task;
  onClose: () => void;
}

export function TaskDetail({ task, onClose }: TaskDetailProps) {
  const { state } = useTimeTracking();
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const isActive = state.activeTimer?.taskId === task.id;
  const isPaused = state.activeTimer?.isPaused || false;

  React.useEffect(() => {
    if (isActive && !isPaused) {
      const interval = setInterval(() => {
        setCurrentTime(Math.floor((Date.now() - state.activeTimer!.startTime.getTime()) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setCurrentTime(0);
    }
  }, [isActive, isPaused, state.activeTimer]);

  const displayTime = task.totalTime + (isActive ? currentTime : 0);

  return (
    <>
      <div className="h-full flex flex-col bg-neutral-900">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-neutral-700">
          <div>
            <h2 className="text-2xl font-bold">{task.functionName}</h2>
            <p className="text-neutral-400 font-mono text-sm mt-1">{task.contractAddress}</p>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-200 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-4">
              <div className="text-3xl font-mono font-bold text-blue-400">
                <TimeDisplay seconds={displayTime} />
              </div>
              <div className="text-neutral-400 text-sm mt-1">Total Time</div>
              {isActive && (
                <div className="text-green-400 text-sm font-medium mt-1">
                  {isPaused ? 'Paused' : 'Active'}
                </div>
              )}
            </div>
            <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-4">
              <div className="text-3xl font-mono font-bold text-purple-400">
                {task.timeEntries.length}
              </div>
              <div className="text-neutral-400 text-sm mt-1">Time Entries</div>
            </div>
          </div>

          {/* Task Configuration */}
          <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-4">
            <h3 className="text-lg font-semibold mb-4">Configuration</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-neutral-400">Function:</span>
                <div className="font-mono text-neutral-200 mt-1">{task.functionName}</div>
              </div>
              <div>
                <span className="text-neutral-400">Contract:</span>
                <div className="font-mono text-neutral-200 mt-1 break-all">{task.contractAddress}</div>
              </div>
              <div>
                <span className="text-neutral-400">Interval:</span>
                <div className="text-neutral-200 mt-1">{task.interval} seconds</div>
              </div>
              <div>
                <span className="text-neutral-400">Gas Balance:</span>
                <div className="text-neutral-200 mt-1">{task.gasBalance} XLM</div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-neutral-700">
              <span className="text-neutral-400 text-sm">Created:</span>
              <div className="text-neutral-200 mt-1">{task.createdAt.toLocaleString()}</div>
            </div>
          </div>

          {/* Controls */}
          <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-4">
            <h3 className="text-lg font-semibold mb-4">Controls</h3>
            <div className="space-y-4">
              <TimerControls taskId={task.id} isActive={isActive} isPaused={isPaused} />
              <div className="flex gap-2">
                <button
                  onClick={() => setShowManualEntry(true)}
                  className="bg-neutral-700 hover:bg-neutral-600 text-white px-4 py-2 rounded font-medium transition-colors"
                >
                  Add Time Entry
                </button>
                <button
                  onClick={() => setShowHistory(true)}
                  className="bg-neutral-700 hover:bg-neutral-600 text-white px-4 py-2 rounded font-medium transition-colors"
                  title="View History"
                >
                  📋 History
                </button>
              </div>
            </div>
          </div>

          {/* Time Entries */}
          {task.timeEntries.length > 0 && (
            <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-4">Time Entries</h3>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {task.timeEntries.slice().reverse().map((entry) => (
                  <div key={entry.id} className="border-b border-neutral-700 pb-3 last:border-b-0">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <span className="text-neutral-300 font-medium">
                          {entry.isManual ? 'Manual Entry' : 'Timer Session'}
                        </span>
                        <div className="text-neutral-400 text-sm">
                          {entry.startTime.toLocaleString()}
                          {entry.endTime && ` - ${entry.endTime.toLocaleString()}`}
                        </div>
                      </div>
                      <TimeDisplay seconds={entry.duration} className="font-mono text-neutral-200" />
                    </div>
                    {entry.description && (
                      <div className="mt-2">
                        <MentionRenderer text={entry.description} className="text-neutral-400 text-sm" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {showManualEntry && (
        <ManualTimeEntry taskId={task.id} onClose={() => setShowManualEntry(false)} />
      )}

      {showHistory && (
        <TaskHistory
          taskId={task.id}
          isOpen={showHistory}
          onClose={() => setShowHistory(false)}
        />
      )}
    </>
  );
}