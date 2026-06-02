'use strict';

/**
 * notificationIntegration.js - Integration Layer for Keeper Events to Notifications
 * 
 * Bridges keeper events (task execution, failures, etc.) to the notification service.
 * Maps keeper events to appropriate notification types and channels.
 */

const { createLogger } = require('./logger');
const { NotificationService, NotificationType, NotificationChannel, NotificationPriority } = require('./notificationService');

const logger = createLogger('notification-integration');

/**
 * Notification Integration Configuration
 */
class NotificationIntegrationConfig {
  constructor(options = {}) {
    // User notification preferences (in production, load from database)
    this.userPreferences = options.userPreferences || {};
    
    // Default channel mappings by notification type
    this.defaultChannelMappings = {
      [NotificationType.TASK_FAILED]: [NotificationChannel.IN_APP, NotificationChannel.EMAIL, NotificationChannel.WEBHOOK],
      [NotificationType.TASK_RECOVERED]: [NotificationChannel.IN_APP, NotificationChannel.WEBHOOK],
      [NotificationType.GAS_LOW]: [NotificationChannel.IN_APP, NotificationChannel.EMAIL, NotificationChannel.WEBHOOK],
      [NotificationType.TASK_PAUSED]: [NotificationChannel.IN_APP, NotificationChannel.EMAIL, NotificationChannel.WEBHOOK],
      [NotificationType.EXECUTION_SUCCESS]: [NotificationChannel.IN_APP],
      [NotificationType.EXECUTION_SKIPPED]: [NotificationChannel.IN_APP, NotificationChannel.WEBHOOK],
      [NotificationType.WEEKLY_DIGEST]: [NotificationChannel.EMAIL],
    };
    
    // Default priority mappings
    this.defaultPriorityMappings = {
      [NotificationType.TASK_FAILED]: NotificationPriority.CRITICAL,
      [NotificationType.TASK_RECOVERED]: NotificationPriority.IMPORTANT,
      [NotificationType.GAS_LOW]: NotificationPriority.CRITICAL,
      [NotificationType.TASK_PAUSED]: NotificationPriority.CRITICAL,
      [NotificationType.EXECUTION_SUCCESS]: NotificationPriority.FYI,
      [NotificationType.EXECUTION_SKIPPED]: NotificationPriority.IMPORTANT,
      [NotificationType.WEEKLY_DIGEST]: NotificationPriority.FYI,
    };
  }
}

/**
 * Notification Integration
 */
class NotificationIntegration {
  constructor(notificationService, options = {}) {
    this.notificationService = notificationService;
    this.config = new NotificationIntegrationConfig(options);
    this.logger = options.logger || logger;
  }
  
  /**
   * Handle task execution failure
   */
  async handleTaskFailure(event) {
    const { taskId, error, taskConfig, keeperAddress, correlationId } = event;
    
    this.logger.info('Handling task failure notification', { taskId, correlationId });
    
    const notification = {
      type: NotificationType.TASK_FAILED,
      title: `Task #${taskId} Failed`,
      message: `Task execution failed: ${error}`,
      data: {
        taskId,
        error,
        taskConfig,
        keeperAddress,
        timestamp: new Date().toISOString(),
      },
      channels: this.getChannelsForUser(taskConfig.creator, NotificationType.TASK_FAILED),
      recipient: taskConfig.creator,
      priority: this.config.defaultPriorityMappings[NotificationType.TASK_FAILED],
    };
    
    return await this.notificationService.sendNotification(notification);
  }
  
  /**
   * Handle task recovery (after previous failure)
   */
  async handleTaskRecovery(event) {
    const { taskId, taskConfig, correlationId } = event;
    
    this.logger.info('Handling task recovery notification', { taskId, correlationId });
    
    const notification = {
      type: NotificationType.TASK_RECOVERED,
      title: `Task #${taskId} Recovered`,
      message: `Task has recovered and is executing successfully`,
      data: {
        taskId,
        taskConfig,
        timestamp: new Date().toISOString(),
      },
      channels: this.getChannelsForUser(taskConfig.creator, NotificationType.TASK_RECOVERED),
      recipient: taskConfig.creator,
      priority: this.config.defaultPriorityMappings[NotificationType.TASK_RECOVERED],
    };
    
    return await this.notificationService.sendNotification(notification);
  }
  
  /**
   * Handle low gas balance warning
   */
  async handleLowGasBalance(event) {
    const { taskId, taskConfig, gasBalance, threshold, correlationId } = event;
    
    this.logger.info('Handling low gas balance notification', { taskId, gasBalance, correlationId });
    
    const notification = {
      type: NotificationType.GAS_LOW,
      title: `Task #${taskId} Low Gas Balance`,
      message: `Gas balance is ${gasBalance} (threshold: ${threshold}). Please top up to avoid execution failures.`,
      data: {
        taskId,
        gasBalance,
        threshold,
        taskConfig,
        timestamp: new Date().toISOString(),
      },
      channels: this.getChannelsForUser(taskConfig.creator, NotificationType.GAS_LOW),
      recipient: taskConfig.creator,
      priority: this.config.defaultPriorityMappings[NotificationType.GAS_LOW],
    };
    
    return await this.notificationService.sendNotification(notification);
  }
  
  /**
   * Handle task paused event
   */
  async handleTaskPaused(event) {
    const { taskId, taskConfig, reason, correlationId } = event;
    
    this.logger.info('Handling task paused notification', { taskId, reason, correlationId });
    
    const notification = {
      type: NotificationType.TASK_PAUSED,
      title: `Task #${taskId} Paused`,
      message: `Task has been paused: ${reason}`,
      data: {
        taskId,
        reason,
        taskConfig,
        timestamp: new Date().toISOString(),
      },
      channels: this.getChannelsForUser(taskConfig.creator, NotificationType.TASK_PAUSED),
      recipient: taskConfig.creator,
      priority: this.config.defaultPriorityMappings[NotificationType.TASK_PAUSED],
    };
    
    return await this.notificationService.sendNotification(notification);
  }
  
  /**
   * Handle successful task execution
   */
  async handleExecutionSuccess(event) {
    const { taskId, taskConfig, txHash, feePaid, correlationId } = event;
    
    this.logger.debug('Handling execution success notification', { taskId, correlationId });
    
    const notification = {
      type: NotificationType.EXECUTION_SUCCESS,
      title: `Task #${taskId} Executed Successfully`,
      message: `Task completed successfully (tx: ${txHash})`,
      data: {
        taskId,
        txHash,
        feePaid,
        taskConfig,
        timestamp: new Date().toISOString(),
      },
      channels: this.getChannelsForUser(taskConfig.creator, NotificationType.EXECUTION_SUCCESS),
      recipient: taskConfig.creator,
      priority: this.config.defaultPriorityMappings[NotificationType.EXECUTION_SUCCESS],
    };
    
    return await this.notificationService.sendNotification(notification);
  }
  
  /**
   * Handle skipped execution
   */
  async handleExecutionSkipped(event) {
    const { taskId, taskConfig, reason, correlationId } = event;
    
    this.logger.info('Handling execution skipped notification', { taskId, reason, correlationId });
    
    const notification = {
      type: NotificationType.EXECUTION_SKIPPED,
      title: `Task #${taskId} Execution Skipped`,
      message: `Execution was skipped: ${reason}`,
      data: {
        taskId,
        reason,
        taskConfig,
        timestamp: new Date().toISOString(),
      },
      channels: this.getChannelsForUser(taskConfig.creator, NotificationType.EXECUTION_SKIPPED),
      recipient: taskConfig.creator,
      priority: this.config.defaultPriorityMappings[NotificationType.EXECUTION_SKIPPED],
    };
    
    return await this.notificationService.sendNotification(notification);
  }
  
  /**
   * Generate and send weekly digest
   */
  async sendWeeklyDigest(event) {
    const { userId, stats, tasks, correlationId } = event;
    
    this.logger.info('Sending weekly digest', { userId, correlationId });
    
    const summary = this.generateDigestSummary(stats, tasks);
    
    const notification = {
      type: NotificationType.WEEKLY_DIGEST,
      title: 'SoroTask Weekly Digest',
      message: summary,
      data: {
        userId,
        stats,
        tasks,
        weekStart: stats.weekStart,
        weekEnd: stats.weekEnd,
        timestamp: new Date().toISOString(),
      },
      channels: this.getChannelsForUser(userId, NotificationType.WEEKLY_DIGEST),
      recipient: userId,
      priority: this.config.defaultPriorityMappings[NotificationType.WEEKLY_DIGEST],
    };
    
    return await this.notificationService.sendNotification(notification);
  }
  
  /**
   * Get notification channels for a user based on their preferences
   */
  getChannelsForUser(userId, notificationType) {
    const userPrefs = this.config.userPreferences[userId];
    
    if (userPrefs && userPrefs.channels && userPrefs.categories) {
      // Check if user has this category enabled
      if (!userPrefs.categories[notificationType]) {
        return [];
      }
      
      // Return enabled channels for this category
      const defaultChannels = this.config.defaultChannelMappings[notificationType] || [];
      return defaultChannels.filter(channel => userPrefs.channels[channel]);
    }
    
    // Return default channels if no user preferences
    return this.config.defaultChannelMappings[notificationType] || [];
  }
  
  /**
   * Generate digest summary text
   */
  generateDigestSummary(stats, tasks) {
    const lines = [
      `Weekly Summary for ${stats.weekStart} to ${stats.weekEnd}`,
      '',
      `Total Tasks: ${stats.totalTasks}`,
      `Successful Executions: ${stats.successfulExecutions}`,
      `Failed Executions: ${stats.failedExecutions}`,
      `Skipped Executions: ${stats.skippedExecutions}`,
      `Total Gas Used: ${stats.totalGasUsed}`,
      '',
    ];
    
    if (tasks.length > 0) {
      lines.push('Top Tasks:');
      tasks.slice(0, 5).forEach(task => {
        lines.push(`  - Task #${task.id}: ${task.executions} executions`);
      });
    }
    
    return lines.join('\n');
  }
  
  /**
   * Update user notification preferences
   */
  updateUserPreferences(userId, preferences) {
    this.config.userPreferences[userId] = preferences;
    this.logger.info('Updated user notification preferences', { userId });
  }
  
  /**
   * Get user notification preferences
   */
  getUserPreferences(userId) {
    return this.config.userPreferences[userId] || null;
  }
}

module.exports = {
  NotificationIntegration,
  NotificationIntegrationConfig,
};
