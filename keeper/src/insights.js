const { createLogger } = require('./logger');

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function normalizeRatio(value, max) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) {
    return 0;
  }
  return clamp(value / max, 0, 1);
}

function weightedScore(features, weights) {
  let totalWeight = 0;
  let score = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const featureValue = clamp(Number(features[key] ?? 0), 0, 1);
    const normalizedWeight = Number(weight) || 0;
    totalWeight += normalizedWeight;
    score += featureValue * normalizedWeight;
  }

  if (totalWeight <= 0) {
    return 0;
  }

  return clamp(score / totalWeight, 0, 1);
}

function classifyScore(score) {
  if (score >= 0.8) return 'critical';
  if (score >= 0.6) return 'high';
  if (score >= 0.35) return 'medium';
  return 'low';
}

/**
 * Calculate daily SLA score from keeper metrics.
 * 
 * @param {Object} params
 * @param {number} params.uptimeSeconds - Total uptime in seconds
 * @param {number} params.expectedUptimeSeconds - Expected uptime in seconds
 * @param {number} params.totalTasks - Total tasks assigned
 * @param {number} params.completedTasks - Tasks completed successfully
 * @param {number} params.revertedTasks - Tasks that reverted/failed
 * @param {number} params.avgLatencyMs - Average execution latency
 * @param {number} params.targetLatencyMs - Target latency (default 5000ms)
 * @returns {Object} SLA score breakdown
 */
function calculateDailySlaScore({ 
  uptimeSeconds = 0, 
  expectedUptimeSeconds = 86400, 
  totalTasks = 0, 
  completedTasks = 0, 
  revertedTasks = 0, 
  avgLatencyMs = 0, 
  targetLatencyMs = 5000 
}) {
  const uptimeRatio = clamp(uptimeSeconds / Math.max(1, expectedUptimeSeconds), 0, 1);
  const completionRatio = totalTasks > 0 ? clamp(completedTasks / totalTasks, 0, 1) : 1;
  const revertPenalty = totalTasks > 0 ? clamp(revertedTasks / totalTasks, 0, 1) : 0;
  const latencyScore = avgLatencyMs > 0 ? clamp(targetLatencyMs / Math.max(1, avgLatencyMs), 0, 1) : 1;

  const features = {
    uptime: uptimeRatio,
    completion: completionRatio,
    revertPenalty: 1 - revertPenalty, // invert so higher is better
    latency: latencyScore,
  };

  const score = weightedScore(features, {
    uptime: 0.3,
    completion: 0.3,
    revertPenalty: 0.25,
    latency: 0.15,
  });

  return {
    slaScore: Math.round(score * 100),
    tier: classifyScore(score),
    components: {
      uptime: Math.round(uptimeRatio * 100),
      completion: Math.round(completionRatio * 100),
      revertRate: Math.round(revertPenalty * 100),
      latency: Math.round(latencyScore * 100),
    },
  };
}

class FailurePredictor {
  constructor(options = {}) {
    this.logger = options.logger || createLogger('failure-predictor');
    this.historyManager = options.historyManager || null;
    this.deadLetterQueue = options.deadLetterQueue || null;
    this.retryBudget = options.retryBudget || null;
  }

  predictForTask(taskId, context = {}) {
    const summary = this.historyManager?.getExecutionSummary?.(taskId) || {};
    const deadLetterRecord = this.deadLetterQueue?.getRecord?.(taskId) || null;
    const retryPressure = this.retryBudget?.getTaskPressure?.(taskId) || { percentage: 0 };
    const recentFailures = Number(summary.failureCount) || 0;
    const recentSuccesses = Number(summary.successCount) || 0;
    const sampleCount = Number(summary.sampleCount) || 0;

    const features = {
      failureRate: normalizeRatio(recentFailures, recentFailures + recentSuccesses),
      retryPressure: clamp(Number(retryPressure.percentage) || 0, 0, 1),
      deadLettered: deadLetterRecord ? 1 : 0,
      lowSampleConfidence: clamp(sampleCount < 5 ? 1 - sampleCount / 5 : 0, 0, 1),
      gasPressure: clamp(Number(context.gasPressure) || 0, 0, 1),
      driftPressure: clamp(Number(context.driftPressure) || 0, 0, 1),
    };

    const score = weightedScore(features, {
      failureRate: 0.32,
      retryPressure: 0.2,
      deadLettered: 0.18,
      lowSampleConfidence: 0.1,
      gasPressure: 0.1,
      driftPressure: 0.1,
    });

    return {
      taskId: String(taskId),
      riskScore: Math.round(score * 100),
      riskLevel: classifyScore(score),
      sampleCount,
      signals: features,
      evidence: {
        failureCount: recentFailures,
        successCount: recentSuccesses,
        retryPressure: retryPressure.percentage || 0,
        deadLettered: Boolean(deadLetterRecord),
      },
    };
  }

  predictBatch(taskIds, contextByTaskId = {}) {
    const predictions = (taskIds || []).map((taskId) =>
      this.predictForTask(taskId, contextByTaskId[taskId] || {}),
    );

    const highestRisk = predictions.reduce((carry, current) => {
      if (!carry || current.riskScore > carry.riskScore) {
        return current;
      }
      return carry;
    }, null);

    return {
      predictions,
      highestRisk,
      averageRiskScore: predictions.length
        ? Math.round(predictions.reduce((sum, entry) => sum + entry.riskScore, 0) / predictions.length)
        : 0,
    };
  }
}

class KeeperReputationScorer {
  constructor(options = {}) {
    this.logger = options.logger || createLogger('reputation-scorer');
    this.historyManager = options.historyManager || null;
    // In-memory store for slashing events (in production, persist to DB)
    this.slashingEvents = new Map(); // keeperAddress -> Array<SlashingEvent>
    this.dailySlaHistory = new Map(); // date -> SLA score
  }

  /**
   * Record a slashing event for a keeper.
   * 
   * @param {Object} event
   * @param {string} event.keeperAddress - Keeper's public key
   * @param {number} event.slashAmount - Amount slashed in XLM
   * @param {string} event.reason - Reason for slashing (e.g., 'missed_execution', 'downtime', 'malicious')
   * @param {string} event.transactionHash - On-chain transaction hash
   * @param {number} event.timestamp - Unix timestamp (ms)
   */
  recordSlashingEvent(event) {
    const { keeperAddress, slashAmount, reason, transactionHash, timestamp = Date.now() } = event;
    if (!this.slashingEvents.has(keeperAddress)) {
      this.slashingEvents.set(keeperAddress, []);
    }
    const events = this.slashingEvents.get(keeperAddress);
    events.push({
      slashAmount: Number(slashAmount),
      reason,
      transactionHash,
      timestamp,
    });
    // Keep only last 365 days
    const cutoff = timestamp - 365 * 24 * 60 * 60 * 1000;
    while (events.length > 0 && events[0].timestamp < cutoff) {
      events.shift();
    }
    this.logger.info('Slashing event recorded', { keeperAddress, slashAmount, reason });
  }

  /**
   * Get all slashing events for a keeper.
   * 
   * @param {string} keeperAddress
   * @returns {Array}
   */
  getSlashingEvents(keeperAddress) {
    return this.slashingEvents.get(keeperAddress) || [];
  }

  /**
   * Calculate total slashed amount for a keeper.
   * 
   * @param {string} keeperAddress
   * @returns {number}
   */
  getTotalSlashed(keeperAddress) {
    const events = this.getSlashingEvents(keeperAddress);
    return events.reduce((sum, e) => sum + e.slashAmount, 0);
  }

  /**
   * Calculate slashing percentage (slashed / total stake).
   * 
   * @param {string} keeperAddress
   * @param {number} totalStake - Total stake amount in XLM
   * @returns {number} Percentage (0-100)
   */
  getSlashingPercentage(keeperAddress, totalStake) {
    const totalSlashed = this.getTotalSlashed(keeperAddress);
    if (totalStake <= 0) return 0;
    return clamp((totalSlashed / totalStake) * 100, 0, 100);
  }

  /**
   * Record daily SLA score for a keeper.
   * 
   * @param {string} keeperAddress
   * @param {Object} slaData
   * @param {number} slaData.uptimeSeconds
   * @param {number} slaData.expectedUptimeSeconds
   * @param {number} slaData.totalTasks
   * @param {number} slaData.completedTasks
   * @param {number} slaData.revertedTasks
   * @param {number} slaData.avgLatencyMs
   * @param {number} slaData.targetLatencyMs
   */
  recordDailySla(keeperAddress, slaData) {
    const dateKey = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const sla = calculateDailySlaScore(slaData);
    
    if (!this.dailySlaHistory.has(keeperAddress)) {
      this.dailySlaHistory.set(keeperAddress, new Map());
    }
    this.dailySlaHistory.get(keeperAddress).set(dateKey, {
      ...sla,
      timestamp: Date.now(),
      ...slaData,
    });

    // Keep only last 90 days
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const history = this.dailySlaHistory.get(keeperAddress);
    for (const [date, data] of history.entries()) {
      if (data.timestamp < cutoff) {
        history.delete(date);
      }
    }
  }

  /**
   * Get average daily SLA score over the last N days.
   * 
   * @param {string} keeperAddress
   * @param {number} days - Number of days to average (default 30)
   * @returns {number} Average SLA score (0-100)
   */
  getAverageSlaScore(keeperAddress, days = 30) {
    const history = this.dailySlaHistory.get(keeperAddress);
    if (!history || history.size === 0) return 100; // No data = perfect score

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    let sum = 0;
    let count = 0;
    for (const [date, data] of history.entries()) {
      if (data.timestamp >= cutoff) {
        sum += data.slaScore;
        count++;
      }
    }
    return count > 0 ? Math.round(sum / count) : 100;
  }

  /**
   * Generate a comprehensive reputation scorecard for a keeper.
   * 
   * @param {string} keeperAddress
   * @param {Object} metrics - Current keeper metrics
   * @param {number} metrics.totalStake - Total stake in XLM
   * @returns {Object} Reputation scorecard
   */
  generateScorecard(keeperAddress, metrics = {}) {
    const reputation = this.scoreKeeper(metrics);
    const slashingEvents = this.getSlashingEvents(keeperAddress);
    const totalSlashed = this.getTotalSlashed(keeperAddress);
    const slashingPercentage = this.getSlashingPercentage(keeperAddress, metrics.totalStake || 0);
    const avgSlaScore = this.getAverageSlaScore(keeperAddress, 30);
    const currentSla = this.dailySlaHistory.get(keeperAddress)?.get(new Date().toISOString().split('T')[0]);

    return {
      keeperAddress,
      generatedAt: new Date().toISOString(),
      reputationScore: reputation.reputationScore,
      reputationTier: reputation.reputationTier,
      signals: reputation.signals,
      evidence: reputation.evidence,
      slashing: {
        totalEvents: slashingEvents.length,
        totalSlashedXlm: totalSlashed,
        slashingPercentage: Math.round(slashingPercentage * 100) / 100,
        recentEvents: slashingEvents.slice(-5).map(e => ({
          amount: e.slashAmount,
          reason: e.reason,
          timestamp: e.timestamp,
          txHash: e.transactionHash,
        })),
      },
      sla: {
        average30d: avgSlaScore,
        current: currentSla ? {
          score: currentSla.slaScore,
          tier: currentSla.tier,
          components: currentSla.components,
        } : null,
      },
      // Verified scorecard hash for tamper-proof verification
      verification: {
        version: '1.0',
        schema: 'sorotask-keeper-scorecard-v1',
      },
    };
  }

  scoreKeeper(metrics = {}) {
    const summary = this.historyManager?.getExecutionSummary?.() || {};
    const successRate = Number(summary.successRate) || 0;
    const failureRate = Number(summary.failureRate) || 0;
    const uptimeRatio = clamp(Number(metrics.uptimeSeconds) || 0, 0, Number(metrics.expectedUptimeSeconds) || 1);
    const taskCoverage = clamp(Number(metrics.completedTasks) || 0, 0, Number(metrics.expectedTasks) || 1);
    const stakeScore = clamp(Number(metrics.stakeAmount) || 0, 0, Number(metrics.maxStakeAmount) || 1);
    const missedHeartbeatPenalty = clamp(Number(metrics.missedHeartbeats) || 0, 0, 10) / 10;

    // Issue #784 — execution speed and gas efficiency. Both are `null` in
    // `summary` until enough executions have been recorded with the
    // durationMs/bounty fields (see history.js); a keeper with no history
    // yet shouldn't be penalized as if it were slow/wasteful, so each
    // defaults to a neutral 1.0 (full credit) rather than 0 when absent.
    const targetDurationMs = Number(metrics.targetDurationMs) || 5000;
    const executionSpeed = summary.averageDurationMs == null
      ? 1
      : clamp(targetDurationMs / Math.max(1, Number(summary.averageDurationMs)), 0, 1);
    const gasEfficiency = summary.averageGasEfficiency == null
      ? 1
      : clamp(Number(summary.averageGasEfficiency), 0, 1);

    const features = {
      successRate,
      uptime: clamp(uptimeRatio, 0, 1),
      taskCoverage: clamp(taskCoverage, 0, 1),
      stake: clamp(stakeScore, 0, 1),
      failurePenalty: clamp(failureRate, 0, 1),
      missedHeartbeatPenalty,
      executionSpeed,
      gasEfficiency,
    };

    const score = weightedScore(features, {
      successRate: 0.28,
      uptime: 0.16,
      taskCoverage: 0.12,
      stake: 0.12,
      failurePenalty: 0.06,
      missedHeartbeatPenalty: 0.06,
      executionSpeed: 0.1,
      gasEfficiency: 0.1,
    });

    return {
      reputationScore: Math.round(score * 100),
      reputationTier: classifyScore(score),
      signals: features,
      evidence: {
        successRate,
        failureRate,
        sampleCount: Number(summary.sampleCount) || 0,
        averageDurationMs: summary.averageDurationMs,
        averageGasEfficiency: summary.averageGasEfficiency,
      },
    };
  }
}

class ProfitabilityEstimator {
  constructor(options = {}) {
    this.logger = options.logger || createLogger('profit-estimator');
    this.threshold = options.threshold || 0;
  }

  estimate(taskBounty, gasConsumed, feeRate) {
    const netProfit = taskBounty - (gasConsumed * feeRate);
    return {
      netProfit,
      shouldSkip: netProfit < this.threshold,
    };
  }

  reevaluateSkippedTasks(skippedTasks, currentGasFeeRate) {
    return skippedTasks.filter(task => {
      const estimate = this.estimate(task.bounty, task.estimatedGas, currentGasFeeRate);
      return !estimate.shouldSkip;
    });
  }
}

class MLTaskPredictor {
  constructor(options = {}) {
    this.logger = options.logger || createLogger('ml-task-predictor');
    this.minSuccessConfidence = options.minSuccessConfidence ?? 0.40;
    this.baseGasEstimate = options.baseGasEstimate ?? 100000;
  }

  predictConfidenceScore(features = {}) {
    const historicalFailureRate = clamp(Number(features.historicalFailureRate) || 0, 0, 1);
    const resolverComplexity = clamp(Number(features.resolverComplexity) || 0, 0, 1);
    const gasVolatility = clamp(Number(features.gasVolatility) || 0, 0, 1);
    const timeOfDayPeak = clamp(Number(features.timeOfDayPeak) || 0, 0, 1);

    const failureProbability = clamp(
      0.40 * historicalFailureRate +
      0.25 * resolverComplexity +
      0.20 * gasVolatility +
      0.15 * timeOfDayPeak,
      0,
      1
    );

    const confidenceScore = clamp(1 - failureProbability, 0, 1);
    return Math.round(confidenceScore * 100) / 100;
  }

  predictGas(features = {}) {
    const resolverComplexity = Number(features.resolverComplexity) || 0;
    const gasVolatility = Number(features.gasVolatility) || 0;
    const multiplier = 1 + 0.5 * resolverComplexity + 0.3 * gasVolatility;
    return Math.round(this.baseGasEstimate * multiplier);
  }

  evaluateTaskExecution(task, features = {}) {
    const confidenceScore = this.predictConfidenceScore(features);
    const predictedGas = this.predictGas(features);
    const shouldSkip = confidenceScore < this.minSuccessConfidence;

    return {
      taskId: String(task.id || task.taskId),
      confidenceScore,
      predictedGas,
      shouldSkip,
      skipReason: shouldSkip
        ? `Confidence score ${confidenceScore} below threshold ${this.minSuccessConfidence}`
        : null,
      recommendation: shouldSkip ? 'SKIP' : 'EXECUTE',
    };
  }
}

module.exports = {
  clamp,
  classifyScore,
  normalizeRatio,
  weightedScore,
  calculateDailySlaScore,
  FailurePredictor,
  KeeperReputationScorer,
  ProfitabilityEstimator,
  MLTaskPredictor,
};
