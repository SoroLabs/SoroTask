export type SubscriptionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed"
  | "error";

export interface SubgraphConfig {
  url: string;
  wsUrl: string;
  /** Optional name for logging/error context */
  name?: string;
  /** Max reconnect attempts before giving up (default: 5) */
  maxReconnectAttempts?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseReconnectDelayMs?: number;
}

export interface SubscriptionRequest<TVariables = Record<string, unknown>> {
  query: string;
  variables?: TVariables;
  operationName?: string;
}

export interface GqlMessage {
  type: string;
  id?: string;
  payload?: unknown;
}

export interface SubscriptionEntry<TData = unknown> {
  id: string;
  request: SubscriptionRequest;
  onData: (data: TData) => void;
  onError: (error: Error) => void;
  onComplete: () => void;
}

export interface SubscriptionHandle {
  unsubscribe: () => void;
}
