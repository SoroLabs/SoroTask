'use client';

import React, { useState, useMemo } from 'react';
import { Task, TaskExecution, TasksByDate } from '@/types/task';
import {
  getMonthCalendarGrid,
  formatDateKey,
  isSameDay,
  isToday,
  addMonths,
  getMonthName,
  getDayName,
} from '@/lib/dateUtils';
import { getUserTimezone } from '@/lib/timezoneUtils';
import CalendarDay from './CalendarDay';
import DenseTaskPopover from './DenseTaskPopover';

interface CalendarProps {
  tasks: Task[];
  /** Execution history, used to show per-day run density. */
  executions?: TaskExecution[];
  onTaskClick?: (task: Task) => void;
  /** Called with the runs recorded on a day, for the execution drilldown. */
  onDayDrilldown?: (date: Date, executions: TaskExecution[]) => void;
  locale?: string;
  timezone?: string;
  compact?: boolean;
}

export default function Calendar({
  tasks,
  executions = [],
  onTaskClick,
  onDayDrilldown,
  locale = 'en-US',
  timezone = getUserTimezone(),
  compact = false,
}: CalendarProps) {
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  // Group tasks by due date
  const tasksByDate: TasksByDate = useMemo(() => {
    const grouped: TasksByDate = {};
    tasks.forEach((task) => {
      if (task.deadline) {
        const dateKey = formatDateKey(task.deadline);
        if (!grouped[dateKey]) {
          grouped[dateKey] = [];
        }
        grouped[dateKey].push(task);
      }
    });
    return grouped;
  }, [tasks]);

  // Map executions onto calendar days so the grid can show how busy each day
  // was, not just how many deadlines land on it.
  const executionsByDate: Record<string, TaskExecution[]> = useMemo(() => {
    const grouped: Record<string, TaskExecution[]> = {};
    for (const execution of executions) {
      const dateKey = formatDateKey(execution.executedAt);
      grouped[dateKey] = [...(grouped[dateKey] ?? []), execution];
    }
    return grouped;
  }, [executions]);

  // Peak day, used to scale the density bar against the busiest day in view
  // rather than an arbitrary constant.
  const peakDayCount = useMemo(
    () => Object.values(executionsByDate).reduce((max, list) => Math.max(max, list.length), 0),
    [executionsByDate],
  );

  // Get calendar grid for current month
  const calendarGrid = useMemo(
    () =>
      getMonthCalendarGrid(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1
      ),
    [currentDate]
  );

  const goToPreviousMonth = () => {
    setCurrentDate((prev) => addMonths(prev, -1));
  };

  const goToNextMonth = () => {
    setCurrentDate((prev) => addMonths(prev, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
  };

  const weekDays = Array.from({ length: 7 }, (_, i) =>
    getDayName(i, { locale, format: 'short' })
  );

  const monthName = getMonthName(currentDate.getMonth() + 1, {
    locale,
    format: 'long',
  });

  return (
    <div className="w-full bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-3 sm:p-6 shadow-xl">
      {/* Header with navigation */}
      <div className="mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <h3 className="text-lg sm:text-xl font-bold">Schedule Calendar</h3>
            <button
              onClick={goToToday}
              className="text-xs px-3 py-1.5 rounded-md bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 transition-colors border border-blue-500/30 self-start sm:self-auto"
            >
              Today
            </button>
          </div>

          <div className="flex items-center justify-between sm:justify-center gap-2">
            <button
              onClick={goToPreviousMonth}
              className="px-3 py-2 rounded-md bg-neutral-700/50 hover:bg-neutral-700 transition-colors touch-manipulation"
              aria-label="Previous month"
            >
              ←
            </button>
            <div className="min-w-[120px] sm:min-w-[160px] text-center">
              <span className="text-base sm:text-lg font-semibold">
                {monthName} {currentDate.getFullYear()}
              </span>
            </div>
            <button
              onClick={goToNextMonth}
              className="px-3 py-2 rounded-md bg-neutral-700/50 hover:bg-neutral-700 transition-colors touch-manipulation"
              aria-label="Next month"
            >
              →
            </button>
          </div>

          <div className="text-xs text-neutral-400 text-center sm:text-right">
            <span className="hidden sm:inline">Timezone: {timezone}</span>
            <span className="sm:hidden">{timezone.split('/')[1]}</span>
          </div>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="overflow-x-auto -mx-3 sm:mx-0">
        <div className="inline-block min-w-full px-3 sm:px-0">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2">
            {weekDays.map((day, index) => (
              <div
                key={index}
                className="text-center font-medium text-neutral-400 text-xs sm:text-sm py-1 sm:py-2"
              >
                <span className="hidden sm:inline">{day}</span>
                <span className="sm:hidden">{day.slice(0, 3)}</span>
              </div>
            ))}
          </div>

          {/* Calendar days */}
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {calendarGrid.map((week, weekIndex) =>
              week.map((day, dayIndex) => {
                const dateKey = formatDateKey(day);
                const dayTasks = tasksByDate[dateKey] || [];
                const isCurrentMonth =
                  day.getMonth() === currentDate.getMonth();
                const isTodayDate = isToday(day);
                const isSelectedDate =
                  !!(selectedDate && isSameDay(selectedDate, day));
                const isExpanded = expandedDate === dateKey;

                return (
                  <div key={`${weekIndex}-${dayIndex}`} className="relative">
                    <CalendarDay
                      date={day}
                      tasks={dayTasks}
                      isCurrentMonth={isCurrentMonth}
                      isToday={isTodayDate}
                      isSelected={isSelectedDate}
                      compact={compact}
                      // Run density for the day, relative to the busiest day
                      // in the month.
                      executionCount={executionsByDate[dateKey]?.length ?? 0}
                      executionIntensity={
                        peakDayCount > 0
                          ? (executionsByDate[dateKey]?.length ?? 0) / peakDayCount
                          : 0
                      }
                      onSelect={() => setSelectedDate(day)}
                      onTaskClick={onTaskClick}
                      onExpandClick={() =>
                        setExpandedDate(isExpanded ? null : dateKey)
                      }
                    />

                    {/* Dense task popover */}
                    {dayTasks.length > 2 && isExpanded && (
                      <DenseTaskPopover
                        tasks={dayTasks}
                        date={day}
                        onTaskClick={(task) => {
                          onTaskClick?.(task);
                          setExpandedDate(null);
                        }}
                        onClose={() => setExpandedDate(null)}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-6 pt-4 border-t border-neutral-700/50">
        <div className="text-xs text-neutral-400 space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500" />
            <span>Today</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span>Task with deadline</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-orange-500" />
            <span>Multiple tasks on same date</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span>Past deadline</span>
          </div>
        </div>
      </div>

      {/* Task summary */}
      {selectedDate && (
        <div className="mt-6 pt-4 border-t border-neutral-700/50">
          <h4 className="text-sm font-semibold mb-2 text-neutral-300">
            Tasks on {selectedDate.toLocaleDateString(locale)}
          </h4>
          <div className="space-y-2">
            {tasksByDate[formatDateKey(selectedDate)]?.length > 0 ? (
              tasksByDate[formatDateKey(selectedDate)].map((task) => (
                <div
                  key={task.id}
                  className="text-xs bg-neutral-900/50 border border-neutral-700/30 rounded p-2 hover:bg-neutral-900 cursor-pointer transition-colors"
                  onClick={() => onTaskClick?.(task)}
                >
                  <div className="font-mono text-neutral-300">{task.id}</div>
                  <div className="text-neutral-400">{task.functionName}</div>
                </div>
              ))
            ) : (
              <p className="text-xs text-neutral-500">No tasks scheduled</p>
            )}
          </div>

          {/* Execution drilldown: what actually ran on the selected day. */}
          {(() => {
            const dayExecutions = executionsByDate[formatDateKey(selectedDate)] ?? [];
            if (dayExecutions.length === 0) return null;

            return (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-neutral-300">
                    Executions ({dayExecutions.length})
                  </h4>
                  <button
                    type="button"
                    onClick={() => onDayDrilldown?.(selectedDate, dayExecutions)}
                    className="text-xs px-2 py-1 rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700 transition-colors"
                  >
                    View logs
                  </button>
                </div>
                <ul className="space-y-1" data-testid="calendar-day-executions">
                  {dayExecutions.map((execution) => (
                    <li
                      key={execution.id}
                      className="flex items-center justify-between text-xs bg-neutral-900/50 border border-neutral-700/30 rounded px-2 py-1.5"
                    >
                      <span className="font-mono text-neutral-400">{execution.id}</span>
                      <span
                        className={
                          execution.status === 'failed'
                            ? 'text-red-300'
                            : 'text-emerald-300'
                        }
                      >
                        {execution.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
