/**
 * Task Execution Stream Client
 * 
 * Manages WebSocket connections to the keeper's StreamHub for real-time
 * task execution updates. Handles reconnection, buffering, and error recovery.
 */

import { io, Socket } from 'socket.io-client';
import { EventEmitter } from 'eventemitter3';
import {
  TaskExecutionEvent,
  TaskExecutionState,
  ExecutionStatus,
  ExecutionLogEntry,
  StreamConnectionState,
  SubscriptionOptions,
} from '../types/taskExecution';
import { createLogger } from '@/src/lib/logger';

// Toast notification import
let toastFn: ((msg: string, type?: string) => void) | null = null;
export function setToastHandler(fn: (msg: string, type?: string) => void) {
  toastFn = fn;
}

function playNotificationSound() {
  if (typeof window === 'undefined') return;
  try {
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1sbGtdaGBqfYSEh4GAdnN0b3h8hYSBfXl1c3N1eYSFhn+AgIB7e3t7e4ODg4KCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKC');
    audio.volume = 0.3;
    audio.play().catch(() => {});
  } catch {}
}

function showToast(msg: string) {
  if (toastFn) toastFn(msg, 'success');
  playNotificationSound();
}

const KEEPER_URL = process.env.NEXT_PUBLIC_KEEPER_URL ?? 'http://localhost:3000';
const STREAM_NAMESPACE = '/stream';

const logger = createLogger('task-execution-stream');

interface InternalStreamState {
  events: TaskExecutionEvent[];
  lastEventId?: string;
  maxBufferSize: number;
}

/**
 * Client for managing task execution streaming from the keeper
 */
export class TaskExecutionStreamClient extends EventEmitter {
  private socket: Socket | null = null;
  private connectionState: StreamConnectionState = 'disconnected';
  private taskStreams: Map<string, InternalStreamState> = new Map();
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // ms

  constructor() {
    super();
  }

  /**
   * Connects to the keeper's stream namespace
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve();
        return;
      }

      this.setConnectionState('connecting');

      try {
        this.socket = io(`${KEEPER_URL}${STREAM_NAMESPACE}`, {
          transports: ['websocket'],
          reconnection: true,
          reconnectionDelay: this.reconnectDelay,
          reconnectionDelayMax: 5000,
          reconnectionAttempts: this.maxReconnectAttempts,
        });

        this.setupSocketListeners();

        this.socket?.on('connect', () => {
          this.reconnectAttempts = 0;
          this.setConnectionState('connected');
          logger.info('Connected to task execution stream', {
            socketId: this.socket?.id,
          });
          resolve();
        });

        this.socket.on('connect_error', (error) => {
          logger.warn('Connection error', { error: error.message });
          this.setConnectionState('error');
          reject(error);
        });

        this.socket.on('error', (error) => {
          logger.error('Socket error', { error });
          this.setConnectionState('error');
        });
      } catch (error) {
        logger.error('Failed to initialize socket', { error });
        this.setConnectionState('error');
        reject(error);
      }
    });
  }

  /**
   * Disconnects from the stream
   */
  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve();
        return;
      }

      this.socket.disconnect();
      this.taskStreams.clear();
      this.setConnectionState('disconnected');
      logger.info('Disconnected from task execution stream');
      resolve();
    });
  }

  /**
   * Subscribes to execution events for a specific task
   */
  subscribe(options: SubscriptionOptions): void {
    const { taskId, maxLogBufferSize = 1000 } = options;

    if (!this.socket?.connected) {
      throw new Error('Stream client is not connected');
    }

    // Initialize or update task stream state
    if (!this.taskStreams.has(taskId)) {
      this.taskStreams.set(taskId, {
        events: [],
        maxBufferSize: maxLogBufferSize,
      });
    }

    // Emit subscription event to keeper
    this.socket.emit('task:subscribe', {
      taskId,
      startFrom: options.startFrom || 'latest',
    });

    logger.info('Subscribed to task execution', { taskId });
  }

  /**
   * Unsubscribes from execution events for a task
   */
  unsubscribe(taskId: string): void {
    if (!this.socket?.connected) {
      return;
    }

    this.socket.emit('task:unsubscribe', { taskId });
    this.taskStreams.delete(taskId);
    logger.info('Unsubscribed from task execution', { taskId });
  }

  /**
   * Gets the current execution state for a task
   */
  getTaskExecutionState(taskId: string): TaskExecutionState | null {
    const stream = this.taskStreams.get(taskId);
    if (!stream) return null;

    // Reconstruct state from events
    const state: TaskExecutionState = {
      taskId,
      status: 'pending',
      logs: [],
    };

    for (const event of stream.events) {
      switch (event.type) {
        case 'status_change': {
          const payload = event.payload as any;
          state.status = payload.newStatus;
          state.currentPhase = payload.phase;
          break;
        }
        case 'log_entry': {
          const logEntry = event.payload as ExecutionLogEntry;
          state.logs.push(logEntry);
          break;
        }
        case 'progress_update': {
          const payload = event.payload as any;
          state.progress = {
            current: payload.current,
            total: payload.total,
          };
          break;
        }
        case 'error': {
          const payload = event.payload as any;
          state.error = {
            code: payload.code,
            message: payload.message,
            stack: payload.stack,
          };
          break;
        }
        case 'completed': {
          const payload = event.payload as any;
          state.status = payload.status === 'success' ? 'completed' : 'failed';
          state.completedAt = event.timestamp;
          state.gasUsed = payload.gasUsed;
          state.transactionId = payload.transactionId;
          if (payload.error) {
            state.error = payload.error;
          }
          break;
        }
      }
    }

    return state;
  }

  /**
   * Gets recent logs for a task
   */
  getTaskLogs(taskId: string, limit?: number): ExecutionLogEntry[] {
    const stream = this.taskStreams.get(taskId);
    if (!stream) return [];

    const logs = stream.events
      .filter((e) => e.type === 'log_entry')
      .map((e) => e.payload as ExecutionLogEntry);

    if (limit) {
      return logs.slice(-limit);
    }
    return logs;
  }

  /**
   * Gets the current connection state
   */
  getConnectionState(): StreamConnectionState {
    return this.connectionState;
  }

  /**
   * Private methods
   */

  private setConnectionState(state: StreamConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.emit('connectionStateChange', state);
    }
  }

  // Subscribe by user address for multi-user notifications
  subscribeByAddress(address: string): void {
    if (!this.socket?.connected) {
      throw new Error('Stream client is not connected');
    }
    this.socket.emit('address:subscribe', { address });
    logger.info('Subscribed to address events', { address });
  }

  // Update TanStack Query cache (external hook can register callback)
  private queryCacheUpdateFn: ((taskId: string, data: Partial<TaskExecutionState>) => void) | null = null;
  
  static setQueryCacheUpdater(fn: (taskId: string, data: Partial<TaskExecutionState>) => void) {
    TaskExecutionStreamClient.prototype.queryCacheUpdateFn = fn;
  }

  private updateQueryCache(taskId: string, data: Partial<TaskExecutionState>) {
    if (this.queryCacheUpdateFn) {
      this.queryCacheUpdateFn(taskId, data);
    }
  }

  private setupSocketListeners(): void {
    if (!this.socket) return;

    // Listen for execution events
    this.socket.on('task:execution:event', (event: TaskExecutionEvent) => {
      this.handleExecutionEvent(event);
    });

    // Listen for task-specific events
    this.socket.on('task:execution:status', (data: any) => {
      const event: TaskExecutionEvent = {
        id: data.id || `status-${Date.now()}`,
        type: 'status_change',
        taskId: data.taskId,
        timestamp: data.timestamp || new Date().toISOString(),
        payload: {
          oldStatus: data.oldStatus || 'pending',
          newStatus: data.newStatus,
          phase: data.phase,
        },
      };
      this.handleExecutionEvent(event);
    });

    this.socket.on('task:execution:log', (data: any) => {
      const event: TaskExecutionEvent = {
        id: data.id || `log-${Date.now()}`,
        type: 'log_entry',
        taskId: data.taskId,
        timestamp: data.timestamp || new Date().toISOString(),
        payload: {
          id: data.id || `log-${Date.now()}`,
          taskId: data.taskId,
          timestamp: data.timestamp || new Date().toISOString(),
          level: data.level || 'info',
          message: data.message,
          context: data.context,
        },
      };
      this.handleExecutionEvent(event);
    });

    this.socket.on('disconnect', () => {
      this.setConnectionState('disconnected');
      logger.info('Stream disconnected');
    });

    // Task completed notification
    this.socket.on('task:execution:completed', (data: any) => {
      const taskId = data.taskId;
      showToast(`Task ${taskId} executed successfully!`);
      this.updateQueryCache(taskId, { status: 'completed', completedAt: new Date().toISOString() });
    });

    // Task failed notification
    this.socket.on('task:execution:failed', (data: any) => {
      const taskId = data.taskId;
      showToast(`Task ${taskId} execution failed: ${data.error || 'Unknown error'}`);
      this.updateQueryCache(taskId, { status: 'failed', error: { code: 'EXECUTION_FAILED', message: data.error } });
    });
  }

  private handleExecutionEvent(event: TaskExecutionEvent): void {
    // Auto-subscribe if not already tracking
    if (!this.taskStreams.has(event.taskId)) {
      this.taskStreams.set(event.taskId, { events: [], maxBufferSize: 1000 });
    }

    const stream = this.taskStreams.get(event.taskId);
    if (!stream) return;

    // Buffer the event
    stream.events.push(event);

    // Maintain buffer size limit
    if (stream.events.length > stream.maxBufferSize) {
      stream.events = stream.events.slice(-stream.maxBufferSize);
    }

    // Emit event to listeners
    this.emit('event', event);
    this.emit(`task:${event.taskId}`, event);

    // Update query cache on status change
    if (event.type === 'completed') {
      this.updateQueryCache(event.taskId, { status: 'completed' });
    } else if (event.type === 'status_change') {
      const payload = event.payload as any;
      this.updateQueryCache(event.taskId, { status: payload.newStatus });
    }

    logger.debug('Processed execution event', {
      taskId: event.taskId,
      type: event.type,
    });
  }
}

/**
 * Singleton instance of the stream client
 */
let instance: TaskExecutionStreamClient | null = null;

/**
 * Gets or creates the singleton stream client
 */
export function getStreamClient(): TaskExecutionStreamClient {
  if (!instance) {
    instance = new TaskExecutionStreamClient();
  }
  return instance;
}

/**
 * Resets the singleton (useful for testing)
 */
export function resetStreamClient(): void {
  instance = null;
}
