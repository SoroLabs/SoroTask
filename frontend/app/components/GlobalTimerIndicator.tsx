import React, { useEffect, useState } from 'react';
import { useTimeTracking } from '../context/TimeTrackingContext';
import { TimeDisplay } from './TimeDisplay';

export function GlobalTimerIndicator() {
  const { state } = useTimeTracking();
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    if (state.activeTimer && !state.activeTimer.isPaused) {
      const interval = setInterval(() => {
        setCurrentTime(Math.floor((Date.now() - state.activeTimer!.startTime.getTime()) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setCurrentTime(0);
    }
  }, [state.activeTimer]);

  if (!state.activeTimer) return null;

  const task = state.tasks.find(t => t.id === state.activeTimer!.taskId);
  if (!task) return null;

  return (
    <div className="fixed bottom-4 right-4 bg-neutral-800 border border-neutral-700 rounded-lg p-3 shadow-lg z-50">
      <div className="flex items-center gap-3">
        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
        <div>
          <div className="text-sm font-medium text-neutral-200">{task.functionName}</div>
          <div className="text-lg font-mono font-bold text-green-400">
            <TimeDisplay seconds={currentTime} />
          </div>
          {state.activeTimer.isPaused && (
            <div className="text-xs text-yellow-400">Paused</div>
          )}
        </div>
      </div>
    </div>
  );
}