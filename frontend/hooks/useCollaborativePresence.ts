'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export interface Collaborator {
  userId: string;
  displayName: string;
  avatarColor: string;
  focusedTaskId: string | null;
  cursorX: number;
  cursorY: number;
  updatedAt: number;
}

interface PresenceMessage {
  type: 'join' | 'leave' | 'cursor' | 'focus' | 'snapshot';
  userId: string;
  displayName?: string;
  avatarColor?: string;
  focusedTaskId?: string | null;
  cursorX?: number;
  cursorY?: number;
  peers?: Collaborator[];
}

const AVATAR_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

function pickColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function generateUserId(): string {
  return `user-${Math.random().toString(36).slice(2, 9)}`;
}

function generateDisplayName(): string {
  const adjectives = ['Swift', 'Bright', 'Calm', 'Bold', 'Keen'];
  const nouns = ['Falcon', 'Nova', 'Reef', 'Crest', 'Tide'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj} ${noun}`;
}

/**
 * useCollaborativePresence
 *
 * Manages WebSocket-based real-time presence for the task board.
 * Broadcasts cursor positions and task focus state to all connected peers.
 * Falls back gracefully when the WebSocket server is unavailable.
 *
 * @param wsUrl - WebSocket endpoint, e.g. 'ws://localhost:4001/presence'
 * @param boardRef - ref to the board container element (for relative cursor coords)
 */
export function useCollaborativePresence(
  wsUrl: string,
  boardRef: React.RefObject<HTMLElement | null>
) {
  const [collaborators, setCollaborators] = useState<Map<string, Collaborator>>(new Map());
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const selfRef = useRef<{ userId: string; displayName: string; avatarColor: string }>({
    userId: generateUserId(),
    displayName: generateDisplayName(),
    avatarColor: '',
  });
  selfRef.current.avatarColor = pickColor(selfRef.current.userId);

  const send = useCallback((msg: PresenceMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // Broadcast this user's cursor position (throttled to ~20fps via requestAnimationFrame)
  const rafId = useRef<number | null>(null);
  const pendingCursor = useRef<{ x: number; y: number } | null>(null);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!boardRef.current) return;
      const rect = boardRef.current.getBoundingClientRect();
      pendingCursor.current = {
        x: Math.round(e.clientX - rect.left),
        y: Math.round(e.clientY - rect.top),
      };

      if (rafId.current !== null) return;
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        if (!pendingCursor.current) return;
        const { x, y } = pendingCursor.current;
        send({
          type: 'cursor',
          userId: selfRef.current.userId,
          cursorX: x,
          cursorY: y,
        });
        pendingCursor.current = null;
      });
    },
    [boardRef, send]
  );

  // Broadcast task focus
  const setFocusedTask = useCallback(
    (taskId: string | null) => {
      send({
        type: 'focus',
        userId: selfRef.current.userId,
        focusedTaskId: taskId,
      });
    },
    [send]
  );

  // Connect / reconnect
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        // WebSocket not available (SSR or invalid URL) — skip silently
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (destroyed) { ws.close(); return; }
        setConnected(true);
        send({
          type: 'join',
          userId: selfRef.current.userId,
          displayName: selfRef.current.displayName,
          avatarColor: selfRef.current.avatarColor,
        });
      };

      ws.onmessage = (event) => {
        try {
          const msg: PresenceMessage = JSON.parse(event.data as string);
          const self = selfRef.current.userId;

          setCollaborators((prev) => {
            const next = new Map(prev);

            if (msg.type === 'snapshot' && msg.peers) {
              for (const peer of msg.peers) {
                if (peer.userId !== self) next.set(peer.userId, peer);
              }
              return next;
            }

            if (msg.userId === self) return next; // ignore own echoes

            if (msg.type === 'leave') {
              next.delete(msg.userId);
              return next;
            }

            const existing: Collaborator = next.get(msg.userId) ?? {
              userId: msg.userId,
              displayName: msg.displayName ?? msg.userId,
              avatarColor: msg.avatarColor ?? pickColor(msg.userId),
              focusedTaskId: null,
              cursorX: 0,
              cursorY: 0,
              updatedAt: Date.now(),
            };

            next.set(msg.userId, {
              ...existing,
              ...(msg.displayName && { displayName: msg.displayName }),
              ...(msg.avatarColor && { avatarColor: msg.avatarColor }),
              ...(msg.type === 'cursor' && { cursorX: msg.cursorX ?? existing.cursorX, cursorY: msg.cursorY ?? existing.cursorY }),
              ...(msg.type === 'focus' && { focusedTaskId: msg.focusedTaskId ?? null }),
              updatedAt: Date.now(),
            });
            return next;
          });
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (!destroyed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        // onclose fires after onerror — reconnect handled there
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null; // prevent reconnect on intentional unmount
        ws.close();
      }
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  // Mouse tracking on board element
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    el.addEventListener('mousemove', handleMouseMove);
    return () => el.removeEventListener('mousemove', handleMouseMove);
  }, [boardRef, handleMouseMove]);

  // Broadcast leave on unload
  useEffect(() => {
    const onUnload = () => send({ type: 'leave', userId: selfRef.current.userId });
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [send]);

  return {
    collaborators: Array.from(collaborators.values()),
    connected,
    selfId: selfRef.current.userId,
    setFocusedTask,
  };
}
