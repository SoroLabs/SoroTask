/**
 * Collaborative Editing UI Components
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useCollaborativeState, useActiveUsers } from '@/src/lib/collaborative/collaborativeContext';

/**
 * Component to display connection status
 */
export function CollaborativeStatus() {
  const state = useCollaborativeState();

  if (!state) return null;

  const statusColors = {
    connected: 'bg-green-500/10 text-green-400 border-green-500/20',
    disconnected: 'bg-red-500/10 text-red-400 border-red-500/20',
    syncing: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  };

  const statusIcon = {
    connected: '●',
    disconnected: '○',
    syncing: '◐',
  };

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
        statusColors[state.connectionStatus]
      }`}
    >
      <span>{statusIcon[state.connectionStatus]}</span>
      <span className="capitalize">{state.connectionStatus}</span>
    </div>
  );
}

/**
 * Component to display active users
 */
export function ActiveUsersDisplay() {
  const activeUsers = useActiveUsers();
  const [isExpanded, setIsExpanded] = useState(false);

  if (activeUsers.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center">
        {activeUsers.slice(0, 3).map((user, index) => (
          <div
            key={user.clientId}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${
              index > 0 ? '-ml-2' : ''
            }`}
            style={{
              backgroundColor: user.color,
              zIndex: activeUsers.length - index,
            }}
            title={user.userName}
          >
            {user.userName.charAt(0).toUpperCase()}
          </div>
        ))}
        {activeUsers.length > 3 && (
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold -ml-2 bg-neutral-600">
            +{activeUsers.length - 3}
          </div>
        )}
      </div>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-xs text-neutral-400 hover:text-neutral-200 px-2 py-1"
      >
        {activeUsers.length} editing
      </button>
      {isExpanded && (
        <div className="absolute mt-2 bg-neutral-800 border border-neutral-700 rounded-lg p-2 min-w-max z-50">
          {activeUsers.map((user) => (
            <div key={user.clientId} className="flex items-center gap-2 py-1 px-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: user.color }}
              />
              <span className="text-xs text-neutral-200">{user.userName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Component to display collaboration info
 */
export function CollaborationInfo() {
  const state = useCollaborativeState();

  if (!state || !state.isCollaborative) {
    return null;
  }

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-neutral-800/50 border border-neutral-700/50 rounded-lg text-xs">
      <div className="flex items-center gap-2">
        <span className="text-neutral-400">Status:</span>
        <CollaborativeStatus />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-neutral-400">Users:</span>
        <ActiveUsersDisplay />
      </div>
      {state.conflictCount > 0 && (
        <div className="flex items-center gap-2 px-2 py-1 bg-red-500/10 border border-red-500/20 rounded text-red-400">
          <span>⚠</span>
          <span>{state.conflictCount} conflict{state.conflictCount > 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Component for collaborative cursor indicator
 */
interface CollaborativeCursorProps {
  userColor: string;
  userName: string;
  line?: number;
  column?: number;
}

export function CollaborativeCursor({
  userColor,
  userName,
  line,
  column,
}: CollaborativeCursorProps) {
  if (line === undefined || column === undefined) {
    return null;
  }

  return (
    <div
      className="absolute w-0.5 h-5 animate-pulse pointer-events-none"
      style={{
        backgroundColor: userColor,
        left: `${column}ch`,
        top: `${line * 1.5}rem`,
      }}
      title={userName}
    >
      <div
        className="absolute text-xs font-semibold px-1 py-0.5 rounded whitespace-nowrap top-full"
        style={{
          backgroundColor: userColor,
          color: 'white',
          marginTop: '2px',
        }}
      >
        {userName}
      </div>
    </div>
  );
}

/**
 * Component for showing sync status messages
 */
export function SyncStatusMessage() {
  const state = useCollaborativeState();
  const [showMessage, setShowMessage] = useState(false);

  useEffect(() => {
    if (state?.errorMessage) {
      setShowMessage(true);
      const timer = setTimeout(() => setShowMessage(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [state?.errorMessage]);

  if (!showMessage || !state?.errorMessage) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm">
      {state.errorMessage}
    </div>
  );
}
