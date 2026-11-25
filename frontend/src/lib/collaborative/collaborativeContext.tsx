/**
 * Collaborative Editing Context for React
 */

'use client';

import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { CRDTDocumentManager } from './crdtDocumentManager';
import { CollaborativeSyncEngine } from './collaborativeSyncEngine';
import type { Task } from '@/src/types/task';
import type {
  CollaborativeOptions,
  CollaborativeState,
  CollaborativeUser,
} from './types';

interface CollaborativeContextType {
  state: CollaborativeState | null;
  syncEngine: CollaborativeSyncEngine | null;
  crdt: CRDTDocumentManager | null;
  activeUsers: CollaborativeUser[];
  updateField: (path: string[], value: any) => void;
  getField: (path: string[]) => any;
  connect: () => void;
  disconnect: () => void;
  getOperationHistory: () => any[];
}

const CollaborativeContext = createContext<CollaborativeContextType | undefined>(undefined);

interface CollaborativeProviderProps {
  taskId: string;
  userId: string;
  userName: string;
  serverUrl: string;
  task?: Task;
  autoConnect?: boolean;
  conflictResolutionStrategy?: 'last-write-wins' | 'crdt' | 'manual';
  children: React.ReactNode;
}

/**
 * Provider for collaborative editing
 */
export function CollaborativeProvider({
  taskId,
  userId,
  userName,
  serverUrl,
  task,
  autoConnect = true,
  conflictResolutionStrategy = 'crdt',
  children,
}: CollaborativeProviderProps) {
  const [state, setState] = useState<CollaborativeState | null>(null);
  const crdt = useRef<CRDTDocumentManager | null>(null);
  const syncEngine = useRef<CollaborativeSyncEngine | null>(null);

  // Initialize CRDT and sync engine
  useEffect(() => {
    let unsubscribeConnected: () => void = () => {};
    let unsubscribeDisconnected: () => void = () => {};
    let unsubscribeSync: () => void = () => {};
    let unsubscribeUserJoined: () => void = () => {};
    let unsubscribeError: () => void = () => {};

    const cleanup = () => {
      unsubscribeConnected();
      unsubscribeDisconnected();
      unsubscribeSync();
      unsubscribeUserJoined();
      unsubscribeError();

      if (syncEngine.current) {
        syncEngine.current.destroy();
        syncEngine.current = null;
      }

      crdt.current = null;
      setState(null);
    };

    cleanup();

    crdt.current = new CRDTDocumentManager({
      taskId,
      userId,
      userName,
      serverUrl,
      autoConnect,
      conflictResolutionStrategy,
      enablePersistence: true,
      enableAwareness: true,
    });

    syncEngine.current = new CollaborativeSyncEngine(crdt.current);

    if (task) {
      syncEngine.current.initializeTask(task);
    }

    // Listen for state changes
    unsubscribeConnected = crdt.current.on('connected', () => {
      setState((prev) =>
        prev ? { ...prev, connectionStatus: 'connected' } : crdt.current!.getState()
      );
    });

    unsubscribeDisconnected = crdt.current.on('disconnected', () => {
      setState((prev) =>
        prev ? { ...prev, connectionStatus: 'disconnected' } : crdt.current!.getState()
      );
    });

    unsubscribeSync = crdt.current.on('sync', () => {
      setState(crdt.current!.getState());
    });

    unsubscribeUserJoined = crdt.current.on('userJoined', () => {
      setState(crdt.current!.getState());
    });

    unsubscribeError = crdt.current.on('error', (event) => {
      setState((prev) => ({
        ...prev!,
        errorMessage: event.data?.message,
        connectionStatus: 'disconnected',
      }));
    });

    return cleanup;
  }, [taskId, userId, userName, serverUrl, autoConnect, conflictResolutionStrategy, task]);

  const updateField = useCallback(
    (path: string[], value: any) => {
      if (syncEngine.current) {
        syncEngine.current.queueUpdate(path, value);
      }
    },
    []
  );

  const getField = useCallback(
    (path: string[]) => {
      if (crdt.current) {
        return crdt.current.getField(path);
      }
      return undefined;
    },
    []
  );

  const connect = useCallback(() => {
    if (crdt.current) {
      crdt.current.connect();
    }
  }, []);

  const disconnect = useCallback(() => {
    if (crdt.current) {
      crdt.current.disconnect();
    }
  }, []);

  const getOperationHistory = useCallback(() => {
    if (syncEngine.current) {
      return syncEngine.current.getOperationHistory();
    }
    return [];
  }, []);

  const value: CollaborativeContextType = {
    state: state || (crdt.current ? crdt.current.getState() : null),
    syncEngine: syncEngine.current,
    crdt: crdt.current,
    activeUsers: state?.activeUsers ?? [],
    updateField,
    getField,
    connect,
    disconnect,
    getOperationHistory,
  };

  return (
    <CollaborativeContext.Provider value={value}>
      {children}
    </CollaborativeContext.Provider>
  );
}

/**
 * Hook to use collaborative editing context
 */
export function useCollaborative(): CollaborativeContextType {
  const context = useContext(CollaborativeContext);
  if (!context) {
    throw new Error(
      'useCollaborative must be used within a CollaborativeProvider'
    );
  }
  return context;
}

/**
 * Hook to get the collaborative state
 */
export function useCollaborativeState(): CollaborativeState | null {
  const { state } = useCollaborative();
  return state;
}

/**
 * Hook to get active users
 */
export function useActiveUsers(): CollaborativeUser[] {
  const { activeUsers } = useCollaborative();
  return activeUsers;
}

/**
 * Hook to update a field in collaborative mode
 */
export function useCollaborativeField(
  path: string[],
  initialValue?: any
): [any, (value: any) => void] {
  const context = useCollaborative();
  const { updateField, getField } = context;
  const [value, setValue] = useState(initialValue ?? getField(path));

  useEffect(() => {
    const currentValue = getField(path);
    if (currentValue !== undefined) {
      setValue(currentValue);
    }
  }, [path, getField]);

  useEffect(() => {
    if (initialValue !== undefined) {
      setValue(initialValue);
    }
  }, [initialValue]);

  useEffect(() => {
    if (!context.crdt) return;

    const unsubscribe = context.crdt.on('operation', (event) => {
      const operation = event.data;
      if (!operation?.path) return;

      const operationPath = operation.path as string[];
      const matches = operationPath.length === path.length && operationPath.every((segment, index) => segment === path[index]);

      if (matches) {
        const currentValue = context.getField(path);
        setValue(currentValue);
      }
    });

    return unsubscribe;
  }, [context, path]);

  const handleUpdate = useCallback(
    (newValue: any) => {
      setValue(newValue);
      updateField(path, newValue);
    },
    [path, updateField]
  );

  return [value, handleUpdate];
}
