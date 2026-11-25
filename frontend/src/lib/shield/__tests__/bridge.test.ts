/**
 * Tests for the worker bridge, covering both the off-main-thread path (via a
 * fake worker) and the synchronous fallback, plus crash recovery.
 */

import { createShieldBridge, workersSupported } from '../bridge';
import { handleShieldMessage } from '../shield.worker';
import { ShieldEngine } from '../engine';
import type {
  ShieldRequestMessage,
  ShieldResponseMessage,
} from '../types';

/** Minimal Worker stand-in that runs the real handler synchronously. */
class FakeWorker {
  onmessage: ((e: MessageEvent<ShieldResponseMessage>) => void) | null = null;
  onerror: ((e: { message?: string; preventDefault?: () => void }) => void) | null = null;
  terminated = false;
  private engine = new ShieldEngine();

  postMessage(message: ShieldRequestMessage) {
    const reply = handleShieldMessage(message, this.engine, 0);
    if (reply && this.onmessage) {
      this.onmessage({ data: reply } as MessageEvent<ShieldResponseMessage>);
    }
  }

  terminate() {
    this.terminated = true;
  }

  /** Test helper to simulate a worker crash. */
  crash(message = 'segfault') {
    this.onerror?.({ message, preventDefault: () => undefined });
  }
}

describe('workersSupported', () => {
  it('reflects the presence of the Worker global', () => {
    expect(workersSupported()).toBe(typeof Worker !== 'undefined');
  });
});

describe('createShieldBridge (worker path)', () => {
  it('reports off-main-thread when a worker is provided', () => {
    const bridge = createShieldBridge({ workerFactory: () => new FakeWorker() as unknown as Worker });
    expect(bridge.offMainThread).toBe(true);
    bridge.dispose();
  });

  it('emits snapshots from the worker', () => {
    const bridge = createShieldBridge({ workerFactory: () => new FakeWorker() as unknown as Worker });
    const messages: ShieldResponseMessage[] = [];
    bridge.subscribe((m) => messages.push(m));
    bridge.ingest([{ clientId: 'a', timestamp: 0 }]);
    expect(messages.some((m) => m.type === 'snapshot')).toBe(true);
    bridge.dispose();
  });

  it('forwards configuration to the worker', () => {
    const worker = new FakeWorker();
    const spy = jest.spyOn(worker, 'postMessage');
    const bridge = createShieldBridge({ workerFactory: () => worker as unknown as Worker });
    bridge.configure({ ...new ShieldEngine().getConfig(), maxRequestsPerWindow: 7 });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'configure' }),
    );
    bridge.dispose();
  });
});

describe('createShieldBridge (fallback path)', () => {
  it('falls back to the main thread when no worker can be created', () => {
    const bridge = createShieldBridge({ workerFactory: () => null });
    expect(bridge.offMainThread).toBe(false);

    const messages: ShieldResponseMessage[] = [];
    bridge.subscribe((m) => messages.push(m));
    bridge.ingest([{ clientId: 'a', timestamp: 0 }]);
    expect(messages.some((m) => m.type === 'snapshot')).toBe(true);
    bridge.dispose();
  });

  it('reset and configure work in fallback mode', () => {
    const bridge = createShieldBridge({ workerFactory: () => null });
    expect(() => {
      bridge.configure({ ...new ShieldEngine().getConfig(), maxRequestsPerWindow: 3 });
      bridge.reset();
    }).not.toThrow();
    bridge.dispose();
  });
});

describe('createShieldBridge crash recovery', () => {
  it('restarts the worker once after a crash', () => {
    const workers: FakeWorker[] = [];
    const bridge = createShieldBridge({
      workerFactory: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
    });

    const errors: string[] = [];
    bridge.subscribe((m) => {
      if (m.type === 'error') errors.push(m.message);
    });

    workers[0].crash();
    expect(errors).toHaveLength(1);
    expect(workers).toHaveLength(2); // restarted
    expect(bridge.offMainThread).toBe(true);
    bridge.dispose();
  });

  it('degrades to the main thread after a second crash', () => {
    const workers: FakeWorker[] = [];
    const bridge = createShieldBridge({
      workerFactory: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
    });
    workers[0].crash();
    workers[1].crash();
    expect(bridge.offMainThread).toBe(false);

    // Still functional via fallback.
    const messages: ShieldResponseMessage[] = [];
    bridge.subscribe((m) => messages.push(m));
    bridge.ingest([{ clientId: 'a', timestamp: 0 }]);
    expect(messages.some((m) => m.type === 'snapshot')).toBe(true);
    bridge.dispose();
  });

  it('ignores messages after dispose', () => {
    const bridge = createShieldBridge({ workerFactory: () => null });
    const messages: ShieldResponseMessage[] = [];
    bridge.subscribe((m) => messages.push(m));
    bridge.dispose();
    bridge.ingest([{ clientId: 'a', timestamp: 0 }]);
    expect(messages).toHaveLength(0);
  });

  it('unsubscribe stops delivery', () => {
    const bridge = createShieldBridge({ workerFactory: () => null });
    const messages: ShieldResponseMessage[] = [];
    const unsub = bridge.subscribe((m) => messages.push(m));
    unsub();
    bridge.ingest([{ clientId: 'a', timestamp: 0 }]);
    expect(messages).toHaveLength(0);
    bridge.dispose();
  });
});
