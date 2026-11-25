import { captureSentryException } from "@/src/lib/errors/sentry";

export interface ShortcutDefinition {
  id: string;
  combo: string;
  description: string;
}

export interface ShortcutEventPayload {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface ShortcutMatch {
  id: string;
  combo: string;
  description: string;
}

export interface ShortcutManagerOptions {
  shortcuts: ShortcutDefinition[];
  onShortcut: (shortcut: ShortcutMatch) => void;
  onError?: (error: Error) => void;
  workerScriptUrl?: string;
}

interface WorkerMessage {
  type: string;
  payload?: unknown;
}

function normalizeCombo(combo: string): string {
  return combo.trim().toLowerCase();
}

export function eventToShortcutCombo(event: ShortcutEventPayload): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.metaKey) parts.push("meta");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");

  const key = String(event.key || "").toLowerCase();
  if (key && !["control", "meta", "alt", "shift"].includes(key)) {
    parts.push(key);
  }

  return parts.join("+");
}

export function processShortcutInMainThread(
  shortcuts: ShortcutDefinition[],
  event: ShortcutEventPayload,
): ShortcutMatch | null {
  const combo = eventToShortcutCombo(event);
  const target = shortcuts.find((item) => normalizeCombo(item.combo) === combo);
  if (!target) {
    return null;
  }

  return {
    id: target.id,
    combo: normalizeCombo(target.combo),
    description: target.description,
  };
}

function parseWorkerResult(payload: unknown): ShortcutMatch | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const value = (payload as { matched?: unknown }).matched;
  if (!value || typeof value !== "object") {
    return null;
  }

  const match = value as { id?: unknown; combo?: unknown; description?: unknown };
  if (
    typeof match.id !== "string" ||
    typeof match.combo !== "string" ||
    typeof match.description !== "string"
  ) {
    return null;
  }

  return {
    id: match.id,
    combo: normalizeCombo(match.combo),
    description: match.description,
  };
}

function reportShortcutError(error: Error, onError?: (error: Error) => void) {
  captureSentryException(error, {
    section: "shortcut-manager",
  });
  onError?.(error);
}

export interface ShortcutManager {
  isWorkerBacked: boolean;
  processKeyboardEvent: (event: ShortcutEventPayload) => void;
  destroy: () => void;
}

export function createShortcutManager(options: ShortcutManagerOptions): ShortcutManager {
  const shortcuts = [...options.shortcuts];
  const workerUrl = options.workerScriptUrl ?? "/workers/shortcut-manager.worker.js";

  const dispatchMainThread = (event: ShortcutEventPayload) => {
    const match = processShortcutInMainThread(shortcuts, event);
    if (match) {
      options.onShortcut(match);
    }
  };

  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return {
      isWorkerBacked: false,
      processKeyboardEvent: dispatchMainThread,
      destroy: () => undefined,
    };
  }

  try {
    const worker = new Worker(workerUrl);

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (!message || typeof message.type !== "string") {
        return;
      }

      if (message.type === "SHORTCUT_RESULT") {
        const match = parseWorkerResult(message.payload);
        if (match) {
          options.onShortcut(match);
        }
        return;
      }

      if (message.type === "WORKER_ERROR") {
        reportShortcutError(new Error("Shortcut worker reported an error."), options.onError);
      }
    };

    worker.onerror = () => {
      reportShortcutError(new Error("Shortcut worker crashed; falling back to main thread."), options.onError);
    };

    worker.postMessage({
      type: "REGISTER_SHORTCUTS",
      payload: shortcuts,
    });

    return {
      isWorkerBacked: true,
      processKeyboardEvent: (event) => {
        try {
          worker.postMessage({
            type: "PROCESS_KEY_EVENT",
            payload: event,
          });
        } catch (error) {
          reportShortcutError(
            error instanceof Error ? error : new Error("Failed to post keyboard event to worker."),
            options.onError,
          );
          dispatchMainThread(event);
        }
      },
      destroy: () => {
        worker.terminate();
      },
    };
  } catch (error) {
    reportShortcutError(
      error instanceof Error ? error : new Error("Failed to initialize shortcut worker."),
      options.onError,
    );

    return {
      isWorkerBacked: false,
      processKeyboardEvent: dispatchMainThread,
      destroy: () => undefined,
    };
  }
}
