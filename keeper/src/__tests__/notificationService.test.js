'use strict';

/**
 * notificationService.test.js - Tests for Notification Service
 */

const {
  NotificationService,
  NotificationServiceConfig,
  NotificationType,
  NotificationChannel,
  NotificationPriority,
} = require('../notificationService');

describe('NotificationService', () => {
  let service;
  
  beforeEach(() => {
    service = new NotificationService({
      emailEnabled: false,
      webhookEnabled: false,
      inAppEnabled: true,
    });
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      const newService = new NotificationService();
      expect(newService.config).toBeInstanceOf(NotificationServiceConfig);
      expect(newService.config.inAppEnabled).toBe(true);
    });
    
    it('should accept custom configuration', () => {
      const customService = new NotificationService({
        emailEnabled: true,
        smtpHost: 'smtp.example.com',
        webhookEnabled: true,
        webhookEndpoints: ['https://example.com/webhook'],
      });
      
      expect(customService.config.emailEnabled).toBe(true);
      expect(customService.config.smtpHost).toBe('smtp.example.com');
      expect(customService.config.webhookEnabled).toBe(true);
      expect(customService.config.webhookEndpoints).toEqual(['https://example.com/webhook']);
    });
  });
  
  describe('sendNotification', () => {
    it('should send notification to in-app channel', async () => {
      const notification = {
        type: NotificationType.TASK_FAILED,
        title: 'Task Failed',
        message: 'Task #123 failed during execution',
        channels: [NotificationChannel.IN_APP],
        recipient: 'user@example.com',
        priority: NotificationPriority.CRITICAL,
      };
      
      const result = await service.sendNotification(notification);
      
      expect(result.overallStatus).toBe('success');
      expect(result.channels.in_app.success).toBe(true);
      expect(result.notificationId).toMatch(/^notif_\d+_\d+$/);
    });
    
    it('should handle multiple channels', async () => {
      const notification = {
        type: NotificationType.GAS_LOW,
        title: 'Low Gas',
        message: 'Task gas balance is low',
        channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        recipient: 'user@example.com',
        priority: NotificationPriority.CRITICAL,
      };
      
      const result = await service.sendNotification(notification);
      
      expect(result.channels).toHaveProperty('in_app');
      expect(result.channels).toHaveProperty('email');
    });
    
    it('should return rate_limited status when rate limit exceeded', async () => {
      const serviceWithLimit = new NotificationService({
        rateLimitPerMinute: 2,
      });
      
      const notification = {
        type: NotificationType.TASK_FAILED,
        title: 'Test',
        message: 'Test message',
        channels: [NotificationChannel.IN_APP],
        recipient: 'user@example.com',
      };
      
      // Send 3 notifications (limit is 2)
      await serviceWithLimit.sendNotification(notification);
      await serviceWithLimit.sendNotification(notification);
      const result = await serviceWithLimit.sendNotification(notification);
      
      expect(result.overallStatus).toBe('rate_limited');
    });
    
    it('should update metrics on successful send', async () => {
      const notification = {
        type: NotificationType.TASK_FAILED,
        title: 'Test',
        message: 'Test message',
        channels: [NotificationChannel.IN_APP],
        recipient: 'user@example.com',
      };
      
      await service.sendNotification(notification);
      
      const metrics = service.getMetrics();
      expect(metrics.sentTotal).toBe(1);
      expect(metrics.byChannel.in_app).toBe(1);
      expect(metrics.byType.task_failed).toBe(1);
    });
  });
  
  describe('sendInApp', () => {
    it('should store in-app notification', async () => {
      const notification = {
        type: NotificationType.TASK_FAILED,
        title: 'Test',
        message: 'Test message',
        recipient: 'user@example.com',
      };
      
      const result = await service.sendInApp(notification, 'notif_123');
      
      expect(result.success).toBe(true);
      expect(service.inAppNotifications.has('notif_123')).toBe(true);
    });
    
    it('should return error when in-app disabled', async () => {
      const disabledService = new NotificationService({ inAppEnabled: false });
      
      const result = await disabledService.sendInApp({}, 'notif_123');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('In-app notifications disabled');
    });
  });
  
  describe('sendEmail', () => {
    it('should return error when email disabled', async () => {
      const result = await service.sendEmail({}, 'notif_123');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Email notifications disabled');
    });
    
    it('should return error when not configured', async () => {
      const emailService = new NotificationService({ emailEnabled: true });
      
      const result = await emailService.sendEmail({}, 'notif_123');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Email not configured');
    });
  });
  
  describe('sendWebhook', () => {
    it('should return error when webhook disabled', async () => {
      const result = await service.sendWebhook({}, 'notif_123');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Webhook notifications disabled');
    });
    
    it('should return error when no endpoints configured', async () => {
      const webhookService = new NotificationService({ webhookEnabled: true });
      
      const result = await webhookService.sendWebhook({}, 'notif_123');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('No webhook endpoints configured');
    });
  });
  
  describe('getInAppNotifications', () => {
    beforeEach(async () => {
      await service.sendInApp({
        type: NotificationType.TASK_FAILED,
        title: 'Failed Task',
        message: 'Task failed',
        recipient: 'user@example.com',
      }, 'notif_1');
      
      await service.sendInApp({
        type: NotificationType.GAS_LOW,
        title: 'Low Gas',
        message: 'Gas low',
        recipient: 'user@example.com',
      }, 'notif_2');
      
      await service.sendInApp({
        type: NotificationType.TASK_FAILED,
        title: 'Another Failed',
        message: 'Another failed',
        recipient: 'other@example.com',
      }, 'notif_3');
    });
    
    it('should return notifications for recipient', () => {
      const notifications = service.getInAppNotifications('user@example.com');
      
      expect(notifications).toHaveLength(2);
      expect(notifications.every(n => n.recipient === 'user@example.com')).toBe(true);
    });
    
    it('should respect limit parameter', () => {
      const notifications = service.getInAppNotifications('user@example.com', { limit: 1 });
      
      expect(notifications).toHaveLength(1);
    });
    
    it('should filter unread only when requested', () => {
      service.markAsRead('notif_1');
      
      const all = service.getInAppNotifications('user@example.com');
      const unread = service.getInAppNotifications('user@example.com', { unreadOnly: true });
      
      expect(all).toHaveLength(2);
      expect(unread).toHaveLength(1);
    });
    
    it('should sort by creation date descending', () => {
      const notifications = service.getInAppNotifications('user@example.com');
      
      expect(notifications[0].id).toBe('notif_2');
      expect(notifications[1].id).toBe('notif_1');
    });
  });
  
  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      await service.sendInApp({
        type: NotificationType.TASK_FAILED,
        title: 'Test',
        message: 'Test',
        recipient: 'user@example.com',
      }, 'notif_1');
      
      const result = service.markAsRead('notif_1');
      
      expect(result).toBe(true);
      expect(service.inAppNotifications.get('notif_1').read).toBe(true);
    });
    
    it('should return false for non-existent notification', () => {
      const result = service.markAsRead('nonexistent');
      
      expect(result).toBe(false);
    });
  });
  
  describe('getMetrics', () => {
    it('should return current metrics', () => {
      const metrics = service.getMetrics();
      
      expect(metrics).toHaveProperty('sentTotal');
      expect(metrics).toHaveProperty('failedTotal');
      expect(metrics).toHaveProperty('retriedTotal');
      expect(metrics).toHaveProperty('byChannel');
      expect(metrics).toHaveProperty('byType');
      expect(metrics).toHaveProperty('inAppCount');
      expect(metrics).toHaveProperty('rateLimitUsage');
      expect(metrics).toHaveProperty('rateLimitMax');
    });
  });
  
  describe('cleanupExpiredNotifications', () => {
    it('should remove expired notifications', async () => {
      const shortLivedService = new NotificationService({ inAppRetentionDays: 0 });
      
      await shortLivedService.sendInApp({
        type: NotificationType.TASK_FAILED,
        title: 'Test',
        message: 'Test',
        recipient: 'user@example.com',
      }, 'notif_1');
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const cleaned = shortLivedService.cleanupExpiredNotifications();
      
      expect(cleaned).toBe(1);
      expect(shortLivedService.inAppNotifications.size).toBe(0);
    });
  });
  
  describe('generateNotificationId', () => {
    it('should generate unique IDs', () => {
      const id1 = service.generateNotificationId();
      const id2 = service.generateNotificationId();
      
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^notif_\d+_\d+$/);
    });
  });
  
  describe('checkRateLimit', () => {
    it('should allow requests under limit', () => {
      const limitedService = new NotificationService({ rateLimitPerMinute: 10 });
      
      for (let i = 0; i < 5; i++) {
        expect(limitedService.checkRateLimit()).toBe(true);
      }
    });
    
    it('should block requests over limit', () => {
      const limitedService = new NotificationService({ rateLimitPerMinute: 3 });
      
      limitedService.checkRateLimit();
      limitedService.checkRateLimit();
      limitedService.checkRateLimit();
      
      expect(limitedService.checkRateLimit()).toBe(false);
    });
  });
});

describe('NotificationServiceConfig', () => {
  describe('constructor', () => {
    it('should parse webhook endpoints from JSON string', () => {
      const config = new NotificationServiceConfig({
        webhookEndpoints: '["https://example.com/webhook", "https://example.com/another"]',
      });
      
      expect(config.webhookEndpoints).toEqual([
        'https://example.com/webhook',
        'https://example.com/another',
      ]);
    });
    
    it('should parse webhook endpoints from comma-separated string', () => {
      const config = new NotificationServiceConfig({
        webhookEndpoints: 'https://example.com/webhook,https://example.com/another',
      });
      
      expect(config.webhookEndpoints).toEqual([
        'https://example.com/webhook',
        'https://example.com/another',
      ]);
    });
    
    it('should use environment variables as defaults', () => {
      process.env.EMAIL_ENABLED = 'true';
      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.NOTIFICATION_WEBHOOK_ENDPOINTS = '["https://test.com"]';
      
      const config = new NotificationServiceConfig();
      
      expect(config.emailEnabled).toBe(true);
      expect(config.smtpHost).toBe('smtp.test.com');
      expect(config.webhookEndpoints).toEqual(['https://test.com']);
      
      delete process.env.EMAIL_ENABLED;
      delete process.env.SMTP_HOST;
      delete process.env.NOTIFICATION_WEBHOOK_ENDPOINTS;
    });
  });
});
