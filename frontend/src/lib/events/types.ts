export type EventType = string;

export interface DomainEvent<TPayload = unknown> {
  id: string;
  type: EventType;
  payload: TPayload;
  aggregateId: string;
  /** ISO-8601 timestamp */
  occurredAt: string;
  version: number;
}

export type Reducer<TState, TPayload = unknown> = (
  state: TState,
  event: DomainEvent<TPayload>
) => TState;

export type EventReducerMap<TState> = Partial<
  Record<EventType, Reducer<TState>>
>;

export interface HydrationResult<TState> {
  state: TState;
  appliedCount: number;
  lastVersion: number;
}

export interface HydrationOptions {
  /** Apply only events at or after this version (inclusive). Defaults to 0. */
  fromVersion?: number;
}
