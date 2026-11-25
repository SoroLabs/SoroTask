/**
 * Task Execution Store Tests
 * 
 * Unit tests for the Zustand execution store.
 */

import { renderHook, act } from '@testing-library/react';
import { useExecutionStore } from '@/src/store/taskExecutionStore';

describe('useExecutionStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useExecutionStore.setState({
      executions: {},
      streamConnected: false,
    });
  });

  describe('Initialization', () => {
    it('should start with empty executions', () => {
      const { result } = renderHook(() => useExecutionStore());
      expect(result.current.executions).toEqual({});
      expect(result.current.streamConnected).toBe(false);
    });

    it('should initialize a new execution', () => {
      const { result } = renderHook(() => useExecutionStore());

      act(() => {
        result.current.initializeExecution('task-123');
      });

      expect(result.current.executions['task-123']).toBeDefined();
      expect(result.current.executions['task-123'].status).toBe('pending');
      expect(result.current.executions['task-123'].logs).toEqual([]);
    });

    it('should not reinitialize existing execution', () => {
      const { result } = renderHook(() => useExecutionStore());

      act(() => {
        result.current.initializeExecution('task-123');
        result.current.updateExecutionStatus('task-123', 'executing');
      });

      const firstStatus = result.current.executions['task-123'].status;

      act(() => {
        result.current.initializeExecution('task-123');
      });

      expect(result.current.executions['task-123'].status).toBe(firstStatus);
    });
  });

  describe('Status Management', () => {
    it('should update execution status', () => {
      const { result } = renderHook(() => useExecutionStore());

      act(() => {
        result.current.initializeExecution('task-123');
        result.current.updateExecutionStatus('task-123', 'executing');
      });

      expect(result.current.executions['task-123'].status).toBe('executing');
    });

    it('should set startedAt when status changes to executing', () => {
      const { result } = renderHook(() => useExecutionStore());

      act(() => {
        result.current.initializeExecution('task-123');
        result.current.updateExecutionStatus('task-123', 'executing');
      });

      expect(result.current.executions['task-123'].startedAt).toBeDefined();
    });

    it('should auto-initialize if not present', () => {
      const { result } = renderHook(() => useExecutionStore());

      act(() => {
        result.current.updateExecutionStatus('task-456', 'executing');
      });

      expect(result.current.executions['task-456']).toBeDefined();
      expect(result.current.executions['task-456'].status).toBe('executing');
    });
  });

  describe('Logging', () => {
    it('should add execution logs', () => {
      const { result } = renderHook(() => useExecutionStore());

      act(() => {
        result.current.initializeExecution('task-123');
        result.current.addExecutionLog('task-123', {
          id: 'log-1',
          taskId: 'task-123',
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Test log',
        });
      });

      expect(result.current.executions['task-123'].logs).toHaveLength(1);
      expect(result.current.executions['task-123'].logs[0].message).toBe('Test log');
    });

    it('should enforce log buffer limit', () => {
      const { result } = renderHook(() => useExecutionStore());

      act(() => {
        result.current.initializeExecution('task-123');

        // Add more logs than buffer limit (1000)
        for (let i = 0; i < 1500; i++) {
          result.current.addExecutionLog('task-123', {
            id: `log-${i}`,
            taskId: 'task-123',
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `Log ${i}`,
          });
        }
      });

      expect(result.current.executions['task-123'].logs.length).toBeLessThanOrEqual(1000);
    });

    it('should get logs for a task', () => {
      const { result } = renderHook(() => useExecutionStore());

      act(() => {
        result.current.initializeExecution('task-123');
        result.current.addExecutionLog('task-123', {
          id: 'log-1',
          taskId: 'task-123',
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Test log 1',
        });
        result.current.addExecutionLog('task-123', {
          id: 'log-2',
          taskId: 'task-123',
          timestamp: new Date().toISOString(),
          level: 'error',
          message: 'Test log 2',
        });
      });

      const logs = result.current.getLogs('task-123');
      expect(logs).toHaveLength(2);
      expect(logs[0].message).toBe('Test log 1');
      expect(logs[1].message).toBe('Test log 2');
    });

    it('should return empty array for logs when task not tracked', () => {
      const { result } = renderHook(() => useExecutionStore());

      const logs = result.current.getLogs('unknown-task');
      expect(logs).toEqual([]);
    });
  });

  describe('Progress Tracking', () => {
    it('should update progress', () => {
      const { result } = renderHook(() => useExecutionStore());

      act(() => {
        result.current.initializeExecution('task-123');
        result.current.updateProgress('task-123', 50, 100);
      });

      expect(result.current.executions['task-123'].progress).toEqual({
        current: 50,
        total: 100,
      });
    });

    it('should update progress multiple times', () => {
      const { result } = renderHook(() => useExecutionStore());

      act(() => {
        result.current.initializeExecution('task-123');
        result.current.updateProgress('task-123', 25, 100);
        result.current.updateProgress('task-123', 50, 100);
        result.current.updateProgress('task-123', 100, 100);
      });

      expect(result.current.executions['task-123'].progress?.current).toBe(100);
    });
  });

  describe('Error Handling', () => {
    it('should set execution error', () => {
      const { result } = renderHook(() => useExecutionStore());

      act(() => {
        result.current.initializeExecution('task-123');
        result.current.setExecutionError('task-123', 'VALIDATION_ERROR', 'Invalid input');
      });

      expect(result.current.executions['task-123'].error).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
      });
      expect(result.current.executions['task-123'].status).toBe('failed');
    });

    it('should auto-initialize if not present when setting error', () => {
      const { result } = renderHook(() => useExecutionStore());

      act(() => {
        result.current.setExecutionError('task-456', 'ERROR', 'Something failed');
      });

      expect(result.current.executions['task-456']).toBeDefined();
      expect(result.current.executions['task-456'].error?.code).toBe('ERROR');
    });
  });

  describe('Completion', () => {
    it('should mark execution as completed successfully', () => {
      const { result } = renderHook(() => useExecutionStore());

      act(() => {
        result.current.initializeExecution('task-123');
        result.current.completeExecution('task-123', true, 1500, 'tx-123');
      });

      expect(result.current.executions['task-123'].status).toBe('completed');
      expect(result.current.executions['task-123'].gasUsed).toBe(1500);
      expect(result.current.executions['task-123'].transactionId).toBe('tx-123');
      expect(result.current.executions['task-123'].completedAt).toBeDefined();
    });

    it('should mark execution as failed', () => {
      const { result } = renderHook(() => useExecutionStore());

      act(() => {
        result.current.initializeExecution('task-123');
        result.current.completeExecution('task-123', false, 1000);
      });

      expect(result.current.executions['task-123'].status).toBe('failed');
      expect(result.current.executions['task-123'].gasUsed).toBe(1000);
    });
  });

  describe('State Retrieval', () => {
    it('should get execution state', () => {
      const { result } = renderHook(() => useExecutionStore());

      act(() => {
        result.current.initializeExecution('task-123');
        result.current.updateExecutionStatus('task-123', 'executing');
      });

      const state = result.current.getExecutionState('task-123');
      expect(state).toBeDefined();
      expect(state?.status).toBe('executing');
      expect(state?.taskId).toBe('task-123');
    });

    it('should return null for unknown task', () => {
      const { result } = renderHook(() => useExecutionStore());

      const state = result.current.getExecutionState('unknown-task');
      expect(state).toBeNull();
    });
  });

  describe('Stream Connection', () => {
    it('should set stream connection status', () => {
      const { result } = renderHook(() => useExecutionStore());

      expect(result.current.streamConnected).toBe(false);

      act(() => {
        result.current.setStreamConnected(true);
      });

      expect(result.current.streamConnected).toBe(true);
    });
  });

  describe('Cleanup', () => {
    it('should clear single execution', () => {
      const { result } = renderHook(() => useExecutionStore());

      act(() => {
        result.current.initializeExecution('task-123');
        result.current.initializeExecution('task-456');
      });

      expect(Object.keys(result.current.executions)).toHaveLength(2);

      act(() => {
        result.current.clearExecution('task-123');
      });

      expect(Object.keys(result.current.executions)).toHaveLength(1);
      expect(result.current.executions['task-456']).toBeDefined();
      expect(result.current.executions['task-123']).toBeUndefined();
    });

    it('should clear all executions', () => {
      const { result } = renderHook(() => useExecutionStore());

      act(() => {
        result.current.initializeExecution('task-123');
        result.current.initializeExecution('task-456');
        result.current.initializeExecution('task-789');
      });

      expect(Object.keys(result.current.executions).length).toBeGreaterThan(0);

      act(() => {
        result.current.clearAllExecutions();
      });

      expect(result.current.executions).toEqual({});
    });
  });
});
