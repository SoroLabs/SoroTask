/**
 * Collaborative Sync Engine
 * Handles synchronization between local state and collaborative CRDT
 */

import { CRDTDocumentManager } from './crdtDocumentManager';
import type { Task } from '@/src/types/task';
import type {
  CollaborativeOptions,
  CollaborativeState,
  EditConflict,
  CollaborativeOperation,
} from './types';

/**
 * Queue item for pending updates
 */
interface PendingUpdate {
  id: string;
  taskId: string;
  path: string[];
  value: any;
  timestamp: number;
  retries: number;
  maxRetries: number;
}

/**
 * Handles synchronization of collaborative changes
 */
export class CollaborativeSyncEngine {
  private crdt: CRDTDocumentManager;
  private localTask: Task | null = null;
  private pendingUpdates: Map<string, PendingUpdate> = new Map();
  private syncQueue: PendingUpdate[] = [];
  private isSyncing: boolean = false;
  private lastSyncTime: number = 0;
  private conflictResolutions: Map<string, 'local' | 'remote' | 'merged'> = new Map();
  private errorLog: Array<{ timestamp: number; error: string; context: any }> = [];

  constructor(crdt: CRDTDocumentManager) {
    this.crdt = crdt;
    this.setupListeners();
  }

  /**
   * Initialize with a task
   */
  public initializeTask(task: Task): void {
    this.localTask = task;
    this.syncTaskToCRDT(task);
  }

  /**
   * Sync a task to the CRDT
   */
  private syncTaskToCRDT(task: Task): void {
    const ymap = this.crdt.getYMap();
    ymap.set('id', task.id);
    ymap.set('title', task.title);
    ymap.set('description', task.description);
    ymap.set('createdAt', task.createdAt);
    ymap.set('updatedAt', task.updatedAt);
  }

  /**
   * Setup listeners for CRDT changes
   */
  private setupListeners(): void {
    // Listen for operations
    this.crdt.on('operation', (event) => {
      if (event.data?.userId !== this.crdt.getYDoc().clientID.toString()) {
        this.handleRemoteOperation(event.data as CollaborativeOperation);
      }
    });

    // Listen for sync events
    this.crdt.on('sync', () => {
      this.processSyncQueue();
    });

    // Listen for connection changes
    this.crdt.on('connected', () => {
      this.processSyncQueue();
    });

    // Listen for errors
    this.crdt.on('error', (event) => {
      this.logError('CRDT Error', event.data);
    });
  }

  /**
   * Handle a remote operation
   */
  private handleRemoteOperation(operation: CollaborativeOperation): void {
    if (!this.localTask) return;

    try {
      const remoteValue = this.crdt.getField(operation.path);
      const localValue = this.getLocalField(operation.path);

      // Check for conflicts
      if (remoteValue !== localValue && operation.type !== 'insert') {
        this.createConflict(operation.path, localValue, remoteValue);
      } else {
        // No conflict, apply the change
        this.applyRemoteChange(operation);
      }
    } catch (error) {
      this.logError('Error handling remote operation', {
        operation,
        error,
      });
    }
  }

  /**
   * Create a conflict record
   */
  private createConflict(
    path: string[],
    localValue: any,
    remoteValue: any,
  ): EditConflict {
    const conflictId = `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const conflict: EditConflict = {
      id: conflictId,
      taskId: this.localTask?.id ?? '',
      fieldPath: path,
      localValue,
      remoteValue,
      timestamp: Date.now(),
      resolved: false,
    };

    // Auto-resolve based on strategy
    const resolution = this.crdt.getState().connectionStatus === 'connected'
      ? 'remote' // Remote wins if connected
      : 'local'; // Local wins if disconnected

    this.conflictResolutions.set(conflictId, resolution);
    return conflict;
  }

  /**
   * Apply a remote change locally
   */
  private applyRemoteChange(operation: CollaborativeOperation): void {
    if (!this.localTask) return;

    if (operation.type === 'update' || operation.type === 'insert') {
      this.setLocalField(operation.path, operation.value);
    } else if (operation.type === 'delete') {
      this.deleteLocalField(operation.path);
    }
  }

  /**
   * Get a field from the local task
   */
  private getLocalField(path: string[]): any {
    if (!this.localTask) return undefined;

    let obj: any = this.localTask;
    for (const key of path) {
      obj = obj?.[key];
    }
    return obj;
  }

  /**
   * Set a field in the local task
   */
  private setLocalField(path: string[], value: any): void {
    if (!this.localTask) return;

    let obj: any = this.localTask;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (!obj[key]) {
        obj[key] = {};
      }
      obj = obj[key];
    }
    obj[path[path.length - 1]] = value;
  }

  /**
   * Delete a field from the local task
   */
  private deleteLocalField(path: string[]): void {
    if (!this.localTask) return;

    let obj: any = this.localTask;
    for (let i = 0; i < path.length - 1; i++) {
      obj = obj?.[path[i]];
    }
    if (obj) {
      delete obj[path[path.length - 1]];
    }
  }

  /**
   * Queue an update
   */
  public queueUpdate(path: string[], value: any): PendingUpdate {
    const updateId = `update-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const update: PendingUpdate = {
      id: updateId,
      taskId: this.localTask?.id ?? '',
      path,
      value,
      timestamp: Date.now(),
      retries: 0,
      maxRetries: 3,
    };

    this.pendingUpdates.set(updateId, update);
    this.syncQueue.push(update);

    // Try to sync immediately
    if (!this.isSyncing) {
      this.processSyncQueue();
    }

    return update;
  }

  /**
   * Process the sync queue
   */
  private async processSyncQueue(): Promise<void> {
    if (this.isSyncing || this.syncQueue.length === 0) return;

    this.isSyncing = true;

    try {
      while (this.syncQueue.length > 0) {
        const update = this.syncQueue.shift();
        if (!update) break;

        try {
          // Update CRDT
          this.crdt.updateField(update.path, update.value);

          // Update local task
          this.setLocalField(update.path, update.value);

          // Remove from pending
          this.pendingUpdates.delete(update.id);
          this.lastSyncTime = Date.now();
        } catch (error) {
          update.retries++;
          if (update.retries < update.maxRetries) {
            // Re-queue for retry
            this.syncQueue.push(update);
            this.logError('Sync retry queued', {
              updateId: update.id,
              attempt: update.retries,
            });
          } else {
            this.logError('Update failed after max retries', {
              updateId: update.id,
              update,
              error,
            });
          }
        }
      }
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Get pending updates
   */
  public getPendingUpdates(): PendingUpdate[] {
    return Array.from(this.pendingUpdates.values());
  }

  /**
   * Get the current task
   */
  public getTask(): Task | null {
    return this.localTask;
  }

  /**
   * Get collaborative state
   */
  public getCollaborativeState(): CollaborativeState {
    return this.crdt.getState();
  }

  /**
   * Get operation history
   */
  public getOperationHistory(): CollaborativeOperation[] {
    return this.crdt.getOperationHistory();
  }

  /**
   * Log an error
   */
  private logError(message: string, context: any): void {
    const logEntry = {
      timestamp: Date.now(),
      error: message,
      context,
    };
    this.errorLog.push(logEntry);

    // Keep only last 100 errors
    if (this.errorLog.length > 100) {
      this.errorLog.shift();
    }

    console.error(message, context);
  }

  /**
   * Get error log
   */
  public getErrorLog(): Array<{ timestamp: number; error: string; context: any }> {
    return [...this.errorLog];
  }

  /**
   * Reset error log
   */
  public resetErrorLog(): void {
    this.errorLog = [];
  }

  /**
   * Destroy the sync engine
   */
  public destroy(): void {
    this.crdt.destroy();
  }
}
