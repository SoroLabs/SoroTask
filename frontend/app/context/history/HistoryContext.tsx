'use client';

import React, { createContext, useContext, useCallback } from 'react';
import { HistoryEvent, FieldChange, HistoryEventType, Task } from '../../types';

interface HistoryContextValue {
  addHistoryEvent: (
    taskId: string,
    eventType: HistoryEventType,
    changes: FieldChange[],
    description?: string
  ) => void;
  getTaskHistory: (taskId: string) => HistoryEvent[];
  generateDiff: (oldValue: string, newValue: string) => DiffResult;
}

interface DiffResult {
  added: string[];
  removed: string[];
  hasChanges: boolean;
}

const HistoryContext = createContext<HistoryContextValue>({
  addHistoryEvent: () => {},
  getTaskHistory: () => [],
  generateDiff: () => ({ added: [], removed: [], hasChanges: false }),
});

// Mock history storage - in a real app, this would be persisted
let historyEvents: HistoryEvent[] = [];
let eventCounter = 0;

export function HistoryProvider({ children }: { children: React.ReactNode }) {
  const addHistoryEvent = useCallback((
    taskId: string,
    eventType: HistoryEventType,
    changes: FieldChange[],
    description?: string
  ) => {
    const event: HistoryEvent = {
      id: `event-${++eventCounter}`,
      taskId,
      timestamp: new Date(),
      actor: 'current-user', // In real app, get from auth context
      actorName: 'You', // In real app, get from user profile
      eventType,
      changes,
      description,
    };

    historyEvents.unshift(event); // Add to beginning for chronological order (newest first)
  }, []);

  const getTaskHistory = useCallback((taskId: string) => {
    return historyEvents.filter(event => event.taskId === taskId);
  }, []);

  const generateDiff = useCallback((oldValue: string, newValue: string): DiffResult => {
    if (oldValue === newValue) {
      return { added: [], removed: [], hasChanges: false };
    }

    const oldWords = oldValue.split(/\s+/).filter(word => word.length > 0);
    const newWords = newValue.split(/\s+/).filter(word => word.length > 0);

    const oldSet = new Set(oldWords);
    const newSet = new Set(newWords);

    const added = newWords.filter(word => !oldSet.has(word));
    const removed = oldWords.filter(word => !newSet.has(word));

    return {
      added,
      removed,
      hasChanges: added.length > 0 || removed.length > 0,
    };
  }, []);

  return (
    <HistoryContext.Provider value={{ addHistoryEvent, getTaskHistory, generateDiff }}>
      {children}
    </HistoryContext.Provider>
  );
}

export function useHistory() {
  const context = useContext(HistoryContext);
  if (!context) {
    throw new Error('useHistory must be used within HistoryProvider');
  }
  return context;
}