import type {
  DomainEvent,
  EventReducerMap,
  HydrationResult,
  HydrationOptions,
} from "./types";
import { captureSentryException } from "@/src/lib/errors/sentry";

/**
 * Replays a stream of domain events onto an initial state using registered
 * reducers, producing a fully-hydrated aggregate snapshot.
 *
 * Events whose type has no registered reducer are skipped (not an error).
 * Reducer exceptions are captured to Sentry and cause hydration to stop,
 * returning the last successfully-applied state.
 */
export class StateHydrator<TState> {
  constructor(
    private readonly reducers: EventReducerMap<TState>,
    private readonly initialState: TState
  ) {}

  hydrate(
    events: DomainEvent[],
    options: HydrationOptions = {}
  ): HydrationResult<TState> {
    const fromVersion = options.fromVersion ?? 0;
    const eligible = events
      .filter((e) => e.version >= fromVersion)
      .sort((a, b) => a.version - b.version);

    let state = this.initialState;
    let appliedCount = 0;
    let lastVersion = fromVersion - 1;

    for (const event of eligible) {
      const reducer = this.reducers[event.type];
      if (!reducer) {
        lastVersion = event.version;
        continue;
      }
      try {
        state = reducer(state, event);
        appliedCount += 1;
        lastVersion = event.version;
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error(String(err));
        captureSentryException(error, {
          tags: { type: "event_sourcing_hydration_error" },
          extra: { eventType: event.type, eventId: event.id, version: event.version },
        });
        break;
      }
    }

    return { state, appliedCount, lastVersion };
  }
}

/**
 * Convenience factory — creates a hydrator and immediately replays events.
 */
export function hydrateState<TState>(
  initialState: TState,
  reducers: EventReducerMap<TState>,
  events: DomainEvent[],
  options?: HydrationOptions
): HydrationResult<TState> {
  return new StateHydrator(reducers, initialState).hydrate(events, options);
}
