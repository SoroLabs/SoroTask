/**
 * Rate Limiting & Anti-DDoS Shield — Worker Bridge.
 *
 * Provides a uniform, resilient interface to the shield engine regardless of
 * whether a real Web Worker is available. The bridge:
 *  - Spawns a dedicated worker when the environment supports it.
 *  - Transparently falls back to a synchronous main-thread engine when workers
 *    are unavailable (SSR, jsdom, unsupported browsers).
 *  - Recovers from worker crashes by restarting once, then degrading to the
 *    main-thread fallback so the dashboard never goes dark.
 */

import { ShieldEngine } from './engine';
import { handleShieldMessage } from './shield.worker';
import type {
  RequestEvent,
  ShieldConfig,
  ShieldResponseMessage,
} from './types';

export interface ShieldBridge {
  /** True when analysis is running off the main thread. */
  readonly offMainThread: boolean;
  /** Push the latest configuration to the engine. */
  configure(config: ShieldConfig): void;
  /** Submit a batch of request events for inspection. */
  ingest(events: RequestEvent[]): void;
  /** Clear all engine state. */
  reset(): void;
  /** Register the snapshot/result listener. Returns an unsubscribe function. */
  subscribe(listener: (message: ShieldResponseMessage) => void): () => void;
  /** Tear down the worker and listeners. */
  dispose(): void;
}

export interface BridgeOptions {
  config?: ShieldConfig;
  /**
   * Factory that builds the Worker. Injected for testability; defaults to the
   * real bundled worker. Returning `null` forces the main-thread fallback.
   */
  workerFactory?: () => Worker | null;
}

/** Detect whether a usable Worker constructor exists in this environment. */
export function workersSupported(): boolean {
  return typeof Worker !== 'undefined';
}

/** Default factory wiring the bundled worker module via Next/webpack. */
function defaultWorkerFactory(): Worker | null {
  if (!workersSupported()) return null;
  try {
    // `new URL(..., import.meta.url)` is the bundler-friendly worker pattern.
    return new Worker(new URL('./shield.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return null;
  }
}

/**
 * Create a shield bridge. Always succeeds: if a worker cannot be created it
 * returns a main-thread implementation with identical semantics.
 */
export function createShieldBridge(options: BridgeOptions = {}): ShieldBridge {
  const factory = options.workerFactory ?? defaultWorkerFactory;
  const listeners = new Set<(message: ShieldResponseMessage) => void>();

  let worker: Worker | null = null;
  let fallbackEngine: ShieldEngine | null = null;
  let restarts = 0;
  let disposed = false;
  let config = options.config;

  const emit = (message: ShieldResponseMessage) => {
    for (const listener of listeners) listener(message);
  };

  const useFallback = () => {
    worker = null;
    if (!fallbackEngine) {
      fallbackEngine = new ShieldEngine(config);
    } else if (config) {
      fallbackEngine.configure(config);
    }
  };

  const attachWorker = (instance: Worker) => {
    instance.onmessage = (event: MessageEvent<ShieldResponseMessage>) => {
      emit(event.data);
    };
    instance.onerror = (event) => {
      // Prevent the default crash logging from leaking to the console twice.
      event.preventDefault?.();
      emit({
        type: 'error',
        message: `Shield worker crashed: ${event.message ?? 'unknown error'}`,
      });
      instance.terminate();
      if (disposed) return;
      // Recover once by restarting; thereafter degrade to the main thread.
      if (restarts === 0) {
        restarts += 1;
        spawn();
      } else {
        useFallback();
      }
    };
  };

  const spawn = () => {
    const instance = factory();
    if (!instance) {
      useFallback();
      return;
    }
    worker = instance;
    attachWorker(instance);
    if (config) instance.postMessage({ type: 'configure', config });
  };

  // Initial wiring.
  spawn();

  const post = (message: Parameters<typeof handleShieldMessage>[0]) => {
    if (disposed) return;
    if (worker) {
      worker.postMessage(message);
      return;
    }
    if (!fallbackEngine) useFallback();
    const reply = handleShieldMessage(message, fallbackEngine!);
    if (reply) emit(reply);
  };

  return {
    get offMainThread() {
      return worker !== null;
    },
    configure(next: ShieldConfig) {
      config = next;
      post({ type: 'configure', config: next });
    },
    ingest(events: RequestEvent[]) {
      post({ type: 'ingest', events });
    },
    reset() {
      post({ type: 'reset' });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
      worker?.terminate();
      worker = null;
      fallbackEngine = null;
    },
  };
}
