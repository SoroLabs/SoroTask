'use strict';

class NotificationDispatchClient {
  constructor(options = {}) {
    this.url = options.url || process.env.NOTIFICATION_DELIVERY_URL || '';
    this.token = options.token || process.env.NOTIFICATION_DELIVERY_TOKEN || '';
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.logger = options.logger || console;
    this.timeoutMs = options.timeoutMs || 5000;
  }

  async dispatch(notification) {
    if (!this.url || !this.token) return { delivered: false, disabled: true };
    if (typeof this.fetchFn !== 'function') {
      this.logger.error('Notification delivery is configured but fetch is unavailable');
      return { delivered: false };
    }

    try {
      const response = await this.fetchFn(this.url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(notification),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        this.logger.warn('Notification delivery API rejected an event', {
          status: response.status,
          category: notification.category,
        });
        return { delivered: false, status: response.status };
      }
      return { delivered: true };
    } catch (error) {
      this.logger.warn('Notification delivery API request failed', {
        category: notification.category,
        error: error instanceof Error ? error.message : String(error),
      });
      return { delivered: false };
    }
  }
}

module.exports = { NotificationDispatchClient };
