'use client';

import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const KEEPER_URL = process.env.NEXT_PUBLIC_KEEPER_URL ?? 'http://localhost:3000';

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

  const connect = useCallback(() => {
    const socket = io(KEEPER_URL, {
      transports: ['websocket'],
      reconnection: false, // We manage reconnection manually for back-off control
    });

    socket.on('connect', () => {
      attemptsRef.current = 0;
      optionsRef.current.onConnect?.();
    });

    socket.on('disconnect', () => {
      optionsRef.current.onDisconnect?.();
    });

    socket.on('connect_error', () => {
      const delay = backoff(attemptsRef.current++);
      setTimeout(() => {
        if (socketRef.current && !socketRef.current.connected) {
          socketRef.current.close();
          socketRef.current = connect();
        }
      }, delay);
    });

    socket.on('sync:tasks', (tasks: TaskSummary[]) => {
      optionsRef.current.onTasks?.(tasks);
    });

    socket.on('task:updated', (update: TaskUpdate) => {
      optionsRef.current.onTaskUpdated?.(update);
    });

    socket.on('sync:metrics', (metrics: KeeperMetrics) => {
      optionsRef.current.onMetrics?.(metrics);
    });

    socket.on('sync:health', (health: HealthStatus) => {
      optionsRef.current.onHealth?.(health);
    });

    return socket;
  }, []);

  useEffect(() => {
    socketRef.current = connect();
    return () => {
      socketRef.current?.close();
    };
  }, [connect]);

  return socketRef;
}
