/**
 * Rate Limiting & Anti-DDoS Shield — Web Worker entry point.
 *
 * Runs the {@link ShieldEngine} off the main thread so heavy traffic analysis
 * never blocks UI rendering. The worker is intentionally thin: all logic lives
 * in the engine so the exact same code path can run on the main thread as a
 * fallback when workers are unavailable (see `createShieldBridge`).
 */

import { ShieldEngine } from './engine';
import type { ShieldRequestMessage, ShieldResponseMessage } from './types';

const engine = new ShieldEngine();

/**
 * Process one host → worker message and return the reply (if any). Exported so
 * the fallback bridge and unit tests can exercise the exact worker behaviour
 * without spawning a real worker.
 */
export function handleShieldMessage(
  message: ShieldRequestMessage,
  workerEngine: ShieldEngine = engine,
  now: number = Date.now(),
): ShieldResponseMessage | null {
  try {
    switch (message.type) {
      case 'configure':
        workerEngine.configure(message.config);
        return null;
      case 'reset':
        workerEngine.reset();
        return null;
      case 'ingest': {
        const results = workerEngine.inspectBatch(message.events, now);
        const snapshot = workerEngine.snapshot(now);
        return { type: 'snapshot', snapshot, results };
      }
      default:
        return null;
    }
  } catch (error) {
    return {
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown shield worker error',
    };
  }
}

/**
 * Minimal structural type for the dedicated worker global. We avoid relying on
 * the DOM/WebWorker lib typings (not enabled in this tsconfig) so the module
 * type-checks in a standard Node/Next environment.
 */
interface WorkerScope {
  postMessage(message: ShieldResponseMessage): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<ShieldRequestMessage>) => void,
  ): void;
}

// Wire up the worker runtime only when executing inside an actual worker scope.
// Guarded so importing this module in jsdom/SSR is a no-op.
declare const self: WorkerScope | undefined;

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  const scope = self;
  scope.addEventListener('message', (event: MessageEvent<ShieldRequestMessage>) => {
    const reply = handleShieldMessage(event.data);
    if (reply) scope.postMessage(reply);
  });
}
