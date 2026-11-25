/**
 * Tests for the worker message handler. Exercises the exact code path the real
 * Web Worker runs, without spawning a worker.
 */

import { handleShieldMessage } from '../shield.worker';
import { ShieldEngine } from '../engine';
import type { ShieldRequestMessage } from '../types';

describe('handleShieldMessage', () => {
  it('returns null for configure and reset messages', () => {
    const engine = new ShieldEngine();
    expect(handleShieldMessage({ type: 'configure', config: engine.getConfig() }, engine)).toBeNull();
    expect(handleShieldMessage({ type: 'reset' }, engine)).toBeNull();
  });

  it('produces a snapshot response for ingest messages', () => {
    const engine = new ShieldEngine();
    const reply = handleShieldMessage(
      { type: 'ingest', events: [{ clientId: 'a', timestamp: 0 }] },
      engine,
      0,
    );
    expect(reply?.type).toBe('snapshot');
    if (reply?.type === 'snapshot') {
      expect(reply.results).toHaveLength(1);
      expect(reply.snapshot.totalRequests).toBe(1);
    }
  });

  it('applies configuration before inspecting', () => {
    const engine = new ShieldEngine();
    handleShieldMessage(
      { type: 'configure', config: { ...engine.getConfig(), maxRequestsPerWindow: 1 } },
      engine,
    );
    const reply = handleShieldMessage(
      {
        type: 'ingest',
        events: [
          { clientId: 'a', timestamp: 0 },
          { clientId: 'a', timestamp: 1 },
        ],
      },
      engine,
      2,
    );
    if (reply?.type === 'snapshot') {
      expect(reply.snapshot.blocked).toBe(1);
    }
  });

  it('returns null for unknown message types', () => {
    const engine = new ShieldEngine();
    expect(
      handleShieldMessage({ type: 'bogus' } as unknown as ShieldRequestMessage, engine),
    ).toBeNull();
  });

  it('returns an error message when the engine throws', () => {
    const engine = new ShieldEngine();
    jest.spyOn(engine, 'inspectBatch').mockImplementation(() => {
      throw new Error('boom');
    });
    const reply = handleShieldMessage({ type: 'ingest', events: [] }, engine);
    expect(reply).toEqual({ type: 'error', message: 'boom' });
  });
});
