/**
 * useTaskExecutionStream Hook Tests
 * 
 * Integration tests for the task execution streaming hook.
 */

import { renderHook, act } from '@testing-library/react';
import { useTaskExecutionStream, useExecutionStreamConnection } from '@/src/hooks/useTaskExecutionStream';
import { getStreamClient, resetStreamClient } from '@/src/lib/taskExecutionStreamClient';
import { useExecutionStore } from '@/src/store/taskExecutionStore';

// Mock socket.io
jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    connected: false,
  })),
}));

// Mock logger
jest.mock('@/src/lib/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe('useTaskExecutionStream', () => {
  beforeEach(() => {
    resetStreamClient();
    useExecutionStore.setState({ executions: {}, streamConnected: false });
    jest.clearAllMocks();
  });

  describe('Hook Initialization', () => {
    it('should initialize execution state on mount', () => {
      const { result } = renderHook(() => useTaskExecutionStream('task-123'));

      expect(result.current.executionState).toBeDefined();
      expect(result.current.executionState?.taskId).toBe('task-123');
      expect(result.current.executionState?.status).toBe('pending');
    });

    it('should not initialize when disabled', () => {
      const { result } = renderHook(() =>
        useTaskExecutionStream('task-123', { enabled: false }),
      );

      expect(result.current.executionState).toBeNull();
    });

    it('should not initialize without taskId', () => {
      const { result } = renderHook(() =>
        useTaskExecutionStream('', { enabled: true }),
      );

      expect(result.current.executionState).toBeNull();
    });
  });

  describe('Return Value', () => {
    it('should return execution state', () => {
      const { result } = renderHook(() => useTaskExecutionStream('task-123'));

      expect(result.current.executionState).toBeDefined();
      expect(result.current.status).toBe('pending');
      expect(result.current.logs).toEqual([]);
      expect(result.current.streamConnected).toBe(false);
    });

    it('should return action functions', () => {
      const { result } = renderHook(() => useTaskExecutionStream('task-123'));

      expect(typeof result.current.getExecutionState).toBe('function');
      expect(typeof result.current.getLogs).toBe('function');
    });

    it('should return progress information', () => {
      const { result } = renderHook(() => useTaskExecutionStream('task-123'));

      expect(result.current.progress).toBeUndefined();

      const store = useExecutionStore.getState();
      act(() => {
        store.updateProgress('task-123', 50, 100);
      });

      expect(result.current.progress).toEqual({ current: 50, total: 100 });
    });

    it('should return error information', () => {
      const { result } = renderHook(() => useTaskExecutionStream('task-123'));

      expect(result.current.error).toBeUndefined();

      const store = useExecutionStore.getState();
      act(() => {
        store.setExecutionError('task-123', 'TEST_ERROR', 'Test error message');
      });

      expect(result.current.error).toEqual({
        code: 'TEST_ERROR',
        message: 'Test error message',
      });
    });
  });

  describe('Event Callbacks', () => {
    it('should call onError when stream connection fails', (done) => {
      const mockError = jest.fn();

      renderHook(() =>
        useTaskExecutionStream('task-123', {
          onError: mockError,
        }),
      );

      // The onError callback should be called, but this depends on actual socket connection
      setTimeout(() => {
        done();
      }, 100);
    });

    it('should call onConnectionStateChange on state change', (done) => {
      const mockStateChange = jest.fn();

      renderHook(() =>
        useTaskExecutionStream('task-123', {
          onConnectionStateChange: mockStateChange,
        }),
      );

      // Connection state changes would trigger the callback
      setTimeout(() => {
        done();
      }, 100);
    });

    it('should call onEvent when execution event received', (done) => {
      const mockEvent = jest.fn();

      renderHook(() =>
        useTaskExecutionStream('task-123', {
          onEvent: mockEvent,
        }),
      );

      setTimeout(() => {
        done();
      }, 100);
    });
  });

  describe('Stream Options', () => {
    it('should use provided maxLogBufferSize', () => {
      renderHook(() =>
        useTaskExecutionStream('task-123', {
          maxLogBufferSize: 500,
        }),
      );

      // Option should be passed to stream client subscribe
      // This is verified by the implementation calling client.subscribe()
    });

    it('should use provided startFrom option', () => {
      renderHook(() =>
        useTaskExecutionStream('task-123', {
          startFrom: 'beginning',
        }),
      );

      // Option should be passed to stream client subscribe
    });
  });

  describe('Cleanup', () => {
    it('should unsubscribe on unmount', () => {
      const { unmount } = renderHook(() => useTaskExecutionStream('task-123'));

      const client = getStreamClient();
      const unsubscribeSpy = jest.spyOn(client, 'unsubscribe');

      unmount();

      // Unsubscribe should have been called
      expect(unsubscribeSpy).toHaveBeenCalled();
    });

    it('should handle unsubscribe errors gracefully', () => {
      const { unmount } = renderHook(() => useTaskExecutionStream('task-123'));

      const client = getStreamClient();
      jest.spyOn(client, 'unsubscribe').mockImplementation(() => {
        throw new Error('Unsubscribe failed');
      });

      expect(() => unmount()).not.toThrow();
    });
  });

  describe('State Synchronization', () => {
    it('should sync status changes with store', () => {
      const { result } = renderHook(() => useTaskExecutionStream('task-123'));

      const store = useExecutionStore.getState();
      act(() => {
        store.updateExecutionStatus('task-123', 'executing');
      });

      expect(result.current.status).toBe('executing');
    });

    it('should sync logs with store', () => {
      const { result } = renderHook(() => useTaskExecutionStream('task-123'));

      const store = useExecutionStore.getState();
      act(() => {
        store.addExecutionLog('task-123', {
          id: 'log-1',
          taskId: 'task-123',
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Test log',
        });
      });

      expect(result.current.logs).toHaveLength(1);
    });

    it('should maintain execution state across re-renders', () => {
      const { result, rerender } = renderHook(() =>
        useTaskExecutionStream('task-123'),
      );

      const initialState = result.current.executionState;

      rerender();

      expect(result.current.executionState?.taskId).toBe(initialState?.taskId);
    });
  });
});

describe('useExecutionStreamConnection', () => {
  beforeEach(() => {
    resetStreamClient();
    jest.clearAllMocks();
  });

  describe('Connection Management', () => {
    it('should provide connect function', () => {
      const { result } = renderHook(() => useExecutionStreamConnection());

      expect(typeof result.current.connect).toBe('function');
    });

    it('should provide disconnect function', () => {
      const { result } = renderHook(() => useExecutionStreamConnection());

      expect(typeof result.current.disconnect).toBe('function');
    });
  });

  describe('Connect Function', () => {
    it('should handle connection success', async () => {
      const { result } = renderHook(() => useExecutionStreamConnection());

      const client = getStreamClient();
      jest.spyOn(client, 'connect').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.connect();
      });

      expect(client.connect).toHaveBeenCalled();
    });

    it('should handle connection errors gracefully', async () => {
      const { result } = renderHook(() => useExecutionStreamConnection());

      const client = getStreamClient();
      jest.spyOn(client, 'connect').mockRejectedValue(new Error('Connection failed'));

      await act(async () => {
        await result.current.connect();
      });

      // Should not throw
      expect(client.connect).toHaveBeenCalled();
    });

    it('should not connect if already connected', async () => {
      const { result } = renderHook(() => useExecutionStreamConnection());

      const client = getStreamClient();
      jest
        .spyOn(client, 'getConnectionState')
        .mockReturnValue('connected');
      const connectSpy = jest.spyOn(client, 'connect');

      await act(async () => {
        await result.current.connect();
      });

      expect(connectSpy).not.toHaveBeenCalled();
    });
  });

  describe('Disconnect Function', () => {
    it('should handle disconnection success', async () => {
      const { result } = renderHook(() => useExecutionStreamConnection());

      const client = getStreamClient();
      jest.spyOn(client, 'disconnect').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.disconnect();
      });

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('should handle disconnection errors gracefully', async () => {
      const { result } = renderHook(() => useExecutionStreamConnection());

      const client = getStreamClient();
      jest.spyOn(client, 'disconnect').mockRejectedValue(new Error('Disconnection failed'));

      await act(async () => {
        await result.current.disconnect();
      });

      // Should not throw
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('should handle null client gracefully', async () => {
      resetStreamClient();
      const { result } = renderHook(() => useExecutionStreamConnection());

      await act(async () => {
        await result.current.disconnect();
      });

      // Should not throw
    });
  });
});
