/**
 * Tests for CRDT Document Manager
 */

import { CRDTDocumentManager } from '../crdtDocumentManager';
import type { CollaborativeOptions } from '../types';

describe('CRDTDocumentManager', () => {
  let manager: CRDTDocumentManager;
  const mockOptions: CollaborativeOptions = {
    taskId: 'task-123',
    userId: 'user-456',
    userName: 'Test User',
    serverUrl: 'ws://localhost:1234',
    autoConnect: false,
  };

  beforeEach(() => {
    manager = new CRDTDocumentManager(mockOptions);
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('Field Operations', () => {
    it('should update and retrieve fields', () => {
      manager.updateField(['title'], 'Test Task');
      const value = manager.getField(['title']);
      expect(value).toBe('Test Task');
    });

    it('should handle nested fields', () => {
      manager.updateField(['config', 'settings'], { enabled: true });
      const value = manager.getField(['config', 'settings']);
      expect(value).toEqual({ enabled: true });
    });

    it('should emit operation events', (done) => {
      manager.on('operation', (event) => {
        expect(event.data).toBeDefined();
        expect(event.data.path).toEqual(['title']);
        done();
      });

      manager.updateField(['title'], 'New Title');
    });
  });

  describe('State Management', () => {
    it('should return current state', () => {
      const state = manager.getState();
      expect(state).toHaveProperty('taskId', 'task-123');
      expect(state).toHaveProperty('isCollaborative', false);
      expect(state).toHaveProperty('activeUsers', []);
      expect(state).toHaveProperty('connectionStatus', 'disconnected');
    });

    it('should track operation history', () => {
      manager.updateField(['title'], 'Test 1');
      manager.updateField(['title'], 'Test 2');

      const history = manager.getOperationHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Event Handling', () => {
    it('should allow event subscription', () => {
      const listener = jest.fn();
      manager.on('sync', listener);
      manager.emit('sync' as any, { test: true });

      expect(listener).toHaveBeenCalled();
    });

    it('should allow unsubscription', () => {
      const listener = jest.fn();
      const unsubscribe = manager.on('sync', listener);
      unsubscribe();
      
      manager.emit('sync' as any, { test: true });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Connection Handling', () => {
    it('should initialize with disconnected status', () => {
      const state = manager.getState();
      expect(state.connectionStatus).toBe('disconnected');
    });

    it('should handle connection attempts', () => {
      expect(() => manager.connect()).not.toThrow();
    });

    it('should handle disconnection', () => {
      manager.disconnect();
      const state = manager.getState();
      expect(state.connectionStatus).toBe('disconnected');
    });
  });
});
