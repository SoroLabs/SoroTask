/**
 * Execution Queue
 *
 * Specialized queue for task operations that implements retry logic,
 * persistence, and handler registration for each operation type.
 * Built on the same foundational patterns as the existing ActionQueue
 * but typed specifically for task execution operations.
 */

import { createActionQueue, ActionQueue, type QueuedAction } from "../queue/actionQueue";
import type {
  SyncOperationType,
  SyncPayload,
  QueuedSyncAction,
  TaskExecutePayload,
  TaskCancelPayload,
  TaskRegisterPayload,
  TaskUpdatePayload,
  TaskDeletePayload,
  TaskDependencyAddPayload,
  TaskDependencyRemovePayload,
  SyncConfig,
} from "../sync/types";
import { createLogger } from "../logger";

const logger = createLogger("exec-queue");

const PRIORITY_ORDER: Record<SyncOperationType, number> = {
  "task.execute": 10,
  "task.cancel": 8,
  "task.register": 7,
  "task.dependency.add": 6,
  "task.update": 5,
  "task.delete": 4,
  "task.dependency.remove": 3,
};

export class ExecutionQueueError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "ExecutionQueueError";
  }
}

export interface ExecutionQueueHandler {
  execute(p: TaskExecutePayload): Promise<unknown>;
  cancel(p: TaskCancelPayload): Promise<unknown>;
  register(p: TaskRegisterPayload): Promise<unknown>;
  update(p: TaskUpdatePayload): Promise<unknown>;
  delete(p: TaskDeletePayload): Promise<unknown>;
  addDependency(p: TaskDependencyAddPayload): Promise<unknown>;
  removeDependency(p: TaskDependencyRemovePayload): Promise<unknown>;
}

export class ExecutionQueue {
  private queue: ActionQueue;
  private handlers: ExecutionQueueHandler | null = null;

  constructor(
    handlers: ExecutionQueueHandler,
    config: Omit<SyncConfig, "rpcEndpoint"> & { rpcEndpoint?: never },
  ) {
    this.handlers = handlers;

    const queueConfig: Parameters<typeof createActionQueue>[0] = {
      storageKey: "exec-queue-" + config.storageKey,
      maxAttempts: config.maxAttempts,
      baseDelayMs: config.baseDelayMs,
      maxDelayMs: config.maxDelayMs,
    };

    this.queue = createActionQueue(queueConfig);
    this.registerAllHandlers();
  }

  private registerAllHandlers(): void {
    const handlerMap: Record<SyncOperationType, (action: QueuedAction) => Promise<void>> = {
      "task.execute": async (action) => {
        const payload = action.payload as TaskExecutePayload;
        if (!this.handlers?.execute) {
          throw new ExecutionQueueError("No execute handler registered", "HANDLER_NOT_REGISTERED", false);
        }
        await this.handlers.execute(payload);
      },
      "task.cancel": async (action) => {
        const payload = action.payload as TaskCancelPayload;
        if (!this.handlers?.cancel) {
          throw new ExecutionQueueError("No cancel handler registered", "HANDLER_NOT_REGISTERED", false);
        }
        await this.handlers.cancel(payload);
      },
      "task.register": async (action) => {
        const payload = action.payload as TaskRegisterPayload;
        if (!this.handlers?.register) {
          throw new ExecutionQueueError("No register handler registered", "HANDLER_NOT_REGISTERED", false);
        }
        await this.handlers.register(payload);
      },
      "task.update": async (action) => {
        const payload = action.payload as TaskUpdatePayload;
        if (!this.handlers?.update) {
          throw new ExecutionQueueError("No update handler registered", "HANDLER_NOT_REGISTERED", false);
        }
        await this.handlers.update(payload);
      },
      "task.delete": async (action) => {
        const payload = action.payload as TaskDeletePayload;
        if (!this.handlers?.delete) {
          throw new ExecutionQueueError("No delete handler registered", "HANDLER_NOT_REGISTERED", false);
        }
        await this.handlers.delete(payload);
      },
      "task.dependency.add": async (action) => {
        const payload = action.payload as TaskDependencyAddPayload;
        if (!this.handlers?.addDependency) {
          throw new ExecutionQueueError("No addDependency handler registered", "HANDLER_NOT_REGISTERED", false);
        }
        await this.handlers.addDependency(payload);
      },
      "task.dependency.remove": async (action) => {
        const payload = action.payload as TaskDependencyRemovePayload;
        if (!this.handlers?.removeDependency) {
          throw new ExecutionQueueError("No removeDependency handler registered", "HANDLER_NOT_REGISTERED", false);
        }
        await this.handlers.removeDependency(payload);
      },
    };

    for (const [type, handler] of Object.entries(handlerMap)) {
      this.queue.registerHandler(type, handler);
    }
  }

  enqueue(
    type: SyncOperationType,
    payload: SyncPayload,
    priority: number = PRIORITY_ORDER[type],
    online: boolean,
  ): QueuedSyncAction {
    const existing = this.queue.getActions();
    const identical = existing.find(
      (a) =>
        a.type === type &&
        JSON.stringify(a.payload) === JSON.stringify(payload) &&
        a.status === "pending",
    );
    if (identical) {
      return this.toViewAction(identical, priority);
    }

    this.queue.setOnline(online);
    this.queue.enqueue(type, payload);

    if (online) {
      void this.flush();
    }

    const [action] = this.getActions();
    return action ?? {
      id: "unknown",
      type,
      payload,
      priority,
      enqueuedAt: Date.now(),
      attempts: 0,
    };
  }

  retry(actionId: string): void {
    this.queue.retry(actionId);
  }

  cancel(actionId: string): void {
    this.queue.cancel(actionId);
  }

  clearCompleted(): void {
    this.queue.clearCompleted();
  }

  async flush(): Promise<void> {
    await this.queue.flush();
  }

  setOnline(online: boolean): void {
    this.queue.setOnline(online);
  }

  getActions(): readonly QueuedSyncAction[] {
    const rawActions = this.queue.getActions();
    return rawActions
      .map((a) => {
        const view = this.toViewAction(a, PRIORITY_ORDER[a.type as SyncOperationType] ?? 0);
        Object.defineProperty(view, 'attempts', {
          get: () => a.attempts,
          set: (v) => { a.attempts = v; }
        });
        Object.defineProperty(view, 'status', {
          get: () => a.status,
          set: (v) => { a.status = v; }
        });
        return view;
      })
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.enqueuedAt - b.enqueuedAt;
      });
  }

  remove(actionId: string): void {
    this.queue.enqueue("__remove", { id: actionId } as never);
  }

  subscribe(handler: () => void): () => void {
    return this.queue.subscribe(handler);
  }

  getMetrics() {
    const actions = this.queue.getActions();
    const now = Date.now();
    const pending = actions.filter((a) => a.status === "pending");
    const succeeded = actions.filter((a) => a.status === "succeeded");
    const failed = actions.filter((a) => a.status === "failed");

    const oldestPendingAgeMs =
      pending.length > 0 ? Math.min(...pending.map((a) => now - a.enqueuedAt)) : null;

    return {
      totalActionsProcessed: succeeded.length + failed.length,
      successfulActions: succeeded.length,
      failedActions: failed.length,
      averageLatencyMs: succeeded.length > 0
        ? succeeded.reduce((sum, a) => sum + ((a.nextAttemptAt ?? now) - a.enqueuedAt), 0) / succeeded.length
        : null,
      oldestPendingAgeMs,
    };
  }

  private toViewAction(a: QueuedAction, priority: number): QueuedSyncAction {
    const action: QueuedSyncAction = {
      id: a.id,
      type: a.type as SyncOperationType,
      payload: a.payload as QueuedSyncAction["payload"],
      priority,
      enqueuedAt: a.enqueuedAt,
      attempts: a.attempts,
      status: a.status as QueuedSyncAction["status"],
      lastError: a.lastError,
      nextAttemptAt: a.nextAttemptAt,
    };
    return action;
  }
}

export function createExecutionQueue(
  handlers: ExecutionQueueHandler,
  config?: Omit<SyncConfig, "rpcEndpoint">,
): ExecutionQueue {
  return new ExecutionQueue(handlers, (config ?? {}) as any);
}
