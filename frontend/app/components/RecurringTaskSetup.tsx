'use client';

import React, { useState, useEffect } from 'react';

type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly';

export default function RecurringTaskSetup() {
  const [type, setType] = useState<RecurrenceType>('none');
  const [interval, setInterval] = useState(1);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [summary, setSummary] = useState('');
  const [previews, setPreviews] = useState<string[]>([]);

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  useEffect(() => {
    generateSummary();
    generatePreviews();
  }, [type, interval, daysOfWeek, dayOfMonth]);

  const generateSummary = () => {
    if (type === 'none') {
      setSummary('Single execution');
      return;
    }

    let text = `Every ${interval > 1 ? interval : ''} `;
    if (type === 'daily') {
      text += interval > 1 ? 'days' : 'day';
    } else if (type === 'weekly') {
      text += interval > 1 ? 'weeks' : 'week';
      if (daysOfWeek.length > 0) {
        text += ` on ${daysOfWeek.map(d => days[d]).join(', ')}`;
      }
    } else if (type === 'monthly') {
      text += interval > 1 ? 'months' : 'month';
      text += ` on day ${dayOfMonth}`;
    }
    setSummary(text);
  };

  const generatePreviews = () => {
    if (type === 'none') {
      setPreviews([]);
      return;
    }

    const dates: string[] = [];
    let current = new Date();
    
    for (let i = 0; i < 5; i++) {
      if (type === 'daily') {
        current.setDate(current.getDate() + interval);
      } else if (type === 'weekly') {
        if (daysOfWeek.length === 0) {
          current.setDate(current.getDate() + 7 * interval);
        } else {
          // Simplistic next-occurrence logic for preview
          let found = false;
          for (let d = 1; d <= 7 * interval; d++) {
            let next = new Date(current);
            next.setDate(next.getDate() + d);
            if (daysOfWeek.includes(next.getDay())) {
              current = next;
              found = true;
              break;
            }
          }
          if (!found) break;
        }
      } else if (type === 'monthly') {
        current.setMonth(current.getMonth() + interval);
        current.setDate(dayOfMonth);
      }
      dates.push(current.toLocaleString(undefined, { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }));
    }
    setPreviews(dates);
  };

  const toggleDay = (day: number) => {
    setDaysOfWeek(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  return (
    <div className="space-y-4 bg-neutral-900/50 p-4 rounded-lg border border-neutral-700/50">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-neutral-400">Recurrence Pattern</label>
        <select 
          value={type} 
          onChange={(e) => setType(e.target.value as RecurrenceType)}
          className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="none">One-time</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>

      {type !== 'none' && (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-3">
            <label className="text-sm text-neutral-400">Every</label>
            <input 
              type="number" 
              min="1" 
              value={interval}
              onChange={(e) => setInterval(parseInt(e.target.value) || 1)}
              className="w-16 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="text-sm text-neutral-400">
              {type === 'daily' ? 'day(s)' : type === 'weekly' ? 'week(s)' : 'month(s)'}
            </span>
          </div>

          {type === 'weekly' && (
            <div className="flex flex-wrap gap-2">
              {days.map((day, idx) => (
                <button
                  key={day}
                  onClick={() => toggleDay(idx)}
                  className={`w-10 h-10 rounded-full text-xs font-medium transition-all ${
                    daysOfWeek.includes(idx) 
                      ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-600/20' 
                      : 'bg-neutral-800 text-neutral-400 border-neutral-700 hover:border-neutral-500'
                  } border`}
                >
                  {day[0]}
                </button>
              ))}
            </div>
          )}

          {type === 'monthly' && (
            <div className="flex items-center gap-3">
              <label className="text-sm text-neutral-400">On day</label>
              <input 
                type="number" 
                min="1" 
                max="31"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(parseInt(e.target.value) || 1)}
                className="w-16 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}

          <div className="pt-2 border-t border-neutral-800">
            <div className="text-sm font-medium text-blue-400 mb-2 flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
              {summary}
            </div>
            
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider font-bold text-neutral-500">Next occurrences:</label>
              <div className="grid grid-cols-1 gap-1">
                {previews.map((date, i) => (
                  <div key={i} className="text-xs text-neutral-400 flex items-center gap-2">
                    <span className="text-neutral-600 font-mono w-4">{i+1}.</span>
                    {date}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
