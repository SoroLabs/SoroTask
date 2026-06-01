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
  }

  scoreKeeper(metrics = {}) {
    const summary = this.historyManager?.getExecutionSummary?.() || {};
    const successRate = Number(summary.successRate) || 0;
    const failureRate = Number(summary.failureRate) || 0;
    const uptimeRatio = clamp(Number(metrics.uptimeSeconds) || 0, 0, Number(metrics.expectedUptimeSeconds) || 1);
    const taskCoverage = clamp(Number(metrics.completedTasks) || 0, 0, Number(metrics.expectedTasks) || 1);
    const stakeScore = clamp(Number(metrics.stakeAmount) || 0, 0, Number(metrics.maxStakeAmount) || 1);
    const missedHeartbeatPenalty = clamp(Number(metrics.missedHeartbeats) || 0, 0, 10) / 10;

    const features = {
      successRate,
      uptime: clamp(uptimeRatio, 0, 1),
      taskCoverage: clamp(taskCoverage, 0, 1),
      stake: clamp(stakeScore, 0, 1),
      failurePenalty: clamp(failureRate, 0, 1),
      missedHeartbeatPenalty,
    };

    const score = weightedScore(features, {
      successRate: 0.36,
      uptime: 0.2,
      taskCoverage: 0.15,
      stake: 0.15,
      failurePenalty: 0.08,
      missedHeartbeatPenalty: 0.06,
    });

    return {
      reputationScore: Math.round(score * 100),
      reputationTier: classifyScore(score),
      signals: features,
      evidence: {
        successRate,
        failureRate,
        sampleCount: Number(summary.sampleCount) || 0,
      },
    };
  }
}

module.exports = {
  clamp,
  classifyScore,
  normalizeRatio,
  weightedScore,
  FailurePredictor,
  KeeperReputationScorer,
};