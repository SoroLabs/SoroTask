// Persisted queue for deferred user actions.
//
// Designed for *writes* the user initiated while offline (or while a
// network call was failing). Reads are explicitly out of scope — the
// caller should fetch fresh data on reconnect rather than relying on
// cached responses.
//
// The queue is generic. Each action carries a `type` discriminator and
// a JSON-serializable `payload`. Callers register a handler per type;
// the queue invokes the handler when it is time to dispatch the action,
// and decides retry / failure based on whether the handler resolves or
// rejects. The handler itself owns whatever real-world side effect the
// action represents (e.g. submitting a transaction).
//
// Persistence is via `localStorage`, keyed by the configured
// `storageKey`. A reload restores the queue exactly as it was, except
// that any actions left in the `in_flight` state are demoted back to
// `pending` (we cannot know whether the prior tab succeeded). Idempotency
// is the caller's responsibility — see the spike doc.

export type ActionStatus =
  | "pending"
  | "in_flight"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface QueuedAction<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  status: ActionStatus;
  enqueuedAt: number;
  attempts: number;
  // Human-readable error from the handler's last rejection. Never the
  // raw Error object — the queue is JSON-persisted.
  lastError?: string;
  // Earliest time a retry should be attempted. Compared against
  // Date.now() during flush.
  nextAttemptAt?: number;
}

export type ActionHandler<TPayload = unknown> = (
  action: QueuedAction<TPayload>,
) => Promise<void>;

export interface ActionQueueOptions {
  storageKey: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  // Override Date.now and setTimeout for testing.
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => void;
  // Override storage for testing or SSR. Defaults to window.localStorage.
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
}

const DEFAULT_OPTIONS = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

function getDefaultStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function generateId(): string {
  // crypto.randomUUID is available in modern browsers and Node 19+. Fall
  // back to a timestamp+random combo so unit tests in older environments
  // and SSR contexts still work.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class ActionQueue {
  private actions: QueuedAction[] = [];
  private handlers = new Map<string, ActionHandler>();
  private listeners = new Set<() => void>();
  private online = false;
  private storage: Pick<Storage, "getItem" | "setItem"> | null;
  private readonly opts: Required<
    Pick<ActionQueueOptions, "maxAttempts" | "baseDelayMs" | "maxDelayMs">
  > &
    Pick<ActionQueueOptions, "storageKey">;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => void;

  constructor(options: ActionQueueOptions) {
    this.opts = {
      storageKey: options.storageKey,
      maxAttempts: options.maxAttempts ?? DEFAULT_OPTIONS.maxAttempts,
      baseDelayMs: options.baseDelayMs ?? DEFAULT_OPTIONS.baseDelayMs,
      maxDelayMs: options.maxDelayMs ?? DEFAULT_OPTIONS.maxDelayMs,
    };
    this.storage =
      options.storage === undefined ? getDefaultStorage() : options.storage;
    this.now = options.now ?? (() => Date.now());
    this.schedule =
      options.schedule ??
      ((fn, ms) => {
        if (typeof window !== "undefined") window.setTimeout(fn, ms);
        else setTimeout(fn, ms);
      });
    this.load();
  }

  // --- Public API -------------------------------------------------------

  registerHandler<TPayload>(
    type: string,
    handler: ActionHandler<TPayload>,
  ): void {
    this.handlers.set(type, handler as ActionHandler);
  }

  enqueue<TPayload>(type: string, payload: TPayload): QueuedAction<TPayload> {
    const action: QueuedAction<TPayload> = {
      id: generateId(),
      type,
      payload,
      status: "pending",
      enqueuedAt: this.now(),
      attempts: 0,
    };
    this.actions = [...this.actions, action];
    this.persist();
    this.notify();
    if (this.online) void this.flush();
    return action;
  }

  cancel(id: string): void {
    const action = this.actions.find((a) => a.id === id);
    if (!action) return;
    if (action.status === "in_flight" || action.status === "succeeded") return;
    this.replace(id, { status: "cancelled" });
  }

  retry(id: string): void {
    const action = this.actions.find((a) => a.id === id);
    if (!action) return;
    if (action.status !== "failed") return;
    this.replace(id, {
      status: "pending",
      attempts: 0,
      lastError: undefined,
      nextAttemptAt: undefined,
    });
    if (this.online) void this.flush();
  }

  remove(id: string): void {
    const before = this.actions.length;
    this.actions = this.actions.filter((a) => a.id !== id);
    if (this.actions.length !== before) {
      this.persist();
      this.notify();
    }
  }

  clearCompleted(): void {
    const before = this.actions.length;
    this.actions = this.actions.filter(
      (a) => a.status !== "succeeded" && a.status !== "cancelled",
    );
    if (this.actions.length !== before) {
      this.persist();
      this.notify();
    }
  }

  setOnline(online: boolean): void {
    if (this.online === online) return;
    this.online = online;
    if (online) void this.flush();
  }

  getActions(): readonly QueuedAction[] {
    return this.actions;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Drain pending actions that are eligible (nextAttemptAt has elapsed).
  // Public so callers can force a flush on a manual "Retry now" button
  // without flipping online state.
  async flush(): Promise<void> {
    if (!this.online) return;
    const now = this.now();
    const ready = this.actions.filter(
      (a) =>
        a.status === "pending" &&
        (a.nextAttemptAt === undefined || a.nextAttemptAt <= now),
    );
    for (const action of ready) {
      // Re-check status — earlier dispatches in this loop may have
      // updated the queue (e.g. cancellation between iterations).
      if (action.status !== "pending") continue;
      await this.dispatch(action);
    }
  }

  // --- Internals --------------------------------------------------------

  private async dispatch(action: QueuedAction): Promise<void> {
    const handler = this.handlers.get(action.type);
    if (!handler) {
      this.replace(action.id, {
        status: "failed",
        lastError: `No handler registered for type "${action.type}"`,
      });
      return;
    }

    const startedAttempts = action.attempts + 1;
    this.replace(action.id, {
      status: "in_flight",
      attempts: startedAttempts,
    });
    const dispatched = this.actions.find((a) => a.id === action.id);
    if (!dispatched) return; // cancelled/removed during state update — bail

    try {
      await handler(dispatched);
      this.replace(action.id, {
        status: "succeeded",
        lastError: undefined,
        nextAttemptAt: undefined,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err ?? "unknown error");
      if (startedAttempts >= this.opts.maxAttempts) {
        this.replace(action.id, {
          status: "failed",
          lastError: message,
          nextAttemptAt: undefined,
        });
        return;
      }
      const delay = this.backoff(startedAttempts);
      this.replace(action.id, {
        status: "pending",
        lastError: message,
        nextAttemptAt: this.now() + delay,
      });
      this.schedule(() => {
        void this.flush();
      }, delay);
    }
  }

  private replace(id: string, patch: Partial<QueuedAction>): void {
    let changed = false;
    this.actions = this.actions.map((a) => {
      if (a.id !== id) return a;
      changed = true;
      return { ...a, ...patch } as QueuedAction;
    });
    if (changed) {
      this.persist();
      this.notify();
    }
  }

  private backoff(attempt: number): number {
    const exp = this.opts.baseDelayMs * Math.pow(2, attempt - 1);
    return Math.min(exp, this.opts.maxDelayMs);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.opts.storageKey, JSON.stringify(this.actions));
    } catch {
      // Storage quota errors are silent on write — the queue still works
      // in memory; persistence is best-effort.
    }
  }

  private load(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(this.opts.storageKey);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      this.actions = parsed
        .filter(
          (a): a is QueuedAction =>
            a &&
            typeof a === "object" &&
            typeof a.id === "string" &&
            typeof a.type === "string",
        )
        // A previous tab may have crashed mid-dispatch. We can't trust
        // an in_flight status across reloads — demote to pending so it
        // gets retried once handlers are registered.
        .map((a) => (a.status === "in_flight" ? { ...a, status: "pending" as ActionStatus } : a));
    } catch {
      // Corrupted blob — start fresh rather than throwing.
      this.actions = [];
    }
  }
}

export function createActionQueue(options: ActionQueueOptions): ActionQueue {
  return new ActionQueue(options);
}
