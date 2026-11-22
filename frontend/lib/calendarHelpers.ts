/*
 * Calendar formatting & display utilities
 * Common helpers for consistent calendar rendering
 */

import { Task } from '@/types/task';
import { formatDateKey } from './dateUtils';

/**
 * Group tasks by deadline
 */
export function groupTasksByDeadline(tasks: Task[]): Record<string, Task[]> {
  const grouped: Record<string, Task[]> = {};

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
}

/**
 * Sort tasks within a date group
 */
export function sortTasksByStatus(tasks: Task[]): Task[] {
  const statusOrder: Record<string, number> = {
    active: 0,
    completed: 1,
    pending: 2,
    paused: 3,
    failed: 4,
  };

  return [...tasks].sort(
    (a, b) =>
      (statusOrder[a.status] || 999) - (statusOrder[b.status] || 999)
  );
}

/**
 * Filter tasks by status
 */
export function filterTasksByStatus(
  tasks: Task[],
  status: Task['status']
): Task[] {
  return tasks.filter((task) => task.status === status);
}

/**
 * Find tasks due soon (within N days)
 */
export function findTasksDueSoon(tasks: Task[], days: number): Task[] {
  const now = new Date();
  const deadline = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  return tasks.filter((task) => {
    if (!task.deadline) return false;
    const taskDeadline = new Date(task.deadline);
    return taskDeadline >= now && taskDeadline <= deadline;
  });
}

/**
 * Find overdue tasks
 */
export function findOverdueTasks(tasks: Task[]): Task[] {
  const now = new Date();
  return tasks.filter((task) => {
    if (!task.deadline) return false;
    const taskDeadline = new Date(task.deadline);
    taskDeadline.setHours(23, 59, 59, 999); // End of day
    return taskDeadline < now;
  });
}

/**
 * Calculate task workload for a date
 * Returns count and difficulty score
 */
export function calculateDateWorkload(
  tasks: Task[]
): { count: number; difficulty: 'low' | 'medium' | 'high' } {
  const count = tasks.length;

  let difficulty: 'low' | 'medium' | 'high' = 'low';
  if (count >= 3) difficulty = 'high';
  else if (count >= 2) difficulty = 'medium';

  return { count, difficulty };
}

/**
 * Get color for task status
 */
export function getTaskStatusColor(status: Task['status']): string {
  switch (status) {
    case 'completed':
      return 'text-green-400';
    case 'active':
      return 'text-blue-400';
    case 'pending':
      return 'text-yellow-400';
    case 'paused':
      return 'text-orange-400';
    case 'failed':
      return 'text-red-400';
    default:
      return 'text-neutral-400';
  }
}

/**
 * Get badge color for task status
 */
export function getTaskStatusBadgeColor(status: Task['status']): string {
  switch (status) {
    case 'completed':
      return 'bg-green-500/10 text-green-400 border-green-500/20';
    case 'active':
      return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    case 'pending':
      return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
    case 'paused':
      return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
    case 'failed':
      return 'bg-red-500/10 text-red-400 border-red-500/20';
    default:
      return 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20';
  }
}

/**
 * Format task display label (truncate if too long)
 */
export function formatTaskLabel(
  task: Task,
  maxLength: number = 20
): string {
  const label = task.functionName;
  return label.length > maxLength
    ? label.substring(0, maxLength - 1) + '…'
    : label;
}

/**
 * Get accessibility label for a date cell
 */
export function getDateCellLabel(
  date: Date,
  tasks: Task[],
  locale: string = 'en-US'
): string {
  const dateStr = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);

  if (tasks.length === 0) {
    return `${dateStr}, no tasks`;
  }

  const taskNames = tasks.slice(0, 2).map((t) => t.functionName);
  const moreCount = tasks.length - 2;

  if (moreCount > 0) {
    return `${dateStr}, ${taskNames.join(', ')}, and ${moreCount} more`;
  }

  return `${dateStr}, ${taskNames.join(', ')}`;
}

/**
 * Parse a natural language recurrence phrase into a 5-part cron expression.
 * Supports common presets like "every monday at 9:00 am", "every 15 minutes",
 * "daily at midnight", "every day at 14:30", "every hour", etc.
 * Returns null when the phrase cannot be understood.
 */
export function naturalLanguageToCron(input: string): string | null {
  if (!input) return null;
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return null;

  const dayNames: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  const parseTime = (str: string): { hour: number; minute: number } | null => {
    const match = str.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (!match) return null;
    let hour = parseInt(match[1], 10);
    const minute = match[2] ? parseInt(match[2], 10) : 0;
    const meridiem = match[3];
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour, minute };
  };

  // Every minute
  if (/^every minute$/.test(text)) return '* * * * *';

  // Every N minutes
  const everyMinutes = text.match(/every (\d{1,2}) minutes?/);
  if (everyMinutes) {
    const n = parseInt(everyMinutes[1], 10);
    if (n >= 1 && n <= 59) return `*/${n} * * * *`;
    return null;
  }

  // Every N hours
  const everyHours = text.match(/every (\d{1,2}) hours?/);
  if (everyHours) {
    const n = parseInt(everyHours[1], 10);
    if (n >= 1 && n <= 23) return `0 */${n} * * *`;
    return null;
  }

  // Every hour
  if (/^every hour$/.test(text)) return '0 * * * *';

  // Time extraction (default midnight)
  const timeMatch = text.match(/(?:at|@)\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/);
  const time = timeMatch ? parseTime(timeMatch[1]) : { hour: 0, minute: 0 };
  if (!time) return null;

  // Every <weekday>
  const weekdayMatch = text.match(/every (sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
  if (weekdayMatch) {
    const dow = dayNames[weekdayMatch[1]];
    return `${time.minute} ${time.hour} * * ${dow}`;
  }

  // Every day / daily
  if (/^(every day|daily)\b/.test(text)) {
    return `${time.minute} ${time.hour} * * *`;
  }

  // Every month on the Nth
  const monthlyMatch = text.match(/every month on the (\d{1,2})(?:st|nd|rd|th)?/);
  if (monthlyMatch) {
    const dom = parseInt(monthlyMatch[1], 10);
    if (dom >= 1 && dom <= 31) return `${time.minute} ${time.hour} ${dom} * *`;
    return null;
  }

  return null;
}

/**
 * Compute the next N execution dates for a 5-part cron expression.
 * Returns an empty array for invalid expressions.
 */
export function getNextCronExecutions(
  cron: string,
  count: number = 10,
  from: Date = new Date()
): Date[] {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return [];

  const parseField = (field: string, min: number, max: number): number[] | null => {
    const values = new Set<number>();
    for (const segment of field.split(',')) {
      const stepMatch = segment.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/);
      if (stepMatch) {
        const step = parseInt(stepMatch[2], 10);
        if (step <= 0) return null;
        let start = min;
        let end = max;
        if (stepMatch[1] !== '*') {
          const range = stepMatch[1].split('-').map((v) => parseInt(v, 10));
          start = range[0];
          end = range.length > 1 ? range[1] : max;
        }
        for (let v = start; v <= end; v += step) {
          if (v >= min && v <= max) values.add(v);
        }
        continue;
      }
      if (segment === '*') {
        for (let v = min; v <= max; v++) values.add(v);
        continue;
      }
      const rangeMatch = segment.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (start < min || end > max || start > end) return null;
        for (let v = start; v <= end; v++) values.add(v);
        continue;
      }
      const single = parseInt(segment, 10);
      if (isNaN(single) || single < min || single > max) return null;
      values.add(single);
    }
    return Array.from(values).sort((a, b) => a - b);
  };

  const minutes = parseField(parts[0], 0, 59);
  const hours = parseField(parts[1], 0, 23);
  const daysOfMonth = parseField(parts[2], 1, 31);
  const months = parseField(parts[3], 1, 12);
  const daysOfWeek = parseField(parts[4], 0, 6);

  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return [];

  const results: Date[] = [];
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const maxIterations = 60 * 24 * 366 * 5; // safety bound (~5 years of minutes)
  let iterations = 0;

  while (results.length < count && iterations < maxIterations) {
    iterations++;
    if (
      minutes.includes(cursor.getMinutes()) &&
      hours.includes(cursor.getHours()) &&
      daysOfMonth.includes(cursor.getDate()) &&
      months.includes(cursor.getMonth() + 1) &&
      daysOfWeek.includes(cursor.getDay())
    ) {
      results.push(new Date(cursor.getTime()));
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return results;
}

/**
 * Format a cron expression into a human-readable description.
 */
export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return 'Invalid cron expression';
  const [minute, hour, dom, month, dow] = parts;

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const timeLabel = (() => {
    if (minute === '*' && hour === '*') return 'every minute';
    if (minute.startsWith('*/')) return `every ${minute.slice(2)} minutes`;
    if (hour === '*' && /^\d+$/.test(minute)) return `every hour at minute ${minute}`;
    if (hour.startsWith('*/')) return `every ${hour.slice(2)} hours`;
    if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
      const h = parseInt(hour, 10);
      const m = parseInt(minute, 10);
      const suffix = h >= 12 ? 'PM' : 'AM';
      const displayHour = h % 12 === 0 ? 12 : h % 12;
      return `at ${displayHour}:${m.toString().padStart(2, '0')} ${suffix}`;
    }
    return `at minute ${minute} of hour ${hour}`;
  })();

  if (dow !== '*') {
    const days = dow
      .split(',')
      .map((d) => dayNames[parseInt(d, 10)] || d)
      .join(', ');
    return `Every ${days} ${timeLabel}`;
  }
  if (dom !== '*') {
    return `Every month on day ${dom} ${timeLabel}`;
  }
  if (month !== '*') {
    return `Every year in month ${month} ${timeLabel}`;
  }
  return `Every day ${timeLabel}`;
}

/**
 * Export tasks as CSV
 */
export function exportTasksAsCSV(
  tasks: Task[],
  filename: string = 'tasks.csv'
): void {
  const headers = [
    'ID',
    'Function',
    'Contract',
    'Interval (h)',
    'Gas Balance',
    'Status',
    'Deadline',
  ];

  const rows = tasks.map((task) => [
    task.id,
    task.functionName,
    task.contractAddress,
    (task.interval / 3600).toFixed(1),
    task.gasBalance.toString(),
    task.status,
    task.deadline ? task.deadline.toISOString().split('T')[0] : '-',
  ]);

  const csv = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}
