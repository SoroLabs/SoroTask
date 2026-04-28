/**
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
  const statusOrder = {
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
