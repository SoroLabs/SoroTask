'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface LayoutState {
  selectedTaskId: string | null;
  splitPercentage: number;
  isDetailOpen: boolean;
}

interface LayoutContextValue {
  layout: LayoutState;
  selectTask: (taskId: string | null) => void;
  setSplitPercentage: (percentage: number) => void;
  closeDetail: () => void;
}

const LayoutContext = createContext<LayoutContextValue>({
  layout: { selectedTaskId: null, splitPercentage: 50, isDetailOpen: false },
  selectTask: () => {},
  setSplitPercentage: () => {},
  closeDetail: () => {},
});

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [layout, setLayout] = useState<LayoutState>({
    selectedTaskId: null,
    splitPercentage: 50,
    isDetailOpen: false,
  });

  // Load from URL on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const taskId = urlParams.get('task');
    const split = urlParams.get('split');

    if (taskId) {
      setLayout(prev => ({
        ...prev,
        selectedTaskId: taskId,
        isDetailOpen: true,
        splitPercentage: split ? parseInt(split) : prev.splitPercentage,
      }));
    }
  }, []);

  // Update URL when layout changes
  useEffect(() => {
    const url = new URL(window.location.href);

    if (layout.selectedTaskId && layout.isDetailOpen) {
      url.searchParams.set('task', layout.selectedTaskId);
      url.searchParams.set('split', layout.splitPercentage.toString());
    } else {
      url.searchParams.delete('task');
      url.searchParams.delete('split');
    }

    // Update URL without triggering navigation
    window.history.replaceState({}, '', url.toString());
  }, [layout.selectedTaskId, layout.isDetailOpen, layout.splitPercentage]);

  const selectTask = (taskId: string | null) => {
    setLayout(prev => ({
      ...prev,
      selectedTaskId: taskId,
      isDetailOpen: taskId !== null,
    }));
  };

  const setSplitPercentage = (percentage: number) => {
    setLayout(prev => ({
      ...prev,
      splitPercentage: Math.max(20, Math.min(80, percentage)), // Clamp between 20-80%
    }));
  };

  const closeDetail = () => {
    setLayout(prev => ({
      ...prev,
      selectedTaskId: null,
      isDetailOpen: false,
    }));
  };

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const taskId = urlParams.get('task');
      const split = urlParams.get('split');

      setLayout(prev => ({
        ...prev,
        selectedTaskId: taskId,
        isDetailOpen: !!taskId,
        splitPercentage: split ? parseInt(split) : prev.splitPercentage,
      }));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return (
    <LayoutContext.Provider value={{
      layout,
      selectTask,
      setSplitPercentage,
      closeDetail,
    }}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within LayoutProvider');
  }
  return context;
}