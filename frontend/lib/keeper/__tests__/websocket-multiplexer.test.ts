import {
  KeeperWebSocketMultiplexer,
  type KeeperEventChannel,
} from '../service';
import type { KeeperUpdateMessage } from '@/types/keeper';

type Listener = (event?: unknown) => void;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly sent: string[] = [];
  readyState = 0;
  onopen: Listener | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: Listener | null = null;
  onclose: Listener | null = null;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emitMessage(message: KeeperUpdateMessage | string) {
    this.onmessage?.({
      data: typeof message === 'string' ? message : JSON.stringify(message),
    });
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}

const keeperMessage = (
  type: Exclude<KeeperEventChannel, 'all'>,
  keeperId = 'keeper-1',
): KeeperUpdateMessage => ({
  type,
  keeperId,
  data: {},
  timestamp: '2026-06-29T12:00:00.000Z',
});

describe('KeeperWebSocketMultiplexer', () => {
  beforeEach(() => {
    MockWebSocket.reset();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shares one websocket connection across multiple channel subscriptions', async () => {
    const multiplexer = new KeeperWebSocketMultiplexer({
      url: 'wss://keeper.example/ws',
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    const statusHandler = jest.fn();
    const metricsHandler = jest.fn();

    multiplexer.subscribe('keeper-status', statusHandler);
    multiplexer.subscribe('keeper-metrics', metricsHandler);
    const connectPromise = multiplexer.connect();
    MockWebSocket.instances[0].open();
    await connectPromise;

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].sent).toContain(
      JSON.stringify({
        type: 'subscribe',
        channels: ['keeper-status', 'keeper-metrics'],
      }),
    );
  });

  it('routes messages only to matching channel handlers and all-channel handlers', async () => {
    const multiplexer = new KeeperWebSocketMultiplexer({
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    const statusHandler = jest.fn();
    const metricsHandler = jest.fn();
    const allHandler = jest.fn();

    multiplexer.subscribe('keeper-status', statusHandler);
    multiplexer.subscribe('keeper-metrics', metricsHandler);
    multiplexer.subscribe('all', allHandler);
    const connectPromise = multiplexer.connect();
    MockWebSocket.instances[0].open();
    await connectPromise;

    const message = keeperMessage('keeper-status');
    MockWebSocket.instances[0].emitMessage(message);

    expect(statusHandler).toHaveBeenCalledWith(message);
    expect(allHandler).toHaveBeenCalledWith(message);
    expect(metricsHandler).not.toHaveBeenCalled();
  });

  it('unsubscribes handlers and sends channel cleanup when no subscribers remain', async () => {
    const multiplexer = new KeeperWebSocketMultiplexer({
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    const handler = jest.fn();
    const unsubscribe = multiplexer.subscribe('keeper-error', handler);
    const connectPromise = multiplexer.connect();
    MockWebSocket.instances[0].open();
    await connectPromise;

    unsubscribe();
    MockWebSocket.instances[0].emitMessage(keeperMessage('keeper-error'));

    expect(handler).not.toHaveBeenCalled();
    expect(MockWebSocket.instances[0].sent).toContain(
      JSON.stringify({
        type: 'unsubscribe',
        channels: ['keeper-error'],
      }),
    );
  });

  it('ignores malformed messages without breaking later valid messages', async () => {
    const multiplexer = new KeeperWebSocketMultiplexer({
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    const handler = jest.fn();
    multiplexer.subscribe('keeper-execution', handler);
    const connectPromise = multiplexer.connect();
    MockWebSocket.instances[0].open();
    await connectPromise;

    MockWebSocket.instances[0].emitMessage('{not-json');
    const message = keeperMessage('keeper-execution');
    MockWebSocket.instances[0].emitMessage(message);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(message);
  });
});
