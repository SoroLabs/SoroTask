import React from 'react';
import { useTimeTracking } from '../context/TimeTrackingContext';

interface TimerControlsProps {
  taskId: string;
  isActive: boolean;
  isPaused: boolean;
}

export function TimerControls({ taskId, isActive, isPaused }: TimerControlsProps) {
  const { dispatch } = useTimeTracking();

  const handleStart = () => {
    dispatch({ type: 'START_TIMER', payload: { taskId } });
  };

  const handlePause = () => {
    dispatch({ type: 'PAUSE_TIMER' });
  };

  const handleStop = () => {
    dispatch({ type: 'STOP_TIMER' });
  };

  return (
    <div className="flex gap-2">
      {!isActive ? (
        <button
          onClick={handleStart}
          className="bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded text-sm font-medium transition-colors"
        >
          Start
        </button>
      ) : (
        <>
          {isPaused ? (
            <button
              onClick={handleStart}
              className="bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded text-sm font-medium transition-colors"
            >
              Resume
            </button>
          ) : (
            <button
              onClick={handlePause}
              className="bg-yellow-600 hover:bg-yellow-500 text-white px-3 py-1 rounded text-sm font-medium transition-colors"
            >
              Pause
            </button>
          )}
          <button
            onClick={handleStop}
            className="bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded text-sm font-medium transition-colors"
          >
            Stop
          </button>
        </>
      )}
    </div>
  );
}