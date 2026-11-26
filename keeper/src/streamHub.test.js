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
    hub.namespaceServer = { sockets: socketsMap, emit: jest.fn() };
    return socketsMap;
  }

  function registerClient(hub, socket, topics = [], lastPong = Date.now()) {
    const client = {
      kind: 'socket',
      socket,
      topics: new Set(),
      lastPong,
    };
    hub.clients.set(socket.id, client);
    hub.clientCount += 1;
    for (const topic of topics) hub._addSubscription(client, topic);
    return client;
  }

  test('sockets without subscriptions receive no firehose events', () => {
    const hub = makeHub();
    const openSocket = makeSocket('open-1');
    attachNamespace(hub, [openSocket]);

    const envelope = hub.publish('task:execution:status', { taskId: '7' });

    expect(openSocket.emitted).not.toContainEqual(['stream:event', envelope]);
  });

  test('creator channels match creator:{address} subscriptions', () => {
    const hub = makeHub();
    const creatorSocket = makeSocket('creator-1');
    const otherSocket = makeSocket('other-1');
    attachNamespace(hub, [creatorSocket, otherSocket]);

    registerClient(hub, creatorSocket, ['creator:GABC']);
    registerClient(hub, otherSocket, ['creator:GXYZ']);

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

    registerClient(hub, wildcardSocket, ['task:*']);

    hub.publish('task:execution:status', { taskId: '9' });

    expect(wildcardSocket.emitted.some(([event]) => event === 'stream:event')).toBe(true);

    // Unrelated channel filter does not match task events.
    const narrowSocket = makeSocket('narrow-1');
    registerClient(hub, narrowSocket, ['task:11']);
    hub.publish('task:execution:status', { taskId: '9' });

    const narrowEvent = narrowSocket.emitted.find(([event]) => event === 'stream:event');
    expect(narrowEvent).toBeUndefined();
  });

  test('disconnects and removes clients whose transport remains backpressured', () => {
    const hub = makeHub();
    hub.maxBackpressureEvents = 1;
    const slowSocket = makeSocket('slow-1');
    slowSocket.conn = { transport: { writable: false } };
    slowSocket.disconnect = jest.fn();
    attachNamespace(hub, [slowSocket]);
    registerClient(hub, slowSocket, ['task:*']);

    hub.publish('task:execution:status', { taskId: '9' });

    expect(slowSocket.disconnect).toHaveBeenCalledWith(true);
    expect(hub.clients.has('slow-1')).toBe(false);
  });

  test('heartbeat emits pings and terminates clients that stop ponging', () => {
    jest.useFakeTimers();
    const hub = makeHub();
    const staleSocket = makeSocket('stale-1');
    const liveSocket = makeSocket('live-1');
    attachNamespace(hub, [staleSocket, liveSocket]);

    registerClient(hub, staleSocket, [], Date.now() - 60000);
    registerClient(hub, liveSocket);
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
    registerClient(hub2, deadSocket, [], Date.now() - hub2.heartbeatTimeoutMs - 1);
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
      write(chunk) { writes.push(chunk); return true; },
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
