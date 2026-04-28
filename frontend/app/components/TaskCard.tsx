import React, { useState, useEffect } from 'react';
import { Task } from '../types';
import { useTimeTracking } from '../context/TimeTrackingContext';
import { useHistory } from '../context/history/HistoryContext';
import { TimeDisplay } from './TimeDisplay';
import { TimerControls } from './TimerControls';
import { ManualTimeEntry } from './ManualTimeEntry';
import { MentionRenderer } from './MentionRenderer';
import { TaskHistory } from './TaskHistory';

interface TaskCardProps {
  task: Task;
}

export function TaskCard({ task }: TaskCardProps) {
  const { state } = useTimeTracking();
  const { addHistoryEvent } = useHistory();
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const isActive = state.activeTimer?.taskId === task.id;
  const isPaused = state.activeTimer?.isPaused || false;

  useEffect(() => {
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
      <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-6 space-y-4 shadow-xl">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-semibold text-lg">{task.functionName}</h3>
            <p className="text-neutral-400 font-mono text-sm">{task.contractAddress}</p>
            <p className="text-neutral-500 text-sm">Interval: {task.interval}s | Gas: {task.gasBalance} XLM</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-mono font-bold">
              <TimeDisplay seconds={displayTime} />
            </div>
            <div className="text-neutral-400 text-sm">Total Time</div>
            {isActive && (
              <div className="text-green-400 text-sm font-medium">
                {isPaused ? 'Paused' : 'Active'}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <TimerControls taskId={task.id} isActive={isActive} isPaused={isPaused} />
          <div className="flex gap-2">
            <button
              onClick={() => setShowManualEntry(true)}
              className="bg-neutral-700 hover:bg-neutral-600 text-white px-3 py-1 rounded text-sm font-medium transition-colors"
            >
              Add Time
            </button>
            <button
              onClick={() => setShowHistory(true)}
              className="bg-neutral-700 hover:bg-neutral-600 text-white px-3 py-1 rounded text-sm font-medium transition-colors"
              title="View History"
            >
              📋
            </button>
          </div>
        </div>

        {task.timeEntries.length > 0 && (
          <div className="border-t border-neutral-700 pt-4">
            <h4 className="text-sm font-medium text-neutral-400 mb-2">Recent Entries</h4>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {task.timeEntries.slice(-3).reverse().map((entry) => (
                <div key={entry.id} className="text-sm border-b border-neutral-700 pb-2 mb-2 last:border-b-0 last:pb-0 last:mb-0">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-neutral-300">
                      {entry.isManual ? 'Manual' : 'Timer'} - {entry.startTime.toLocaleDateString()}
                    </span>
                    <TimeDisplay seconds={entry.duration} className="font-mono text-neutral-400" />
                  </div>
                  {entry.description && (
                    <MentionRenderer text={entry.description} className="text-neutral-400 text-xs" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showManualEntry && (
        <ManualTimeEntry taskId={task.id} onClose={() => setShowManualEntry(false)} />
      )}

      <TaskHistory
        taskId={task.id}
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
      />
    </>
  );
}