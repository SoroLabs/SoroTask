/**
 * Task Execution Streaming Types
 * 
 * Defines the types for real-time task execution tracking, including
 * execution status, logs, and performance metrics.
 */

export type ExecutionStatus = 
  | 'pending'
  | 'preparing'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'trace';

/**
 * Represents a single log entry during task execution
 */
export interface ExecutionLogEntry {
  id: string;
  taskId: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Represents the overall execution state of a task
 */
export interface TaskExecutionState {
  taskId: string;
  status: ExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  logs: ExecutionLogEntry[];
  currentPhase?: string;
  progress?: {
    current: number;
    total: number;
  };
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
  gasUsed?: number;
  gasEstimated?: number;
  transactionId?: string;
}

/**
 * Real-time update event from the execution stream
 */
export interface TaskExecutionEvent {
  id: string;
  type: 'status_change' | 'log_entry' | 'progress_update' | 'error' | 'completed';
  taskId: string;
  timestamp: string;
  payload: 
    | StatusChangePayload
    | LogEntryPayload
    | ProgressUpdatePayload
    | ErrorPayload
    | CompletionPayload;
}

export interface StatusChangePayload {
  oldStatus: ExecutionStatus;
  newStatus: ExecutionStatus;
  phase?: string;
}

export interface LogEntryPayload extends ExecutionLogEntry {}

export interface ProgressUpdatePayload {
  current: number;
  total: number;
  percentage?: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
  stack?: string;
}

export interface CompletionPayload {
  status: 'success' | 'failed';
  gasUsed: number;
  transactionId?: string;
  error?: {
    code: string;
    message: string;
  };
}

// ── Execution Trace Types (for debugging interface) ────────────────────────────

/**
 * Maps to events::ExecutionStep in the Soroban contract.
 */
export enum ExecutionStepType {
  ValidateAuth = 1,
  LoadTask = 2,
  CheckActive = 3,
  CheckWhitelist = 4,
  CheckInterval = 5,
  CheckDependencies = 6,
  EvaluateResolver = 7,
  CheckVrfCondition = 8,
  CheckZkCondition = 9,
  CalculateFee = 10,
  CheckBalance = 11,
  ExecuteYield = 12,
  CallTarget = 13,
  PayKeeper = 14,
  UpdateState = 15,
}

export const EXECUTION_STEP_LABELS: Record<ExecutionStepType, string> = {
  [ExecutionStepType.ValidateAuth]: 'Validate Authorization',
  [ExecutionStepType.LoadTask]: 'Load Task Configuration',
  [ExecutionStepType.CheckActive]: 'Check Task Active',
  [ExecutionStepType.CheckWhitelist]: 'Check Keeper Whitelist',
  [ExecutionStepType.CheckInterval]: 'Check Execution Interval',
  [ExecutionStepType.CheckDependencies]: 'Check Dependencies',
  [ExecutionStepType.EvaluateResolver]: 'Evaluate Resolver Condition',
  [ExecutionStepType.CheckVrfCondition]: 'Check VRF Condition',
  [ExecutionStepType.CheckZkCondition]: 'Check ZK Condition',
  [ExecutionStepType.CalculateFee]: 'Calculate Execution Fee',
  [ExecutionStepType.CheckBalance]: 'Check Gas Balance',
  [ExecutionStepType.ExecuteYield]: 'Execute Yield Strategy',
  [ExecutionStepType.CallTarget]: 'Call Target Contract',
  [ExecutionStepType.PayKeeper]: 'Pay Keeper Fee',
  [ExecutionStepType.UpdateState]: 'Update Task State',
};

export const EXECUTION_STEP_ICONS: Record<ExecutionStepType, string> = {
  [ExecutionStepType.ValidateAuth]: '🔑',
  [ExecutionStepType.LoadTask]: '📋',
  [ExecutionStepType.CheckActive]: '✅',
  [ExecutionStepType.CheckWhitelist]: '📜',
  [ExecutionStepType.CheckInterval]: '⏱️',
  [ExecutionStepType.CheckDependencies]: '🔗',
  [ExecutionStepType.EvaluateResolver]: '🔍',
  [ExecutionStepType.CheckVrfCondition]: '🎲',
  [ExecutionStepType.CheckZkCondition]: '🛡️',
  [ExecutionStepType.CalculateFee]: '💰',
  [ExecutionStepType.CheckBalance]: '🏦',
  [ExecutionStepType.ExecuteYield]: '🌾',
  [ExecutionStepType.CallTarget]: '🎯',
  [ExecutionStepType.PayKeeper]: '💸',
  [ExecutionStepType.UpdateState]: '💾',
};

export type StepResultType = 'Passed' | 'Failed' | 'Skipped';

export interface ExecutionStepRecord {
  step: ExecutionStepType;
  result: StepResultType;
  detail: number;
}

export interface ExecutionTrace {
  task_id: string;
  keeper: string;
  timestamp: string;
  steps: ExecutionStepRecord[];
  final_outcome: 'Success' | 'Failed' | 'Skipped' | 'NeverRun';
}

export function getStepResultColor(result: StepResultType): string {
  switch (result) {
    case 'Passed':
      return 'bg-green-500';
    case 'Failed':
      return 'bg-red-500';
    case 'Skipped':
      return 'bg-gray-500';
  }
}

export function getStepResultTextColor(result: StepResultType): string {
  switch (result) {
    case 'Passed':
      return 'text-green-400';
    case 'Failed':
      return 'text-red-400';
    case 'Skipped':
      return 'text-gray-400';
  }
}

export function getStepResultBgColor(result: StepResultType): string {
  switch (result) {
    case 'Passed':
      return 'bg-green-900/20 border-green-800';
    case 'Failed':
      return 'bg-red-900/20 border-red-800';
    case 'Skipped':
      return 'bg-gray-900/20 border-gray-800';
  }
}

export function getOutcomeColor(outcome: string): string {
  switch (outcome) {
    case 'Success':
      return 'text-green-400';
    case 'Failed':
      return 'text-red-400';
    case 'Skipped':
      return 'text-gray-400';
    default:
      return 'text-neutral-400';
  }
}

export function getOutcomeBgColor(outcome: string): string {
  switch (outcome) {
    case 'Success':
      return 'bg-green-600';
    case 'Failed':
      return 'bg-red-600';
    case 'Skipped':
      return 'bg-gray-600';
    default:
      return 'bg-neutral-600';
  }
}

export function getErrorDetailMessage(step: ExecutionStepType, detail: number): string | null {
  const errorMap: Partial<Record<ExecutionStepType, Record<number, string>>> = {
    [ExecutionStepType.LoadTask]: {
      36: 'Task not found',
    },
    [ExecutionStepType.CheckActive]: {
      5: 'Task is paused',
    },
    [ExecutionStepType.CheckWhitelist]: {
      2: 'Keeper not authorized',
    },
    [ExecutionStepType.CheckDependencies]: {
      11: 'Task blocked by dependency',
    },
    [ExecutionStepType.CheckBalance]: {
      3: 'Insufficient gas balance',
    },
    [ExecutionStepType.ExecuteYield]: {
      26: 'Yield harvest failed',
    },
  };
  return errorMap[step]?.[detail] ?? null;
}

/**
 * Connection state for the execution stream
 */
export type StreamConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Options for subscribing to task execution events
 */
export interface SubscriptionOptions {
  taskId: string;
  startFrom?: 'beginning' | 'latest' | Date;
  maxLogBufferSize?: number;
  reconnectOnError?: boolean;
}
