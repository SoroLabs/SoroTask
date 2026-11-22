/**
 * Types for collaborative real-time editing using CRDT (Conflict-free Replicated Data Type)
 */

/**
 * Represents a user editing a task in real-time
 */
export interface CollaborativeUser {
  clientId: string;
  userId: string;
  userName: string;
  avatarUrl?: string;
  color: string;
  cursor?: {
    line: number;
    column: number;
  };
  lastActive: number; // timestamp
}

/**
 * Represents the state of collaborative editing for a task
 */
export interface CollaborativeState {
  taskId: string;
  isCollaborative: boolean;
  activeUsers: CollaborativeUser[];
  conflictCount: number;
  lastSyncTime: number;
  connectionStatus: 'connected' | 'disconnected' | 'syncing';
  errorMessage?: string;
}

/**
 * Operation representing a change in the collaborative document
 */
export interface CollaborativeOperation {
  id: string;
  userId: string;
  timestamp: number;
  type: 'insert' | 'delete' | 'update';
  path: string[]; // e.g., ['fields', 'title'] or ['description', 'content', 0]
  value?: any;
  oldValue?: any;
  resolved: boolean;
}

/**
 * Conflict information when concurrent edits occur
 */
export interface EditConflict {
  id: string;
  taskId: string;
  fieldPath: string[];
  localValue: any;
  remoteValue: any;
  timestamp: number;
  resolved: boolean;
  resolution?: 'local' | 'remote' | 'merged';
}

/**
 * Options for initializing collaborative editing
 */
export interface CollaborativeOptions {
  taskId: string;
  userId: string;
  userName: string;
  /** Shown on this user's presence avatar to peers (Issue #1255). */
  avatarUrl?: string;
  serverUrl: string;
  autoConnect?: boolean;
  conflictResolutionStrategy?: 'last-write-wins' | 'crdt' | 'manual';
  enablePersistence?: boolean;
  enableAwareness?: boolean;
  reconnectTimeout?: number;
  maxRetries?: number;
}

/**
 * Event types for collaborative editing
 */
export type CollaborativeEventType =
  | 'connected'
  | 'disconnected'
  | 'sync'
  | 'conflict'
  | 'userJoined'
  | 'userLeft'
  | 'error'
  | 'operation';

/**
 * Event emitted during collaborative editing
 */
export interface CollaborativeEvent {
  type: CollaborativeEventType;
  timestamp: number;
  data?: any;
}
