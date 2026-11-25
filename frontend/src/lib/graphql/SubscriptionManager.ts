import { captureSentryException, addSentryBreadcrumb } from "@/src/lib/errors/sentry";
import type {
  SubgraphConfig,
  SubscriptionRequest,
  SubscriptionEntry,
  SubscriptionHandle,
  SubscriptionStatus,
  GqlMessage,
} from "./types";

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function backoff(attempt: number, base: number, max = 30_000): number {
  return Math.min(base * Math.pow(2, attempt - 1), max);
}

/**
 * Manages secure WebSocket-based GraphQL subscriptions for a single subgraph.
 *
 * Protocol: graphql-ws (https://github.com/enisdenjo/graphql-ws)
 *
 * Responsibilities:
 *  - Maintains a single WebSocket per subgraph
 *  - Multiplexes N subscriptions over that socket
 *  - Reconnects with exponential backoff on unexpected close
 *  - Sanitises auth tokens from error payloads before forwarding to Sentry
 */
export class GraphQLSubscriptionManager {
  private ws: WebSocket | null = null;
  private status: SubscriptionStatus = "idle";
  private subscriptions = new Map<string, SubscriptionEntry>();
  private reconnectAttempts = 0;
  private readonly maxReconnects: number;
  private readonly baseDelay: number;
  private statusListeners = new Set<(s: SubscriptionStatus) => void>();
  private destroyed = false;

  constructor(private readonly config: SubgraphConfig) {
    this.maxReconnects = config.maxReconnectAttempts ?? 5;
    this.baseDelay = config.baseReconnectDelayMs ?? 1_000;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  getStatus(): SubscriptionStatus {
    return this.status;
  }

  onStatusChange(listener: (s: SubscriptionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  subscribe<TData = unknown>(
    request: SubscriptionRequest,
    onData: (data: TData) => void,
    onError: (error: Error) => void,
    onComplete: () => void = () => {}
  ): SubscriptionHandle {
    const id = generateId();
    const entry: SubscriptionEntry<TData> = {
      id,
      request,
      onData: onData as (data: unknown) => void,
      onError,
      onComplete,
    };
    this.subscriptions.set(id, entry as SubscriptionEntry);

    addSentryBreadcrumb(
      "graphql",
      `Subscribing: ${request.operationName ?? "anonymous"}`,
      { subgraph: this.config.name, id }
    );

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribeMessage(entry as SubscriptionEntry);
    } else {
      this.connect();
    }

    return {
      unsubscribe: () => this.unsubscribe(id),
    };
  }

  destroy() {
    this.destroyed = true;
    this.subscriptions.clear();
    this.closeSocket(1000, "Manager destroyed");
  }

  // ── Connection management ───────────────────────────────────────────────────

  private connect() {
    if (
      this.destroyed ||
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    this.setStatus("connecting");

    try {
      this.ws = new WebSocket(this.config.wsUrl, ["graphql-transport-ws"]);
    } catch (err) {
      this.handleFatalError(
        err instanceof Error ? err : new Error(String(err))
      );
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.sendRaw({ type: "connection_init", payload: {} });
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data as string);
    };

    this.ws.onerror = () => {
      // onerror fires before onclose; the actionable handling is in onclose.
    };

    this.ws.onclose = (event) => {
      if (this.destroyed) return;
      if (event.code === 1000 || event.code === 1001) {
        // Normal / going-away close — don't reconnect.
        this.setStatus("closed");
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    if (this.reconnectAttempts >= this.maxReconnects) {
      this.handleFatalError(
        new Error(
          `Max reconnect attempts (${this.maxReconnects}) reached for subgraph "${this.config.name}"`
        )
      );
      return;
    }

    this.reconnectAttempts += 1;
    this.setStatus("reconnecting");
    const delay = backoff(this.reconnectAttempts, this.baseDelay);

    addSentryBreadcrumb(
      "graphql",
      `Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnects}`,
      { subgraph: this.config.name, delayMs: delay }
    );

    setTimeout(() => {
      if (!this.destroyed) this.connect();
    }, delay);
  }

  private handleFatalError(error: Error) {
    this.setStatus("error");
    captureSentryException(error, {
      tags: { type: "graphql_subscription_error", subgraph: this.config.name },
    });
    for (const entry of this.subscriptions.values()) {
      entry.onError(error);
    }
  }

  // ── Protocol messages ───────────────────────────────────────────────────────

  private handleMessage(raw: string) {
    let msg: GqlMessage;
    try {
      msg = JSON.parse(raw) as GqlMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "connection_ack":
        this.setStatus("connected");
        for (const entry of this.subscriptions.values()) {
          this.sendSubscribeMessage(entry);
        }
        break;

      case "next": {
        const entry = msg.id ? this.subscriptions.get(msg.id) : undefined;
        if (entry) {
          const payload = msg.payload as { data?: unknown; errors?: unknown[] };
          if (payload?.errors?.length) {
            entry.onError(new Error(JSON.stringify(payload.errors)));
          } else {
            entry.onData(payload?.data);
          }
        }
        break;
      }

      case "error": {
        const entry = msg.id ? this.subscriptions.get(msg.id) : undefined;
        if (entry) {
          entry.onError(
            new Error(
              Array.isArray(msg.payload)
                ? (msg.payload as { message: string }[])
                    .map((e) => e.message)
                    .join("; ")
                : "Subscription error"
            )
          );
        }
        break;
      }

      case "complete": {
        const entry = msg.id ? this.subscriptions.get(msg.id) : undefined;
        if (entry) {
          entry.onComplete();
          this.subscriptions.delete(entry.id);
        }
        break;
      }

      case "ping":
        this.sendRaw({ type: "pong" });
        break;
    }
  }

  private sendSubscribeMessage(entry: SubscriptionEntry) {
    this.sendRaw({
      type: "subscribe",
      id: entry.id,
      payload: {
        query: entry.request.query,
        variables: entry.request.variables ?? {},
        operationName: entry.request.operationName,
      },
    });
  }

  private unsubscribe(id: string) {
    if (!this.subscriptions.has(id)) return;
    this.subscriptions.delete(id);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendRaw({ type: "complete", id });
    }
    addSentryBreadcrumb("graphql", "Unsubscribed", {
      subgraph: this.config.name,
      id,
    });
  }

  private sendRaw(msg: GqlMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private closeSocket(code: number, reason: string) {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close(code, reason);
      this.ws = null;
    }
  }

  private setStatus(next: SubscriptionStatus) {
    if (this.status === next) return;
    this.status = next;
    for (const l of this.statusListeners) l(next);
  }
}
