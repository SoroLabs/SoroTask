/**
 * Tests for the useShield hook using the main-thread fallback bridge (no real
 * worker required in jsdom).
 */

import { act, renderHook } from '@testing-library/react';
import { useShield } from '../useShield';
import type { ShieldResponseMessage, ShieldRequestMessage } from '@/src/lib/shield/types';

/** Worker stand-in that replies to every ingest with an error message. */
class ErrorWorker {
  onmessage: ((e: MessageEvent<ShieldResponseMessage>) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage(message: ShieldRequestMessage) {
    if (message.type === 'ingest') {
      this.onmessage?.({
        data: { type: 'error', message: 'simulated engine failure' },
      } as MessageEvent<ShieldResponseMessage>);
    }
  }
  terminate() {}
}

describe('useShield', () => {
  const noWorker = () => null;

  it('starts with an empty, fallback state', () => {
    const { result } = renderHook(() =>
      useShield({ workerFactory: noWorker }),
    );
    expect(result.current.snapshot).toBeNull();
    expect(result.current.history).toEqual([]);
    expect(result.current.health.offMainThread).toBe(false);
  });

  it('produces a snapshot after ingesting events', () => {
    const { result } = renderHook(() =>
      useShield({ workerFactory: noWorker }),
    );
    act(() => {
      result.current.ingest([
        { clientId: 'a', timestamp: 0 },
        { clientId: 'b', timestamp: 1 },
      ]);
    });
    expect(result.current.snapshot).not.toBeNull();
    expect(result.current.snapshot?.totalRequests).toBe(2);
    expect(result.current.health.ready).toBe(true);
    expect(result.current.history).toHaveLength(1);
  });

  it('ignores empty ingest calls', () => {
    const { result } = renderHook(() =>
      useShield({ workerFactory: noWorker }),
    );
    act(() => {
      result.current.ingest([]);
    });
    expect(result.current.snapshot).toBeNull();
  });

  it('caps history at the configured limit', () => {
    const { result } = renderHook(() =>
      useShield({ workerFactory: noWorker, historyLimit: 2 }),
    );
    act(() => result.current.ingest([{ clientId: 'a', timestamp: 0 }]));
    act(() => result.current.ingest([{ clientId: 'a', timestamp: 1 }]));
    act(() => result.current.ingest([{ clientId: 'a', timestamp: 2 }]));
    expect(result.current.history).toHaveLength(2);
  });

  it('resets snapshot and history', () => {
    const { result } = renderHook(() =>
      useShield({ workerFactory: noWorker }),
    );
    act(() => result.current.ingest([{ clientId: 'a', timestamp: 0 }]));
    act(() => result.current.reset());
    expect(result.current.snapshot).toBeNull();
    expect(result.current.history).toEqual([]);
  });

  it('does not create a bridge when disabled', () => {
    const { result } = renderHook(() =>
      useShield({ workerFactory: noWorker, enabled: false }),
    );
    act(() => result.current.ingest([{ clientId: 'a', timestamp: 0 }]));
    expect(result.current.snapshot).toBeNull();
  });

  it('tracks recovered errors surfaced by the bridge', () => {
    const { result } = renderHook(() =>
      useShield({ workerFactory: () => new ErrorWorker() as unknown as Worker }),
    );
    act(() => result.current.ingest([{ clientId: 'a', timestamp: 0 }]));
    expect(result.current.health.recoveredErrors).toBe(1);
    expect(result.current.health.lastError).toBe('simulated engine failure');
    // The dashboard stays usable; no snapshot is produced from an error.
    expect(result.current.snapshot).toBeNull();
  });

  it('merges custom config with defaults', () => {
    const { result } = renderHook(() =>
      useShield({ workerFactory: noWorker, config: { maxRequestsPerWindow: 9 } }),
    );
    expect(result.current.config.maxRequestsPerWindow).toBe(9);
    expect(result.current.config.windowMs).toBeGreaterThan(0);
  });
});
