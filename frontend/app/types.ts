export interface Task {
  id: string;
  contractAddress: string;
  functionName: string;
  interval: number;
  gasBalance: number;
  createdAt: Date;
  totalTime: number; // in seconds
  timeEntries: TimeEntry[];
  history?: HistoryEvent[];
}

export interface TimeEntry {
  id: string;
  taskId: string;
  startTime: Date;
  endTime?: Date;
  duration: number; // in seconds
  isManual: boolean;
  description?: string;
}

export interface HistoryEvent {
  id: string;
  taskId: string;
  timestamp: Date;
  actor: string; // user ID or "System"
  actorName: string; // display name
  eventType: HistoryEventType;
  changes: FieldChange[];
  description?: string;
}

export type HistoryEventType =
  | 'created'
  | 'field_changed'
  | 'time_logged'
  | 'comment_added'
  | 'status_changed'
  | 'assigned'
  | 'unassigned';

export interface FieldChange {
  field: string;
  oldValue: any;
  newValue: any;
  fieldType: 'text' | 'number' | 'boolean' | 'date' | 'reference';
}

export interface ActiveTimer {
  taskId: string;
  startTime: Date;
  pausedAt?: Date;
  isPaused: boolean;
}