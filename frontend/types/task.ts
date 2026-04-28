/**
 * Task type definition with deadline and scheduling support
 */

export interface Task {
  id: string;
  contractAddress: string;
  functionName: string;
  interval: number; // in seconds
  gasBalance: number; // in XLM
  createdAt: Date;
  deadline?: Date; // Optional task deadline
  nextExecutionTime?: Date; // When the task is scheduled to run next
  status: TaskStatus;
  description?: string;
  timezone?: string; // IANA timezone (e.g., 'America/New_York')
  tags?: string[];
}

export type TaskStatus = 'pending' | 'active' | 'completed' | 'failed' | 'paused';

export interface TaskExecution {
  id: string;
  taskId: string;
  executedAt: Date;
  status: ExecutionStatus;
  gasUsed?: number;
  blockHash?: string;
  error?: string;
}

export type ExecutionStatus = 'success' | 'failed' | 'pending';

/**
 * Grouped tasks by date for calendar display
 */
export interface TasksByDate {
  [dateKey: string]: Task[]; // dateKey: 'YYYY-MM-DD'
}

/**
 * Calendar view configuration
 */
export interface CalendarConfig {
  locale?: string; // BCP 47 language tag
  timezone?: string; // IANA timezone
  showWeekends?: boolean;
  compactMode?: boolean;
}
