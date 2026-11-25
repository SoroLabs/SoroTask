'use strict';

const { NotificationDispatchClient } = require('../notificationDispatchClient');

describe('NotificationDispatchClient', () => {
  const notification = {
    recipient: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    category: 'taskFailed',
    title: 'Task failed',
    message: 'Execution failed',
  };

  it('sends authenticated notification events to the configured endpoint', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const client = new NotificationDispatchClient({
      url: 'https://app.example/api/notifications/dispatch',
      token: 'delivery-token',
      fetchFn,
    });

    await expect(client.dispatch(notification)).resolves.toEqual({ delivered: true });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://app.example/api/notifications/dispatch',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: 'Bearer delivery-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(notification),
      }),
    );
  });

  it('does not send without server-to-server credentials', async () => {
    const fetchFn = jest.fn();
    const client = new NotificationDispatchClient({ fetchFn });

    await expect(client.dispatch(notification)).resolves.toEqual({
      delivered: false,
      disabled: true,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reports service failures without throwing into task execution', async () => {
    const logger = { warn: jest.fn(), error: jest.fn() };
    const client = new NotificationDispatchClient({
      url: 'https://app.example/api/notifications/dispatch',
      token: 'delivery-token',
      fetchFn: jest.fn().mockRejectedValue(new Error('offline')),
      logger,
    });

    await expect(client.dispatch(notification)).resolves.toEqual({ delivered: false });
    expect(logger.warn).toHaveBeenCalledWith(
      'Notification delivery API request failed',
      expect.objectContaining({ category: 'taskFailed', error: 'offline' }),
    );
  });
});
