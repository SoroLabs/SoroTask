'use strict';

/**
 * notificationService.js - Unified Notification Delivery System
 * 
 * Handles delivery of notifications across multiple channels:
 * - In-app notifications (stored in database/memory)
 * - Email notifications (via SMTP provider)
 * - Webhook notifications (to external endpoints)
 * 
 * Provides fault-tolerant delivery with retry logic, rate limiting,
 * and comprehensive error tracking.
 */

const { createLogger } = require('./logger');
const { withRetry, ErrorClassification } = require('./retry.js');

const logger = createLogger('notification-service');

// Notification types matching the frontend categories
const NotificationType = Object.freeze({
  TASK_FAILED: 'task_failed',
  TASK_RECOVERED: 'task_recovered',
  GAS_LOW: 'gas_low',
  TASK_PAUSED: 'task_paused',
  EXECUTION_SUCCESS: 'execution_success',
  EXECUTION_SKIPPED: 'execution_skipped',
  WEEKLY_DIGEST: 'weekly_digest',
});

// Notification channels
const NotificationChannel = Object.freeze({
  IN_APP: 'in_app',
  EMAIL: 'email',
  WEBHOOK: 'webhook',
});

// Priority levels for routing
const NotificationPriority = Object.freeze({
  CRITICAL: 'critical',
  IMPORTANT: 'important',
  FYI: 'fyi',
});

/**
 * Notification Service Configuration
 */
class NotificationServiceConfig {
  constructor(options = {}) {
    // Email configuration
    this.emailEnabled = options.emailEnabled ?? process.env.EMAIL_ENABLED === 'true';
    this.smtpHost = options.smtpHost || process.env.SMTP_HOST;
    this.smtpPort = parseInt(options.smtpPort || process.env.SMTP_PORT || '587', 10);
    this.smtpUser = options.smtpUser || process.env.SMTP_USER;
    this.smtpPassword = options.smtpPassword || process.env.SMTP_PASSWORD;
    this.emailFrom = options.emailFrom || process.env.EMAIL_FROM || 'noreply@sorotask.io';
    
    // Webhook configuration
    this.webhookEnabled = options.webhookEnabled ?? process.env.NOTIFICATION_WEBHOOKS_ENABLED === 'true';
    this.webhookEndpoints = options.webhookEndpoints || this.parseWebhookEndpoints(process.env.NOTIFICATION_WEBHOOK_ENDPOINTS);
    this.webhookTimeout = parseInt(options.webhookTimeout || process.env.WEBHOOK_TIMEOUT || '10000', 10);
    this.webhookRetryAttempts = parseInt(options.webhookRetryAttempts || process.env.WEBHOOK_RETRY_ATTEMPTS || '3', 10);
    
    // In-app configuration
    this.inAppEnabled = options.inAppEnabled ?? true;
    this.inAppRetentionDays = parseInt(options.inAppRetentionDays || process.env.IN_APP_RETENTION_DAYS || '30', 10);
    
    // Rate limiting
    this.rateLimitPerMinute = parseInt(options.rateLimitPerMinute || process.env.NOTIFICATION_RATE_LIMIT || '60', 10);
    
    // Retry configuration
    this.retryBaseDelayMs = parseInt(options.retryBaseDelayMs || process.env.NOTIFICATION_RETRY_DELAY || '1000', 10);
    this.retryMaxDelayMs = parseInt(options.retryMaxDelayMs || process.env.NOTIFICATION_RETRY_MAX_DELAY || '30000', 10);
  }
  
  parseWebhookEndpoints(envValue) {
    if (!envValue) return [];
    try {
      return JSON.parse(envValue);
    } catch {
      return envValue.split(',').map(url => url.trim()).filter(Boolean);
    }
  }
}

/**
 * Notification Service
 */
class NotificationService {
  constructor(options = {}) {
    this.config = new NotificationServiceConfig(options);
    this.logger = options.logger || logger;
    
    // In-memory storage for in-app notifications (in production, use a database)
    this.inAppNotifications = new Map();
    this.notificationIdCounter = 0;
    
    // Rate limiting tracker
    this.rateLimitTracker = new Map();
    this.rateLimitWindowStart = Date.now();
    
    // Metrics
    this.metrics = {
      sentTotal: 0,
      failedTotal: 0,
      retriedTotal: 0,
      byChannel: { in_app: 0, email: 0, webhook: 0 },
      byType: {},
    };
  }
  
  /**
   * Send a notification across specified channels
   * 
   * @param {Object} notification - Notification object
   * @param {string} notification.type - Notification type
   * @param {string} notification.title - Notification title
   * @param {string} notification.message - Notification message
   * @param {Object} notification.data - Additional data
   * @param {string[]} notification.channels - Target channels
   * @param {string} notification.recipient - Recipient identifier (email, user ID, etc.)
   * @param {string} notification.priority - Priority level
   * @returns {Promise<Object>} Delivery results by channel
   */
  async sendNotification(notification) {
    const notificationId = this.generateNotificationId();
    const startTime = Date.now();
    
    this.logger.info('Sending notification', {
      notificationId,
      type: notification.type,
      channels: notification.channels,
      recipient: notification.recipient,
    });
    
    const results = {
      notificationId,
      channels: {},
      overallStatus: 'partial',
    };
    
    let successCount = 0;
    let failureCount = 0;
    
    // Check rate limit
    if (!this.checkRateLimit()) {
      this.logger.warn('Rate limit exceeded, dropping notification', { notificationId });
      return {
        notificationId,
        channels: {},
        overallStatus: 'rate_limited',
        error: 'Rate limit exceeded',
      };
    }
    
    // Send to each channel
    for (const channel of notification.channels) {
      try {
        const channelResult = await this.sendToChannel(channel, notification, notificationId);
        results.channels[channel] = channelResult;
        
        if (channelResult.success) {
          successCount++;
          this.metrics.sentTotal++;
          this.metrics.byChannel[channel] = (this.metrics.byChannel[channel] || 0) + 1;
        } else {
          failureCount++;
          this.metrics.failedTotal++;
        }
      } catch (error) {
        this.logger.error('Channel delivery failed', {
          notificationId,
          channel,
          error: error.message,
        });
        results.channels[channel] = {
          success: false,
          error: error.message,
          attempts: 0,
        };
        failureCount++;
        this.metrics.failedTotal++;
      }
    }
    
    // Update type metrics
    this.metrics.byType[notification.type] = (this.metrics.byType[notification.type] || 0) + 1;
    
    // Determine overall status
    if (successCount === notification.channels.length) {
      results.overallStatus = 'success';
    } else if (successCount === 0) {
      results.overallStatus = 'failed';
    }
    
    const duration = Date.now() - startTime;
    this.logger.info('Notification delivery complete', {
      notificationId,
      overallStatus: results.overallStatus,
      successCount,
      failureCount,
      duration,
    });
    
    return results;
  }
  
  /**
   * Send notification to a specific channel
   */
  async sendToChannel(channel, notification, notificationId) {
    switch (channel) {
      case NotificationChannel.IN_APP:
        return this.sendInApp(notification, notificationId);
      case NotificationChannel.EMAIL:
        return this.sendEmail(notification, notificationId);
      case NotificationChannel.WEBHOOK:
        return this.sendWebhook(notification, notificationId);
      default:
        throw new Error(`Unknown channel: ${channel}`);
    }
  }
  
  /**
   * Send in-app notification
   */
  async sendInApp(notification, notificationId) {
    if (!this.config.inAppEnabled) {
      return { success: false, error: 'In-app notifications disabled', attempts: 0 };
    }
    
    const inAppNotification = {
      id: notificationId,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data || {},
      recipient: notification.recipient,
      priority: notification.priority || NotificationPriority.IMPORTANT,
      read: false,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + this.config.inAppRetentionDays * 24 * 60 * 60 * 1000).toISOString(),
    };
    
    // Store notification (in production, save to database)
    this.inAppNotifications.set(notificationId, inAppNotification);
    
    this.logger.debug('In-app notification stored', { notificationId });
    
    return { success: true, attempts: 1 };
  }
  
  /**
   * Send email notification
   */
  async sendEmail(notification, notificationId) {
    if (!this.config.emailEnabled) {
      return { success: false, error: 'Email notifications disabled', attempts: 0 };
    }
    
    if (!this.config.smtpHost || !this.config.smtpUser) {
      return { success: false, error: 'Email not configured', attempts: 0 };
    }
    
    const emailData = {
      to: notification.recipient,
      from: this.config.emailFrom,
      subject: `[SoroTask] ${notification.title}`,
      text: notification.message,
      html: this.generateEmailHtml(notification),
    };
    
    return withRetry(
      async () => this.sendEmailRaw(emailData),
      {
        maxRetries: this.config.webhookRetryAttempts,
        baseDelayMs: this.config.retryBaseDelayMs,
        maxDelayMs: this.config.retryMaxDelayMs,
        onRetry: (error, attempt, delay) => {
          this.logger.warn('Retrying email send', {
            notificationId,
            attempt,
            delay,
            error: error.message,
          });
          this.metrics.retriedTotal++;
        },
      },
    );
  }
  
  /**
   * Send webhook notification
   */
  async sendWebhook(notification, notificationId) {
    if (!this.config.webhookEnabled) {
      return { success: false, error: 'Webhook notifications disabled', attempts: 0 };
    }
    
    if (this.config.webhookEndpoints.length === 0) {
      return { success: false, error: 'No webhook endpoints configured', attempts: 0 };
    }
    
    const webhookPayload = {
      id: notificationId,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data || {},
      recipient: notification.recipient,
      priority: notification.priority,
      timestamp: new Date().toISOString(),
    };
    
    // Send to all configured endpoints
    const results = await Promise.allSettled(
      this.config.webhookEndpoints.map(endpoint =>
        this.sendWebhookToEndpoint(endpoint, webhookPayload, notificationId)
      )
    );
    
    const allSuccessful = results.every(r => r.status === 'fulfilled' && r.value.success);
    
    if (allSuccessful) {
      return { success: true, attempts: 1, endpoints: results.length };
    } else {
      const failedCount = results.filter(r => r.status === 'rejected' || !r.value.success).length;
      return {
        success: false,
        error: `${failedCount}/${results.length} endpoints failed`,
        attempts: 1,
      };
    }
  }
  
  /**
   * Send webhook to a single endpoint
   */
  async sendWebhookToEndpoint(endpoint, payload, notificationId) {
    return withRetry(
      async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.webhookTimeout);
        
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-SoroTask-Notification-ID': notificationId,
              'X-SoroTask-Timestamp': Date.now().toString(),
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          return { success: true, status: response.status };
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      },
      {
        maxRetries: this.config.webhookRetryAttempts,
        baseDelayMs: this.config.retryBaseDelayMs,
        maxDelayMs: this.config.retryMaxDelayMs,
        onRetry: (error, attempt, delay) => {
          this.logger.warn('Retrying webhook send', {
            notificationId,
            endpoint,
            attempt,
            delay,
            error: error.message,
          });
          this.metrics.retriedTotal++;
        },
      },
    );
  }
  
  /**
   * Send raw email (placeholder for actual SMTP implementation)
   * In production, use nodemailer or similar
   */
  async sendEmailRaw(emailData) {
    // Placeholder implementation
    // In production, integrate with nodemailer or SendGrid/AWS SES
    this.logger.debug('Sending email', { to: emailData.to, subject: emailData.subject });
    
    // Simulate email send
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return { success: true };
  }
  
  /**
   * Generate HTML email body
   */
  generateEmailHtml(notification) {
    return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #00c389; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f5f5f5; padding: 20px; border-radius: 0 0 8px 8px; }
    .footer { margin-top: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>SoroTask Notification</h1>
    </div>
    <div class="content">
      <h2>${notification.title}</h2>
      <p>${notification.message}</p>
      ${notification.data ? `<pre>${JSON.stringify(notification.data, null, 2)}</pre>` : ''}
    </div>
    <div class="footer">
      <p>This is an automated notification from SoroTask.</p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }
  
  /**
   * Check rate limit
   */
  checkRateLimit() {
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window
    
    // Reset counter if window expired
    if (this.rateLimitWindowStart < windowStart) {
      this.rateLimitTracker.clear();
      this.rateLimitWindowStart = now;
    }
    
    // Check if under limit
    if (this.rateLimitTracker.size >= this.config.rateLimitPerMinute) {
      return false;
    }
    
    // Add current request to tracker
    this.rateLimitTracker.set(now, true);
    return true;
  }
  
  /**
   * Generate unique notification ID
   */
  generateNotificationId() {
    return `notif_${Date.now()}_${++this.notificationIdCounter}`;
  }
  
  /**
   * Get in-app notifications for a recipient
   */
  getInAppNotifications(recipient, options = {}) {
    const limit = options.limit || 50;
    const unreadOnly = options.unreadOnly || false;
    
    const notifications = Array.from(this.inAppNotifications.values())
      .filter(n => n.recipient === recipient)
      .filter(n => !unreadOnly || !n.read)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
    
    return notifications;
  }
  
  /**
   * Mark notification as read
   */
  markAsRead(notificationId) {
    const notification = this.inAppNotifications.get(notificationId);
    if (notification) {
      notification.read = true;
      notification.readAt = new Date().toISOString();
      return true;
    }
    return false;
  }
  
  /**
   * Get service metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      inAppCount: this.inAppNotifications.size,
      rateLimitUsage: this.rateLimitTracker.size,
      rateLimitMax: this.config.rateLimitPerMinute,
    };
  }
  
  /**
   * Clean up expired in-app notifications
   */
  cleanupExpiredNotifications() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [id, notification] of this.inAppNotifications.entries()) {
      const expiresAt = new Date(notification.expiresAt).getTime();
      if (expiresAt < now) {
        this.inAppNotifications.delete(id);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.logger.info('Cleaned up expired notifications', { count: cleaned });
    }
    
    return cleaned;
  }
}

module.exports = {
  NotificationService,
  NotificationServiceConfig,
  NotificationType,
  NotificationChannel,
  NotificationPriority,
};
