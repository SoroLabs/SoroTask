'use strict';

/**
 * notificationIntegration.test.js - Tests for Notification Integration
 */

const {
  NotificationIntegration,
  NotificationIntegrationConfig,
} = require('../notificationIntegration');
const { NotificationService, NotificationType, NotificationChannel, NotificationPriority } = require('../notificationService');

describe('NotificationIntegration', () => {
  let notificationService;
  let integration;
  
  beforeEach(() => {
    notificationService = new NotificationService({
      emailEnabled: false,
      webhookEnabled: false,
      inAppEnabled: true,
    });
    
    integration = new NotificationIntegration(notificationService);
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  describe('constructor', () => {
    it('should initialize with notification service', () => {
      expect(integration.notificationService).toBe(notificationService);
      expect(integration.config).toBeInstanceOf(NotificationIntegrationConfig);
    });
    
    it('should accept custom configuration', () => {
      const customIntegration = new NotificationIntegration(notificationService, {
        userPreferences: {
          'user@example.com': {
            channels: { in_app: true, email: false, webhook: false },
            categories: { task_failed: true, gas_low: true },
          },
        },
      });
      
      expect(customIntegration.config.userPreferences).toHaveProperty('user@example.com');
    });
  });
  
  describe('handleTaskFailure', () => {
    it('should send task failure notification', async () => {
      const event = {
        taskId: 123,
        error: 'Execution failed',
        taskConfig: { creator: 'user@example.com' },
        keeperAddress: 'GKEEPER',
        correlationId: 'corr-123',
      };
      
      const result = await integration.handleTaskFailure(event);
      
      expect(result.overallStatus).toBe('success');
      expect(result.channels.in_app.success).toBe(true);
    });
    
    it('should use correct notification type', async () => {
      const event = {
        taskId: 123,
        error: 'Execution failed',
        taskConfig: { creator: 'user@example.com' },
        keeperAddress: 'GKEEPER',
        correlationId: 'corr-123',
      };
      
      const sendSpy = jest.spyOn(notificationService, 'sendNotification');
      
      await integration.handleTaskFailure(event);
      
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.TASK_FAILED,
          priority: NotificationPriority.CRITICAL,
        })
      );
    });
  });
  
  describe('handleTaskRecovery', () => {
    it('should send task recovery notification', async () => {
      const event = {
        taskId: 123,
        taskConfig: { creator: 'user@example.com' },
        correlationId: 'corr-123',
      };
      
      const result = await integration.handleTaskRecovery(event);
      
      expect(result.overallStatus).toBe('success');
    });
  });
  
  describe('handleLowGasBalance', () => {
    it('should send low gas notification', async () => {
      const event = {
        taskId: 123,
        taskConfig: { creator: 'user@example.com' },
        gasBalance: 100,
        threshold: 1000,
        correlationId: 'corr-123',
      };
      
      const result = await integration.handleLowGasBalance(event);
      
      expect(result.overallStatus).toBe('success');
      expect(result.channels.in_app.success).toBe(true);
    });
  });
  
  describe('handleTaskPaused', () => {
    it('should send task paused notification', async () => {
      const event = {
        taskId: 123,
        taskConfig: { creator: 'user@example.com' },
        reason: 'Contract rejected execution',
        correlationId: 'corr-123',
      };
      
      const result = await integration.handleTaskPaused(event);
      
      expect(result.overallStatus).toBe('success');
    });
  });
  
  describe('handleExecutionSuccess', () => {
    it('should send execution success notification', async () => {
      const event = {
        taskId: 123,
        taskConfig: { creator: 'user@example.com' },
        txHash: 'abc123',
        feePaid: 100,
        correlationId: 'corr-123',
      };
      
      const result = await integration.handleExecutionSuccess(event);
      
      expect(result.overallStatus).toBe('success');
    });
  });
  
  describe('handleExecutionSkipped', () => {
    it('should send execution skipped notification', async () => {
      const event = {
        taskId: 123,
        taskConfig: { creator: 'user@example.com' },
        reason: 'Interval window shifted',
        correlationId: 'corr-123',
      };
      
      const result = await integration.handleExecutionSkipped(event);
      
      expect(result.overallStatus).toBe('success');
    });
  });
  
  describe('sendWeeklyDigest', () => {
    it('should send weekly digest notification', async () => {
      const event = {
        userId: 'user@example.com',
        stats: {
          weekStart: '2024-01-01',
          weekEnd: '2024-01-07',
          totalTasks: 10,
          successfulExecutions: 8,
          failedExecutions: 1,
          skippedExecutions: 1,
          totalGasUsed: 1000,
        },
        tasks: [
          { id: 1, executions: 5 },
          { id: 2, executions: 3 },
        ],
        correlationId: 'corr-123',
      };
      
      const result = await integration.sendWeeklyDigest(event);
      
      expect(result.overallStatus).toBe('success');
    });
  });
  
  describe('getChannelsForUser', () => {
    it('should return default channels when no user preferences', () => {
      const channels = integration.getChannelsForUser('user@example.com', NotificationType.TASK_FAILED);
      
      expect(channels).toContain(NotificationChannel.IN_APP);
      expect(channels).toContain(NotificationChannel.EMAIL);
      expect(channels).toContain(NotificationChannel.WEBHOOK);
    });
    
    it('should respect user preferences when set', () => {
      integration.updateUserPreferences('user@example.com', {
        channels: { in_app: true, email: false, webhook: false },
        categories: { task_failed: true },
      });
      
      const channels = integration.getChannelsForUser('user@example.com', NotificationType.TASK_FAILED);
      
      expect(channels).toEqual([NotificationChannel.IN_APP]);
    });
    
    it('should return empty array when category disabled', () => {
      integration.updateUserPreferences('user@example.com', {
        channels: { in_app: true, email: true, webhook: true },
        categories: { task_failed: false },
      });
      
      const channels = integration.getChannelsForUser('user@example.com', NotificationType.TASK_FAILED);
      
      expect(channels).toEqual([]);
    });
  });
  
  describe('updateUserPreferences', () => {
    it('should update user preferences', () => {
      const preferences = {
        channels: { in_app: true, email: false, webhook: false },
        categories: { task_failed: true },
      };
      
      integration.updateUserPreferences('user@example.com', preferences);
      
      expect(integration.config.userPreferences['user@example.com']).toEqual(preferences);
    });
  });
  
  describe('getUserPreferences', () => {
    it('should return null for non-existent user', () => {
      const prefs = integration.getUserPreferences('nonexistent@example.com');
      
      expect(prefs).toBeNull();
    });
    
    it('should return preferences for existing user', () => {
      const preferences = {
        channels: { in_app: true, email: false, webhook: false },
        categories: { task_failed: true },
      };
      
      integration.updateUserPreferences('user@example.com', preferences);
      
      const prefs = integration.getUserPreferences('user@example.com');
      
      expect(prefs).toEqual(preferences);
    });
  });
  
  describe('generateDigestSummary', () => {
    it('should generate digest summary', () => {
      const stats = {
        weekStart: '2024-01-01',
        weekEnd: '2024-01-07',
        totalTasks: 10,
        successfulExecutions: 8,
        failedExecutions: 1,
        skippedExecutions: 1,
        totalGasUsed: 1000,
      };
      
      const tasks = [
        { id: 1, executions: 5 },
        { id: 2, executions: 3 },
      ];
      
      const summary = integration.generateDigestSummary(stats, tasks);
      
      expect(summary).toContain('Weekly Summary');
      expect(summary).toContain('Total Tasks: 10');
      expect(summary).toContain('Successful Executions: 8');
      expect(summary).toContain('Top Tasks');
    });
  });
});

describe('NotificationIntegrationConfig', () => {
  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      const config = new NotificationIntegrationConfig();
      
      expect(config.userPreferences).toEqual({});
      expect(config.defaultChannelMappings).toBeDefined();
      expect(config.defaultPriorityMappings).toBeDefined();
    });
    
    it('should accept custom user preferences', () => {
      const config = new NotificationIntegrationConfig({
        userPreferences: {
          'user@example.com': {
            channels: { in_app: true },
            categories: { task_failed: true },
          },
        },
      });
      
      expect(config.userPreferences).toHaveProperty('user@example.com');
    });
  });
});
