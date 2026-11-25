'use client';

import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { wrapSocketWithTracking, trackSocketSubscription } from '@/src/lib/errors/socketTracker';

const KEEPER_URL = process.env.NEXT_PUBLIC_KEEPER_URL ?? "http://localhost:3000";

/** Exponential back-off: 1s → 2s → 4s → … capped at 30 s */
function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000);
}

export type SocketEventMap = {
  'sync:tasks': (tasks: TaskSummary[]) => void;
  'task:updated': (update: TaskUpdate) => void;
  'sync:metrics': (metrics: KeeperMetrics) => void;
  'sync:health': (health: HealthStatus) => void;
};

export interface TaskSummary {
  id: number;
  status: 'registered' | 'active' | 'executing' | 'failed' | 'low_gas' | 'unknown';
  target?: string;
  function?: string;
  interval?: number;
  gas_balance?: number;
  last_run?: number;
  registeredAt?: string;
  lastSuccessAt?: string;
  lastFailedAt?: string;
  lastError?: string;
  updatedAt?: string;
}

export interface TaskUpdate {
  taskId: number;
  status: TaskSummary['status'];
  lastSuccess?: string;
  error?: string;
}

export interface KeeperMetrics {
  tasksCheckedTotal: number;
  tasksDueTotal: number;
  tasksExecutedTotal: number;
  tasksFailedTotal: number;
  avgFeePaidXlm: number;
  lastCycleDurationMs: number;
}

export interface HealthStatus {
  status: 'ok' | 'stale';
  uptime: number;
  lastPollAt: string | null;
  rpcConnected: boolean;
}

interface UseSocketOptions {
  onTasks?: (tasks: TaskSummary[]) => void;
  onTaskUpdated?: (update: TaskUpdate) => void;
  onMetrics?: (metrics: KeeperMetrics) => void;
  onHealth?: (health: HealthStatus) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export function useSocket(options: UseSocketOptions = {}) {
  const socketRef = useRef<Socket | null>(null);
  const attemptsRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const connectRef = useRef<() => Socket>();

  const connect = useCallback(() => {
    const socket = io(KEEPER_URL, {
      transports: ['websocket'],
      reconnection: false, // We manage reconnection manually for back-off control
    });

    // Wrap with error tracking
    wrapSocketWithTracking(socket);

    socket.on('connect', () => {
      attemptsRef.current = 0;
      trackSocketSubscription('connect');
      optionsRef.current.onConnect?.();
    });

    socket.on('disconnect', (reason: string) => {
      trackSocketSubscription('disconnect', { reason });
      optionsRef.current.onDisconnect?.();
    });

    socket.on('connect_error', (error) => {
      trackSocketSubscription('connect_error', {
        message: error instanceof Error ? error.message : String(error),
      });
      const delay = backoff(attemptsRef.current++);
      setTimeout(() => {
        if (socketRef.current && !socketRef.current.connected) {
          socketRef.current.close();
          if (connectRef.current) {
            socketRef.current = connectRef.current();
          }
        }
      }, delay);
    });

    socket.on('sync:tasks', (tasks: TaskSummary[]) => {
      trackSocketSubscription('sync:tasks', { count: tasks.length });
      optionsRef.current.onTasks?.(tasks);
    });

    socket.on('task:updated', (update: TaskUpdate) => {
      trackSocketSubscription('task:updated', { taskId: update.taskId });
      optionsRef.current.onTaskUpdated?.(update);
    });

    socket.on('sync:metrics', (metrics: KeeperMetrics) => {
      trackSocketSubscription('sync:metrics');
      optionsRef.current.onMetrics?.(metrics);
    });

    socket.on('sync:health', (health: HealthStatus) => {
      trackSocketSubscription('sync:health');
      optionsRef.current.onHealth?.(health);
    });

    return socket;
  }, []);

  connectRef.current = connect;

  useEffect(() => {
    socketRef.current = connect();
    return () => {
      socketRef.current?.close();
    };
  }, [connect]);

  return socketRef;
}
