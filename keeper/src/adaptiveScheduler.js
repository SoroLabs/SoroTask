function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeAdaptivePollingInterval(inputs, previousIntervalMs) {
  const {
    baseIntervalMs,
    minIntervalMs,
    maxIntervalMs,
    backlogSize,
    dueCount,
    dueSoonCount,
    minSecondsUntilDue,
    avgRpcLatencyMs,
    cycleDurationMs,
    errors,
  } = inputs;

  let nextIntervalMs = baseIntervalMs;
  const reasons = [];

  if (dueCount > 0) {
    nextIntervalMs = Math.min(nextIntervalMs, Math.max(minIntervalMs, 1000));
    reasons.push('due_tasks_ready');
  }

  if (dueSoonCount > 0) {
    nextIntervalMs = Math.min(nextIntervalMs, Math.max(minIntervalMs, 2000));
    reasons.push('upcoming_due_window');
  }

  if (Number.isFinite(minSecondsUntilDue) && minSecondsUntilDue > 0) {
    const proactiveTarget = Math.floor(minSecondsUntilDue * 1000 * 0.5);
    nextIntervalMs = Math.min(nextIntervalMs, Math.max(minIntervalMs, proactiveTarget));
    reasons.push('align_to_next_due');
  }

  if (backlogSize >= 200) {
    nextIntervalMs *= 0.35;
    reasons.push('large_backlog');
  } else if (backlogSize >= 50) {
    nextIntervalMs *= 0.6;
    reasons.push('medium_backlog');
  } else if (backlogSize <= 5) {
    nextIntervalMs *= 1.2;
    reasons.push('low_backlog');
  }

  if (avgRpcLatencyMs >= 3000) {
    nextIntervalMs *= 1.9;
    reasons.push('very_high_rpc_latency');
  } else if (avgRpcLatencyMs >= 1500) {
    nextIntervalMs *= 1.5;
    reasons.push('high_rpc_latency');
  } else if (avgRpcLatencyMs >= 800) {
    nextIntervalMs *= 1.2;
    reasons.push('elevated_rpc_latency');
  }

  if (cycleDurationMs > nextIntervalMs * 0.8) {
    nextIntervalMs *= 1.2;
    reasons.push('long_cycle_duration');
  }

  if (errors > 0) {
    nextIntervalMs *= 1 + Math.min(errors, 5) * 0.1;
    reasons.push('error_backoff');
  }

  nextIntervalMs = clamp(Math.round(nextIntervalMs), minIntervalMs, maxIntervalMs);

  if (Number.isFinite(previousIntervalMs) && previousIntervalMs > 0) {
    // Smooth sudden jumps to prevent oscillation.
    const lowerBound = Math.max(minIntervalMs, Math.round(previousIntervalMs * 0.5));
    const upperBound = Math.min(maxIntervalMs, Math.round(previousIntervalMs * 2));
    nextIntervalMs = clamp(nextIntervalMs, lowerBound, upperBound);
  }

  return {
    intervalMs: nextIntervalMs,
    reasons,
  };
}

module.exports = {
  computeAdaptivePollingInterval,
};
