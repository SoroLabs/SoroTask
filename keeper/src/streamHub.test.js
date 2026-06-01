const { StreamHub } = require('./streamHub');

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