'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { MentionableEntity, MentionTrigger } from '../../types/mentions';

// Mock data for demonstration
const mockUsers: MentionableEntity[] = [
  { id: 'user-1', type: 'user', displayName: 'Alice Johnson', avatar: 'AJ' },
  { id: 'user-2', type: 'user', displayName: 'Bob Smith', avatar: 'BS' },
  { id: 'user-3', type: 'user', displayName: 'Carol Williams', avatar: 'CW' },
  { id: 'user-4', type: 'user', displayName: 'David Brown', avatar: 'DB' },
];

const mockTasks: MentionableEntity[] = [
  { id: 'task-1', type: 'task', displayName: 'Harvest Yield Task', metadata: { contract: 'CC...A12B' } },
  { id: 'task-2', type: 'task', displayName: 'Liquidity Rebalance', metadata: { contract: 'DD...B23C' } },
];

const mockContracts: MentionableEntity[] = [
  { id: 'contract-1', type: 'contract', displayName: 'Yield Farm Contract', metadata: { address: 'CC...A12B' } },
  { id: 'contract-2', type: 'contract', displayName: 'DEX Router', metadata: { address: 'DD...B23C' } },
];

interface MentionsContextValue {
  triggers: MentionTrigger[];
  searchEntities: (type: MentionableEntity['type'], query: string) => Promise<MentionableEntity[]>;
}

const defaultTriggers: MentionTrigger[] = [
  {
    char: '@',
    type: 'user',
    searchFunction: async (query: string) => {
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 100));
      return mockUsers.filter(user =>
        user.displayName.toLowerCase().includes(query.toLowerCase())
      );
    },
  },
  {
    char: '#',
    type: 'task',
    searchFunction: async (query: string) => {
      await new Promise(resolve => setTimeout(resolve, 150));
      return mockTasks.filter(task =>
        task.displayName.toLowerCase().includes(query.toLowerCase())
      );
    },
  },
  {
    char: '$',
    type: 'contract',
    searchFunction: async (query: string) => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return mockContracts.filter(contract =>
        contract.displayName.toLowerCase().includes(query.toLowerCase())
      );
    },
  },
];

const MentionsContext = createContext<MentionsContextValue>({
  triggers: defaultTriggers,
  searchEntities: async () => [],
});

export function MentionsProvider({ children }: { children: React.ReactNode }) {
  const [triggers] = useState<MentionTrigger[]>(defaultTriggers);

  const searchEntities = useCallback(async (type: MentionableEntity['type'], query: string) => {
    const trigger = triggers.find(t => t.type === type);
    if (!trigger) return [];
    try {
      return await trigger.searchFunction(query);
    } catch (error) {
      console.error('Failed to search entities:', error);
      return [];
    }
  }, [triggers]);

  return (
    <MentionsContext.Provider value={{ triggers, searchEntities }}>
      {children}
    </MentionsContext.Provider>
  );
}

export function useMentions() {
  const context = useContext(MentionsContext);
  if (!context) {
    throw new Error('useMentions must be used within MentionsProvider');
  }
  return context;
}