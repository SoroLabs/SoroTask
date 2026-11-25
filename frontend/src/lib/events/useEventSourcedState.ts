"use client";

import { useEffect, useRef, useState } from "react";
import { StateHydrator } from "./StateHydrator";
import type { DomainEvent, EventReducerMap, HydrationOptions } from "./types";

interface UseEventSourcedStateOptions<TState> {
  initialState: TState;
  reducers: EventReducerMap<TState>;
  events: DomainEvent[];
  hydrationOptions?: HydrationOptions;
}

interface UseEventSourcedStateResult<TState> {
  state: TState;
  appliedCount: number;
  lastVersion: number;
}

/**
 * Hydrates component state from a stream of domain events.
 *
 * Re-hydrates whenever the `events` array reference changes.
 * Pass reducers as a stable module-level constant to avoid unnecessary
 * re-hydrations.
 */
export function useEventSourcedState<TState>({
  initialState,
  reducers,
  events,
  hydrationOptions,
}: UseEventSourcedStateOptions<TState>): UseEventSourcedStateResult<TState> {
  const hydratorRef = useRef(new StateHydrator(reducers, initialState));

  const [result, setResult] = useState(() =>
    hydratorRef.current.hydrate(events, hydrationOptions)
  );

  useEffect(() => {
    setResult(hydratorRef.current.hydrate(events, hydrationOptions));
  }, [events, hydrationOptions]);

  return result;
}
