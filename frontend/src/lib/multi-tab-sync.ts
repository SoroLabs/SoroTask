'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface SyncMessage {
  type: 'STATE_UPDATE' | 'WEBSOCKET_EVENT' | 'CACHE_INVALIDATE' | 'LEADER_ANNOUNCE' | 'LEADER_PING' | 'TAB_REGISTER' | 'TAB_UNREGISTER';
  payload: any;
  tabId: string;
  timestamp: number;
}

interface TabState {
  id: string;
  isLeader: boolean;
  lastSeen: number;
  wsConnected: boolean;
}

const LEADER_ELECTION_INTERVAL_MS = 5000;
const TAB_TIMEOUT_MS = 15000;
const STATE_BROADCAST_THROTTLE_MS = 50;

class MultiTabSyncEngine {
  private channel: BroadcastChannel | null = null;
  private tabId: string;
  private isLeader = false;
  private tabs: Map<string, TabState> = new Map();
  private leaderElectionTimer: ReturnType<typeof setInterval> | null = null;
  private stateUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingStateUpdate: any = null;
  private onStateUpdate: ((state: any) => void) | null = null;
  private onWebSocketEvent: ((event: any) => void) | null = null;

  constructor() {
    this.tabId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.init();
  }

  private init() {
    if (typeof BroadcastChannel === 'undefined') {
      console.warn('BroadcastChannel not supported, falling back to localStorage');
      this.initLocalStorageFallback();
      return;
    }

    this.channel = new BroadcastChannel('sorotask_sync');

    this.channel.onmessage = (event: MessageEvent<SyncMessage>) => {
      this.handleMessage(event.data);
    };

    this.registerTab();
    this.startLeaderElection();

    window.addEventListener('beforeunload', () => {
      this.unregisterTab();
    });
  }

  private initLocalStorageFallback() {
    window.addEventListener('storage', (event) => {
      if (event.key === 'sorotask_sync' && event.newValue) {
        try {
          const message = JSON.parse(event.newValue) as SyncMessage;
          this.handleMessage(message);
        } catch (e) {
          console.error('Failed to parse sync message', e);
        }
      }
    });
  }

  private registerTab() {
    this.send({
      type: 'TAB_REGISTER',
      payload: { tabId: this.tabId },
      tabId: this.tabId,
      timestamp: Date.now(),
    });

    this.tabs.set(this.tabId, {
      id: this.tabId,
      isLeader: false,
      lastSeen: Date.now(),
      wsConnected: false,
    });
  }

  private unregisterTab() {
    this.send({
      type: 'TAB_UNREGISTER',
      payload: { tabId: this.tabId },
      tabId: this.tabId,
      timestamp: Date.now(),
    });

    this.tabs.delete(this.tabId);

    if (this.isLeader) {
      this.isLeader = false;
      this.electLeader();
    }
  }

  private handleMessage(message: SyncMessage) {
    if (message.tabId === this.tabId) return;

    switch (message.type) {
      case 'TAB_REGISTER':
        this.tabs.set(message.payload.tabId, {
          id: message.payload.tabId,
          isLeader: false,
          lastSeen: Date.now(),
          wsConnected: false,
        });
        if (this.isLeader) {
          this.send({
            type: 'LEADER_ANNOUNCE',
            payload: { leaderId: this.tabId },
            tabId: this.tabId,
            timestamp: Date.now(),
          });
        }
        break;

      case 'TAB_UNREGISTER':
        this.tabs.delete(message.payload.tabId);
        break;

      case 'LEADER_ANNOUNCE':
        this.tabs.forEach((tab, id) => {
          tab.isLeader = id === message.payload.leaderId;
        });
        this.isLeader = message.payload.leaderId === this.tabId;
        break;

      case 'LEADER_PING':
        if (!this.isLeader) {
          this.tabs.get(message.tabId)?.lastSeen ??
            this.tabs.set(message.tabId, {
              id: message.tabId,
              isLeader: true,
              lastSeen: Date.now(),
              wsConnected: true,
            });
        }
        break;

      case 'STATE_UPDATE':
        this.throttleStateUpdate(message.payload);
        break;

      case 'WEBSOCKET_EVENT':
        this.onWebSocketEvent?.(message.payload);
        break;

      case 'CACHE_INVALIDATE':
        this.onStateUpdate?.({ type: 'CACHE_INVALIDATE', keys: message.payload.keys });
        break;
    }
  }

  private throttleStateUpdate(payload: any) {
    this.pendingStateUpdate = payload;

    if (!this.stateUpdateTimer) {
      this.stateUpdateTimer = setTimeout(() => {
        if (this.pendingStateUpdate) {
          this.onStateUpdate?.(this.pendingStateUpdate);
          this.pendingStateUpdate = null;
        }
        this.stateUpdateTimer = null;
      }, STATE_BROADCAST_THROTTLE_MS);
    }
  }

  private startLeaderElection() {
    this.leaderElectionTimer = setInterval(() => {
      this.electLeader();
    }, LEADER_ELECTION_INTERVAL_MS);

    this.electLeader();
  }

  private electLeader() {
    const now = Date.now();
    const activeTabs = Array.from(this.tabs.values()).filter(
      (tab) => now - tab.lastSeen < TAB_TIMEOUT_MS
    );

    if (activeTabs.length === 0) {
      this.becomeLeader();
      return;
    }

    const sortedTabs = activeTabs.sort((a, b) => a.id.localeCompare(b.id));
    const leaderId = sortedTabs[0].id;

    if (leaderId === this.tabId) {
      this.becomeLeader();
    } else {
      this.isLeader = false;
      this.tabs.forEach((tab, id) => {
        tab.isLeader = id === leaderId;
      });
    }
  }

  private becomeLeader() {
    if (!this.isLeader) {
      this.isLeader = true;
      this.tabs.forEach((tab, id) => {
        tab.isLeader = id === this.tabId;
      });

      this.send({
        type: 'LEADER_ANNOUNCE',
        payload: { leaderId: this.tabId },
        tabId: this.tabId,
        timestamp: Date.now(),
      });

      console.log('This tab is now the leader');
    }

    this.send({
      type: 'LEADER_PING',
      payload: {},
      tabId: this.tabId,
      timestamp: Date.now(),
    });
  }

  broadcastStateUpdate(state: any) {
    this.send({
      type: 'STATE_UPDATE',
      payload: state,
      tabId: this.tabId,
      timestamp: Date.now(),
    });
  }

  broadcastWebSocketEvent(event: any) {
    if (this.isLeader) {
      this.send({
        type: 'WEBSOCKET_EVENT',
        payload: event,
        tabId: this.tabId,
        timestamp: Date.now(),
      });
    }
  }

  invalidateCache(keys: string[]) {
    this.send({
      type: 'CACHE_INVALIDATE',
      payload: { keys },
      tabId: this.tabId,
      timestamp: Date.now(),
    });
  }

  private send(message: SyncMessage) {
    if (this.channel) {
      this.channel.postMessage(message);
    } else {
      localStorage.setItem('sorotask_sync', JSON.stringify(message));
      setTimeout(() => localStorage.removeItem('sorotask_sync'), 100);
    }
  }

  onState(callback: (state: any) => void) {
    this.onStateUpdate = callback;
  }

  onWSEvent(callback: (event: any) => void) {
    this.onWebSocketEvent = callback;
  }

  destroy() {
    if (this.leaderElectionTimer) {
      clearInterval(this.leaderElectionTimer);
    }
    if (this.stateUpdateTimer) {
      clearTimeout(this.stateUpdateTimer);
    }
    this.unregisterTab();
    this.channel?.close();
  }

  getTabId(): string {
    return this.tabId;
  }

  isLeaderTab(): boolean {
    return this.isLeader;
  }

  getConnectedTabs(): number {
    return this.tabs.size;
  }
}

let instance: MultiTabSyncEngine | null = null;

export function getMultiTabSync(): MultiTabSyncEngine {
  if (!instance) {
    instance = new MultiTabSyncEngine();
  }
  return instance;
}

export function useMultiTabSync() {
  const engineRef = useRef<MultiTabSyncEngine>(getMultiTabSync());
  const [isLeader, setIsLeader] = useState(engineRef.current.isLeaderTab());
  const [tabCount, setTabCount] = useState(engineRef.current.getConnectedTabs());

  useEffect(() => {
    const engine = engineRef.current;

    const checkLeader = setInterval(() => {
      setIsLeader(engine.isLeaderTab());
      setTabCount(engine.getConnectedTabs());
    }, 1000);

    return () => {
      clearInterval(checkLeader);
    };
  }, []);

  const broadcastState = useCallback((state: any) => {
    engineRef.current.broadcastStateUpdate(state);
  }, []);

  const broadcastWSEvent = useCallback((event: any) => {
    engineRef.current.broadcastWebSocketEvent(event);
  }, []);

  const invalidateCache = useCallback((keys: string[]) => {
    engineRef.current.invalidateCache(keys);
  }, []);

  return {
    isLeader,
    tabCount,
    broadcastState,
    broadcastWSEvent,
    invalidateCache,
  };
}
