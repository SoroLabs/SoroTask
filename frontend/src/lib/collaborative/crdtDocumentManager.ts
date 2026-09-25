/**
 * CRDT Document Manager using Yjs
 * Handles operational transformation and conflict resolution for collaborative editing
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type {
  CollaborativeOptions,
  CollaborativeState,
  CollaborativeUser,
  CollaborativeOperation,
  EditConflict,
  CollaborativeEvent,
  CollaborativeEventType,
} from './types';

import { Awareness } from 'y-protocols/awareness';

type EventListener = (event: CollaborativeEvent) => void;

/**
 * Manages a Yjs document for collaborative editing
 */
export class CRDTDocumentManager {
  private ydoc: Y.Doc;
  private provider: WebsocketProvider | null = null;
  private taskId: string;
  private userId: string;
  private userName: string;
  private connectionStatus: 'connected' | 'disconnected' | 'syncing' = 'disconnected';
  private activeUsers: Map<string, CollaborativeUser> = new Map();
  private conflicts: Map<string, EditConflict> = new Map();
  private operations: CollaborativeOperation[] = [];
  private eventListeners: Map<CollaborativeEventType, Set<EventListener>> = new Map();
  private reconnectAttempts: number = 0;
  private maxRetries: number = 3;
  private reconnectTimeout: number = 5000;
  private serverUrl: string;
  private conflictResolutionStrategy: 'last-write-wins' | 'crdt' | 'manual' = 'crdt';
  private enablePersistence: boolean = false;
  private ymap: Y.Map<any>;
  private yarray: Y.Array<any>;
  private awareness: Awareness;
  private avatarUrl?: string;
  /** This client's colour, fixed for the session so peers see it stay put. */
  private localColor: string;

  constructor(options: CollaborativeOptions) {
    this.taskId = options.taskId;
    this.userId = options.userId;
    this.userName = options.userName;
    this.serverUrl = options.serverUrl;
    this.conflictResolutionStrategy = options.conflictResolutionStrategy || 'crdt';
    this.enablePersistence = options.enablePersistence ?? true;
    this.maxRetries = options.maxRetries ?? 3;
    this.reconnectTimeout = options.reconnectTimeout ?? 5000;

    // Initialize Yjs document
    this.ydoc = new Y.Doc();
    this.ymap = this.ydoc.getMap(`task-${this.taskId}`);
    this.yarray = this.ydoc.getArray(`task-${this.taskId}-history`);
    this.awareness = new Awareness(this.ydoc);
    this.avatarUrl = options.avatarUrl;
    this.localColor = this.getRandomColor();

    // Publish our own presence. The awareness listener below only ever *reads*
    // peers' states; without a local state of our own we are invisible to
    // everyone else, so the avatar row stays empty for all participants no
    // matter how many are connected (Issue #1255).
    this.publishPresence();

    // Set up event listeners for document changes
    this.setupDocumentListeners();

    if (options.autoConnect ?? true) {
      this.connect();
    }
  }

  /**
   * Connect to the collaborative server
   */
  public connect(): void {
    if (this.connectionStatus === 'connected' || this.connectionStatus === 'syncing') {
      return;
    }

    this.connectionStatus = 'syncing';
    this.emit('sync', { status: 'syncing' });

    try {
      const url = new URL(this.serverUrl);
      const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${url.host}${url.pathname}`;

      this.provider = new WebsocketProvider(
        wsUrl,
        `task-${this.taskId}`,
        this.ydoc,
        {
          connect: true,
          awareness: this.awareness,
          resyncInterval: 5000,
        }
      );

      this.setupProviderListeners();
      this.reconnectAttempts = 0;
    } catch (error) {
      this.handleConnectionError(error);
    }
  }

  /**
   * Disconnect from the collaborative server
   */
  public disconnect(): void {
    // Drop our presence before tearing the provider down, so peers remove our
    // avatar immediately rather than waiting for an awareness timeout.
    try {
      this.awareness.setLocalState(null);
    } catch {
      // Awareness may already be destroyed; disconnecting must still succeed.
    }

    if (this.provider) {
      this.provider.destroy();
      this.provider = null;
    }
    this.connectionStatus = 'disconnected';
    this.emit('disconnected', { taskId: this.taskId });
  }

  /**
   * Set up listeners for document changes
   */
  private setupDocumentListeners(): void {
    this.ymap.observe((event) => {
      event.keysChanged.forEach((key) => {
        const change = event.changes.keys.get(key);
        if (change) {
          const operation: CollaborativeOperation = {
            id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            userId: this.userId,
            timestamp: Date.now(),
            type: change.action === 'add' || change.action === 'update' ? 'update' : 'delete',
            path: [key],
            value: this.ymap.get(key),
            oldValue: change.oldValue,
            resolved: true,
          };

          this.operations.push(operation);
          this.emit('operation', operation);
        }
      });
    });

    this.yarray.observe((event) => {
      event.changes.added.forEach((item) => {
        const operation: CollaborativeOperation = {
          id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          userId: (item.content as any).getUser?.() ?? this.userId,
          timestamp: Date.now(),
          type: 'insert',
          path: ['history', this.yarray.toArray().indexOf(item.content).toString()],
          value: item.content,
          resolved: true,
        };

        this.operations.push(operation);
        this.emit('operation', operation);
      });
    });
  }

  /**
   * Set up listeners for provider events
   */
  private setupProviderListeners(): void {
    if (!this.provider) return;

    this.provider.on('status', ({ status }: { status: 'connecting' | 'connected' | 'disconnected' }) => {
      this.connectionStatus = status === 'connected' ? 'connected' : 'disconnected';
      this.emit(status === 'connected' ? 'connected' : 'disconnected', {
        taskId: this.taskId,
      });
    });

    this.provider.on('sync', (synced: boolean) => {
      if (synced) {
        this.connectionStatus = 'connected';
        // Re-announce after a sync: a reconnect gives us a fresh client id, and
        // peers that joined while we were away have never seen our state.
        this.publishPresence();
        this.emit('sync', { synced: true });
      }
    });

    // Handle awareness updates (remote users)
    this.awareness.on('change', (changes: { added: number[], updated: number[], removed: number[] }) => {
      const allClients = [...changes.added, ...changes.updated];
      allClients.forEach((clientId) => {
        const state = this.awareness.getStates().get(clientId) as any;
        if (state && state.user) {
          const user: CollaborativeUser = {
            clientId: clientId.toString(),
            userId: state.user.userId ?? '',
            userName: state.user.userName ?? 'Anonymous',
            avatarUrl: state.user.avatarUrl,
            color: state.user.color ?? this.getRandomColor(),
            cursor: state.user.cursor,
            lastActive: Date.now(),
          };

          if (state.user.userId === this.userId) {
            return; // Don't track ourselves
          }

          this.activeUsers.set(user.clientId, user);
          this.emit('userJoined', user);
        }
      });
      changes.removed.forEach((clientId) => {
        const clientIdStr = clientId.toString();
        const user = this.activeUsers.get(clientIdStr);
        if (user) {
          this.activeUsers.delete(clientIdStr);
          // @ts-ignore
          this.emit('userLeft', { userId: user.userId });
        }
      });
    });
  }

  /**
   * Handle connection errors with exponential backoff
   */
  private handleConnectionError(error: any): void {
    console.error('Collaborative connection error:', error);

    if (this.reconnectAttempts < this.maxRetries) {
      this.reconnectAttempts++;
      const backoffTime = this.reconnectTimeout * Math.pow(2, this.reconnectAttempts - 1);
      
      this.emit('error', {
        message: `Connection failed. Retrying in ${backoffTime}ms...`,
        error,
        attempt: this.reconnectAttempts,
        maxRetries: this.maxRetries,
      });

      setTimeout(() => this.connect(), backoffTime);
    } else {
      this.connectionStatus = 'disconnected';
      this.emit('error', {
        message: 'Failed to connect after maximum retries',
        error,
        attempt: this.reconnectAttempts,
        maxRetries: this.maxRetries,
      });
    }
  }

  /**
   * Writes this client's presence into the awareness protocol.
   *
   * Called on connect and on every cursor move. Awareness state is ephemeral
   * and per-connection — it is not part of the CRDT document and is dropped
   * when this client goes away, which is exactly what presence should do.
   */
  private publishPresence(cursor?: CollaborativeUser['cursor']): void {
    this.awareness.setLocalStateField('user', {
      userId: this.userId,
      userName: this.userName,
      avatarUrl: this.avatarUrl,
      color: this.localColor,
      cursor,
      lastActive: Date.now(),
    });
  }

  /**
   * Broadcasts this client's caret position so peers can render it
   * (Issue #1255).
   *
   * `CollaborativeUser.cursor` was already read out of peers' awareness state,
   * but nothing could ever set it — multi-cursor was declared in the types and
   * absent from the implementation.
   *
   * Pass `undefined` when the field loses focus, so a stale caret does not sit
   * on screen pointing at where someone used to be.
   */
  public updateCursor(cursor?: { line: number; column: number }): void {
    this.publishPresence(cursor);
  }

  /** Peers' current carets, excluding our own. */
  public getRemoteCursors(): CollaborativeUser[] {
    return Array.from(this.activeUsers.values()).filter((user) => user.cursor);
  }

  /**
   * The shared text handle for a free-text field (Issue #1255).
   *
   * Text fields go through `Y.Text`, not `Y.Map`. A map entry is
   * last-write-wins per key: two people typing in the same description
   * overwrite each other wholesale, which is the exact complaint in this
   * issue. `Y.Text` merges at character level, so concurrent typing
   * interleaves instead of clobbering.
   *
   * Use this for `description` and any other prose field;
   * {@link updateField} stays correct for scalars like status or due date,
   * where last-write-wins is the behaviour you actually want.
   */
  public getSharedText(field: string): Y.Text {
    return this.ydoc.getText(`task-${this.taskId}-text-${field}`);
  }

  /** Current value of a shared text field. */
  public getSharedTextValue(field: string): string {
    return this.getSharedText(field).toString();
  }

  /**
   * Applies a plain-string edit to a shared text field as a minimal diff.
   *
   * A controlled React input hands back the whole new string on every
   * keystroke. Replacing the `Y.Text` wholesale would delete and re-insert
   * every character, destroying peers' concurrent edits and their cursor
   * positions — the very thing `Y.Text` exists to avoid. So this narrows the
   * change to the common prefix and suffix first and edits only the middle.
   */
  public setSharedText(field: string, next: string): void {
    const ytext = this.getSharedText(field);
    const current = ytext.toString();
    if (current === next) return;

    let start = 0;
    const maxStart = Math.min(current.length, next.length);
    while (start < maxStart && current[start] === next[start]) start += 1;

    let end = 0;
    const maxEnd = Math.min(current.length - start, next.length - start);
    while (
      end < maxEnd &&
      current[current.length - 1 - end] === next[next.length - 1 - end]
    ) {
      end += 1;
    }

    const removeCount = current.length - start - end;
    const insertText = next.slice(start, next.length - end);

    // One transaction so peers observe a single coherent change rather than a
    // delete followed by an insert.
    this.ydoc.transact(() => {
      if (removeCount > 0) ytext.delete(start, removeCount);
      if (insertText.length > 0) ytext.insert(start, insertText);
    });
  }

  /** Subscribes to remote changes on a shared text field. */
  public observeSharedText(field: string, listener: (value: string) => void): () => void {
    const ytext = this.getSharedText(field);
    const handler = () => listener(ytext.toString());
    ytext.observe(handler);
    return () => ytext.unobserve(handler);
  }

  /**
   * Update a field in the task
   */
  public updateField(path: string[], value: any): void {
    if (path.length === 0) return;

    if (path.length === 1) {
      this.ymap.set(path[0], value);
      return;
    }

    // Nested writes are rebuilt and re-`set` on the root key rather than
    // mutated in place. `ymap.get` returns a plain JS object; mutating it and
    // walking away means Yjs never observes the change, so it is neither
    // broadcast to peers nor persisted — the edit silently vanishes on
    // reload (Issue #1255).
    const root = path[0];
    const existing = this.ymap.get(root);
    const next =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, any>) }
        : {};

    let cursor: Record<string, any> = next;
    for (let i = 1; i < path.length - 1; i++) {
      const segment = path[i];
      const child = cursor[segment];
      // Copy each level on the way down, so the object handed to `set` shares
      // no references with the one still sitting in the map.
      cursor[segment] =
        child && typeof child === 'object' && !Array.isArray(child) ? { ...child } : {};
      cursor = cursor[segment];
    }

    cursor[path[path.length - 1]] = value;
    this.ymap.set(root, next);
  }

  /**
   * Get a field from the task
   */
  public getField(path: string[]): any {
    if (path.length === 1) {
      return this.ymap.get(path[0]);
    }

    let obj = this.ymap.get(path[0]);
    for (let i = 1; i < path.length; i++) {
      obj = obj?.[path[i]];
    }
    return obj;
  }

  /**
   * Get the current state
   */
  public getState(): CollaborativeState {
    return {
      taskId: this.taskId,
      isCollaborative: this.connectionStatus === 'connected',
      activeUsers: Array.from(this.activeUsers.values()),
      conflictCount: this.conflicts.size,
      lastSyncTime: Date.now(),
      connectionStatus: this.connectionStatus,
    };
  }

  /**
   * Get operation history
   */
  public getOperationHistory(): CollaborativeOperation[] {
    return [...this.operations];
  }

  /**
   * Resolve a conflict
   */
  public resolveConflict(conflictId: string, resolution: 'local' | 'remote' | 'merged'): void {
    const conflict = this.conflicts.get(conflictId);
    if (conflict) {
      conflict.resolved = true;
      conflict.resolution = resolution;

      if (resolution === 'local') {
        this.updateField(conflict.fieldPath, conflict.localValue);
      } else if (resolution === 'remote') {
        this.updateField(conflict.fieldPath, conflict.remoteValue);
      }
    }
  }

  /**
   * Register an event listener
   */
  public on(eventType: CollaborativeEventType, listener: EventListener): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(listener);

    // Return unsubscribe function
    return () => {
      const listeners = this.eventListeners.get(eventType);
      if (listeners) {
        listeners.delete(listener);
      }
    };
  }

  /**
   * Emit an event
   */
  private emit(eventType: CollaborativeEventType, data?: any): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      const event: CollaborativeEvent = {
        type: eventType,
        timestamp: Date.now(),
        data,
      };
      listeners.forEach((listener) => listener(event));
    }
  }

  /**
   * Get a random color for user cursor
   */
  private getRandomColor(): string {
    const colors = [
      '#FF6B6B',
      '#4ECDC4',
      '#45B7D1',
      '#FFA07A',
      '#98D8C8',
      '#F7DC6F',
      '#BB8FCE',
      '#85C1E2',
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  /**
   * Get the Yjs document (for advanced use cases)
   */
  public getYDoc(): Y.Doc {
    return this.ydoc;
  }

  /**
   * Get the shared map (for advanced use cases)
   */
  public getYMap(): Y.Map<any> {
    return this.ymap;
  }

  /**
   * Destroy the document manager
   */
  public destroy(): void {
    this.disconnect();
    this.ydoc.destroy();
  }
}
