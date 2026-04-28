"use client";

import { useSyncExternalStore } from "react";
import type { ActionQueue, QueuedAction } from "./actionQueue";

// React subscription helper. Re-renders whenever the queue notifies.
// Returns a snapshot of the current actions plus pass-through methods so
// callers don't need to thread the queue separately.
export function useActionQueue(queue: ActionQueue): {
  actions: readonly QueuedAction[];
  enqueue: ActionQueue["enqueue"];
  retry: ActionQueue["retry"];
  cancel: ActionQueue["cancel"];
  remove: ActionQueue["remove"];
  clearCompleted: ActionQueue["clearCompleted"];
} {
  const actions = useSyncExternalStore(
    (listener) => queue.subscribe(listener),
    () => queue.getActions(),
    () => queue.getActions(),
  );

  return {
    actions,
    enqueue: queue.enqueue.bind(queue),
    retry: queue.retry.bind(queue),
    cancel: queue.cancel.bind(queue),
    remove: queue.remove.bind(queue),
    clearCompleted: queue.clearCompleted.bind(queue),
  };
}
