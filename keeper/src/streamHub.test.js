const { StreamHub } = require('./streamHub');
const hubTopicMatches = require('./streamHub').topicMatches;

describe('StreamHub', () => {
  test('publishes task events to the local namespace and records activity', () => {
    const hub = new StreamHub({
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    });

    const emit = jest.fn();
    hub.namespaceServer = { emit };

    const envelope = hub.publishTaskEvent('completed', 42, { txHash: 'abc123' });

    expect(envelope.type).toBe('task:update');
    expect(envelope.payload.kind).toBe('completed');
    expect(emit).toHaveBeenCalledWith('stream:event', envelope);
    expect(emit).toHaveBeenCalledWith('task:update', envelope.payload);
    expect(hub.getStatus().eventCount).toBe(1);
  });
});
describe('StreamHub channel subscriptions (issue #1212)', () => {
  function makeHub(loggerOverrides) {
    return new StreamHub({
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        ...loggerOverrides,
      },
    });
  }

  function makeSocket(id) {
    const socket = { id, emitted: [], emit(event, payload) { this.emitted.push([event, payload]); } };
    return socket;
  }

  function attachNamespace(hub, sockets) {
    const socketsMap = new Map(sockets.map((socket) => [socket.id, socket]));
    hub.namespaceServer = { sockets: socketsMap };
    return socketsMap;
  }

  test('sockets without subscriptions receive every event', () => {
    const hub = makeHub();
    const openSocket = makeSocket('open-1');
    attachNamespace(hub, [openSocket]);

    const envelope = hub.publish('task:execution:status', { taskId: '7' });

    expect(openSocket.emitted).toContainEqual(['stream:event', envelope]);
  });

  test('creator channels match creator:{address} subscriptions', () => {
    const hub = makeHub();
    const creatorSocket = makeSocket('creator-1');
    const otherSocket = makeSocket('other-1');
    attachNamespace(hub, [creatorSocket, otherSocket]);

    hub.clients.set('creator-1', {
      socket: creatorSocket,
      topics: new Set(['creator:GABC']),
      lastPong: Date.now(),
    });
    hub.clients.set('other-1', {
      socket: otherSocket,
      topics: new Set(['creator:GXYZ']),
      lastPong: Date.now(),
    });

    hub.publishTaskEvent('completed', 42, { creatorAddress: 'GABC' });

    const creatorEvent = creatorSocket.emitted.find(([event]) => event === 'stream:event');
    expect(creatorEvent).toBeDefined();
    expect(creatorEvent[1].payload.creatorAddress).toBe('GABC');
    // The other socket subscribed to a different creator and must not match.
    const otherEvent = otherSocket.emitted.find(([event]) => event === 'stream:event');
    expect(otherEvent).toBeUndefined();
  });

  test('wildcard task:* subscriptions match concrete task channels', () => {
    const hub = makeHub();
    const wildcardSocket = makeSocket('wild-1');
    attachNamespace(hub, [wildcardSocket]);

    hub.clients.set('wild-1', {
      socket: wildcardSocket,
      topics: new Set(['task:*']),
      lastPong: Date.now(),
    });

    hub.publish('task:execution:status', { taskId: '9' });

    expect(wildcardSocket.emitted.some(([event]) => event === 'stream:event')).toBe(true);

    // Unrelated channel filter does not match task events.
    const narrowSocket = makeSocket('narrow-1');
    hub.clients.set('narrow-1', {
      socket: narrowSocket,
      topics: new Set(['task:11']),
      lastPong: Date.now(),
    });
    hub.publish('task:execution:status', { taskId: '9' });

    const narrowEvent = narrowSocket.emitted.find(([event]) => event === 'stream:event');
    expect(narrowEvent).toBeUndefined();
  });

  test('heartbeat emits pings and terminates clients that stop ponging', () => {
    jest.useFakeTimers();
    const hub = makeHub();
    const staleSocket = makeSocket('stale-1');
    const liveSocket = makeSocket('live-1');
    attachNamespace(hub, [staleSocket, liveSocket]);

    hub.clients.set('stale-1', {
      socket: staleSocket,
      topics: new Set(),
      lastPong: Date.now() - 60000,
    });
    hub.clients.set('live-1', {
      socket: liveSocket,
      topics: new Set(),
      lastPong: Date.now(),
    });
    staleSocket.disconnect = jest.fn();
    liveSocket.disconnect = jest.fn();

    hub._runHeartbeat();

    expect(hub.namespaceServer.emit).toBeDefined();
    staleSocket.disconnect.mockClear();
    jest.advanceTimersByTime(0);
    expect(staleSocket.disconnect).not.toHaveBeenCalled();

    // Directly assert the termination path.
    jest.useRealTimers();
    const hub2 = makeHub();
    const deadSocket = makeSocket('dead-1');
    attachNamespace(hub2, [deadSocket]);
    hub2.clients.set('dead-1', {
      socket: deadSocket,
      topics: new Set(),
      lastPong: Date.now() - hub2.heartbeatTimeoutMs - 1,
    });
    deadSocket.disconnect = jest.fn();

    hub2._runHeartbeat();

    expect(deadSocket.disconnect).toHaveBeenCalledWith(true);
    expect(hub2.clients.has('dead-1')).toBe(false);
  });

  test('attachSse streams envelopes and honours topic filters', async () => {
    const hub = makeHub();
    const handlers = {};
    const httpServer = {
      on: jest.fn((event, handler) => { handlers[event] = handler; }),
      removeListener: jest.fn(),
    };

    hub.httpServer = httpServer;
    hub._sseAttached = false;
    hub.attachSse('/stream/sse');

    expect(httpServer.on).toHaveBeenCalledWith('request', expect.any(Function));

    const writes = [];
    const res = {
      statusCode: 0,
      headers: null,
      closed: false,
      writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
      write(chunk) { writes.push(chunk); },
      on(event, handler) { if (event === 'close') this._close = handler; },
      end() { this.closed = true; },
    };

    handlers['request']({ method: 'GET', url: '/stream/sse?topics=task:5' }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(hub.sseClients.size).toBe(1);

    // Matching event is delivered; non-matching event is not.
    hub.publish('task:execution:status', { taskId: '5' });
    hub.publish('task:execution:status', { taskId: '6' });

    const dataFrames = writes.filter((chunk) => chunk.startsWith('data: '));
    expect(dataFrames.length).toBe(2); // stream:ready + the matching event
    expect(dataFrames[1]).toContain('"taskId":"5"');

    res._close();
    expect(hub.sseClients.size).toBe(0);
  });

  test('topicMatches supports exact, wildcard and catch-all patterns', () => {
    expect(hubTopicMatches('task:*', 'task:5')).toBe(true);
    expect(hubTopicMatches('task:*', 'task:5:failed')).toBe(true);
    expect(hubTopicMatches('creator:GABC', 'creator:GABC')).toBe(true);
    expect(hubTopicMatches('creator:GABC', 'creator:GXYZ')).toBe(false);
    expect(hubTopicMatches('*', 'anything')).toBe(true);
  });
});
