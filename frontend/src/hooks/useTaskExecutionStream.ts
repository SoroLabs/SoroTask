'use client';

/**
 * useTaskExecutionStream Hook
 * 
 * Manages subscription to real-time task execution events. Automatically
 * connects to the stream and keeps the execution store in sync.
 */

import { useEffect, useCallback } from 'react';
import {
  getStreamClient,
  TaskExecutionStreamClient,
} from '@/src/lib/taskExecutionStreamClient';
import { useExecutionStore } from '@/src/store/taskExecutionStore';
import {
  TaskExecutionEvent,
  SubscriptionOptions,
  StreamConnectionState,
} from '@/src/types/taskExecution';
import { createLogger } from '@/src/lib/logger';

const logger = createLogger('useTaskExecutionStream');

export interface UseTaskExecutionStreamOptions extends Omit<SubscriptionOptions, 'taskId'> {
  enabled?: boolean;
  onConnectionStateChange?: (state: StreamConnectionState) => void;
  onEvent?: (event: TaskExecutionEvent) => void;
  onError?: (error: Error) => void;
}

/**
 * Hook to subscribe to real-time task execution events
 * 
 * @param taskId - The ID of the task to stream
 * @param options - Configuration options
 * @returns Object containing execution state and connection status
 */
export function useTaskExecutionStream(
  taskId: string,
  options: UseTaskExecutionStreamOptions = {},
) {
  const {
    enabled = true,
    startFrom = 'latest',
    maxLogBufferSize = 1000,
    onConnectionStateChange,
    onEvent,
    onError,
  } = options;

  const {
    executions,
    streamConnected,
    setStreamConnected,
    initializeExecution,
    updateExecutionStatus,
    addExecutionLog,
    updateProgress,
    setExecutionError,
    completeExecution,
    getExecutionState,
    getLogs,
  } = useExecutionStore();

  // Initialize stream client and set up event listeners
  useEffect(() => {
    if (!enabled || !taskId) {
      return;
    }

    let client: TaskExecutionStreamClient | null = null;

    const setupStream = async () => {
      try {
        client = getStreamClient();

        // Initialize execution state
        initializeExecution(taskId);

        // Set up connection state listener
        const handleConnectionStateChange = (state: StreamConnectionState) => {
          setStreamConnected(state === 'connected');
          onConnectionStateChange?.(state);
          logger.info('Stream connection state changed', { state });
        };

        client.on('connectionStateChange', handleConnectionStateChange);

        // Set up event listener
        const handleEvent = (event: TaskExecutionEvent) => {
          onEvent?.(event);

          // Update store based on event type
          switch (event.type) {
            case 'status_change': {
              const payload = event.payload as any;
              updateExecutionStatus(taskId, payload.newStatus);
              break;
            }
            case 'log_entry': {
              const payload = event.payload as any;
              addExecutionLog(taskId, {
                id: payload.id,
                taskId,
                timestamp: payload.timestamp,
                level: payload.level,
                message: payload.message,
                context: payload.context,
              });
              break;
            }
            case 'progress_update': {
              const payload = event.payload as any;
              updateProgress(taskId, payload.current, payload.total);
              break;
            }
            case 'error': {
              const payload = event.payload as any;
              setExecutionError(taskId, payload.code, payload.message);
              break;
            }
            case 'completed': {
              const payload = event.payload as any;
              completeExecution(
                taskId,
                payload.status === 'success',
                payload.gasUsed,
                payload.transactionId,
              );
              break;
            }
          }
        };

        client.on('event', handleEvent);
        client.on(`task:${taskId}`, handleEvent);

        // Connect if not already connected
        if (!client.getConnectionState || client.getConnectionState() === 'disconnected') {
          try {
            await client.connect();
          } catch (error) {
            logger.warn('Failed to connect stream, retrying...', {
              error: error instanceof Error ? error.message : String(error),
            });
            setTimeout(setupStream, 3000);
            return;
          }
        }

        // Subscribe to task events
        client.subscribe({
          taskId,
          startFrom,
          maxLogBufferSize,
        });

        logger.info('Task execution stream subscribed', { taskId });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error('Failed to set up execution stream', { error: err.message });
        onError?.(err);
      }
    };

    setupStream();

    // Cleanup on unmount or when taskId changes
    return () => {
      if (client && taskId) {
        try {
          client.unsubscribe(taskId);
          logger.info('Task execution stream unsubscribed', { taskId });
        } catch (error) {
          logger.warn('Error unsubscribing from stream', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };
  }, [taskId, enabled, startFrom, maxLogBufferSize, onEvent, onError, onConnectionStateChange, initializeExecution, updateExecutionStatus, addExecutionLog, updateProgress, setExecutionError, completeExecution, setStreamConnected]);

  // Memoize return object
  const executionState = getExecutionState(taskId);
  const logs = getLogs(taskId);

  return {
    // State
    executionState,
    logs,
    streamConnected,
    status: executionState?.status || 'pending',
    progress: executionState?.progress,
    error: executionState?.error,

    // Actions
    getExecutionState: useCallback(
      () => getExecutionState(taskId),
      [taskId, getExecutionState],
    ),
    getLogs: useCallback(
      () => getLogs(taskId),
      [taskId, getLogs],
    ),
  };
}

/**
 * Hook to manually connect/disconnect from the execution stream
 * 
 * @returns Object with connect and disconnect functions
 */
export function useExecutionStreamConnection() {
  const handleConnect = useCallback(async () => {
    try {
      const client = getStreamClient();
      if (!client || !client.getConnectionState || client.getConnectionState() === 'connected') {
        return;
      }
      await client.connect();
      logger.info('Execution stream connected');
    } catch (error) {
      logger.error('Failed to connect execution stream', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    try {
      const client = getStreamClient();
      if (!client) return;
      await client.disconnect();
      logger.info('Execution stream disconnected');
    } catch (error) {
      logger.error('Failed to disconnect execution stream', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  return { connect: handleConnect, disconnect: handleDisconnect };
}
