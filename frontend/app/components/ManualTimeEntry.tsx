import React, { useState } from 'react';
import { useTimeTracking } from '../context/TimeTrackingContext';
import { TimeEntry } from '../types';
import { MentionsInput } from './MentionsInput';

interface ManualTimeEntryProps {
  taskId: string;
  onClose: () => void;
}

export function ManualTimeEntry({ taskId, onClose }: ManualTimeEntryProps) {
  const { dispatch } = useTimeTracking();
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const totalSeconds = hours * 3600 + minutes * 60;
    if (totalSeconds <= 0) {
      alert('Please enter a valid time greater than 0');
      return;
    }
    if (totalSeconds > 24 * 3600) { // Max 24 hours
      alert('Time entry cannot exceed 24 hours');
      return;
    }
    const entry: TimeEntry = {
      id: `manual-${Date.now()}`,
      taskId,
      startTime: new Date(),
      duration: totalSeconds,
      isManual: true,
      description: description.trim() || undefined,
    };
    dispatch({ type: 'ADD_TIME_ENTRY', payload: entry });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-neutral-800 border border-neutral-700 rounded-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-4">Add Time Manually</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-400 mb-1">Hours</label>
              <input
                type="number"
                min="0"
                value={hours}
                onChange={(e) => setHours(parseInt(e.target.value) || 0)}
                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-400 mb-1">Minutes</label>
              <input
                type="number"
                min="0"
                max="59"
                value={minutes}
                onChange={(e) => setMinutes(parseInt(e.target.value) || 0)}
                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-400 mb-1">
              Description (optional) - Use @ for users, # for tasks, $ for contracts
            </label>
            <MentionsInput
              value={description}
              onChange={setDescription}
              placeholder="What did you work on? Mention @Alice or #Harvest Task"
              rows={3}
            />
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 rounded-lg transition-colors"
            >
              Add Time
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-neutral-700 hover:bg-neutral-600 text-white font-medium py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}