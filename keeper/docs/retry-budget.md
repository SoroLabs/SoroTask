# Retry Budget Accounting

This document describes the retry budget system implemented to prevent infinite failure spirals from consuming disproportionate backend capacity.

## Overview

The retry budget system tracks retry consumption across two dimensions:
1. **Global budget** - Total retries allowed within a time window
2. **Per-task budget** - Retries allowed per individual task within a time window

When budgets are exhausted, the system enters a cooldown period before resuming retry scheduling.

## Configuration

The following environment variables control retry budget behavior:

| Variable | Default | Description |
|----------|---------|-------------|
| `GLOBAL_RETRY_BUDGET` | 1000 | Maximum global retries per window |
| `GLOBAL_BUDGET_WINDOW_MS` | 3600000 | Global budget window (1 hour) |
| `TASK_RETRY_BUDGET` | 10 | Maximum retries per task per window |
| `TASK_BUDGET_WINDOW_MS` | 3600000 | Per-task budget window (1 hour) |
| `BUDGET_COOLDOWN_MS` | 60000 | Cooldown period after exhaustion (1 minute) |
| `BUDGET_WARNING_THRESHOLD` | 0.8 | Warning threshold (80% of budget) |

## How It Works

### Sliding Window Tracking

The system uses a sliding window algorithm to track consumption:
- Consumption is recorded with timestamps
- Only entries within the current window are counted
- Old entries are automatically cleaned up

### Budget Exhaustion

When a retry is requested:

1. **Cooldown check** - If in cooldown, retry is blocked
2. **Global budget check** - If global budget exhausted, cooldown activates and retry is blocked
3. **Per-task budget check** - If task budget exhausted, retry is blocked

When global budget is exhausted:
- Cooldown is automatically activated
- All retries are blocked until cooldown expires
- This prevents runaway retry storms

### Pressure Levels

Budget pressure is categorized into levels for monitoring:

| Level | Global Used | Description |
|-------|-------------|-------------|
| `low` | 0-50% | Normal operation |
| `medium` | 50-80% | Elevated retry activity |
| `high` | 80-95% | Approaching exhaustion |
| `critical` | 95-100% | Near exhaustion |

## Metrics

The following Prometheus metrics are exposed:

### Counters

- `keeper_retry_budget_consumed_total{scope="global|task"}` - Total retries consumed
- `keeper_retry_budget_exhausted_total{scope="global|task",reason="cooldown|limit"}` - Exhaustion events

### Gauges

- `keeper_retry_budget_global_available` - Global budget availability (0.0-1.0)
- `keeper_retry_budget_global_used` - Global budget consumed
- `keeper_retry_budget_in_cooldown` - Cooldown state (0=active, 1=cooldown)
- `keeper_retry_budget_cooldown_remaining_ms` - Remaining cooldown time
- `keeper_retry_budget_pressure_level` - Pressure level (0=low, 1=medium, 2=high, 3=critical)
- `keeper_retry_budget_task_count` - Number of tasks with tracked budgets

## Health Endpoint

The `/health` endpoint includes retry budget status:

```json
{
  "status": "ok",
  "retryBudget": {
    "global": {
      "used": 150,
      "limit": 1000,
      "percentage": 0.15,
      "available": 0.85
    },
    "taskCount": 12,
    "cooldownActive": false,
    "cooldownRemainingMs": 0,
    "pressure": "low",
    "totalExhaustedEvents": 0,
    "warningThreshold": 0.8
  }
}
```

## Tuning Guide

### Sizing Global Budget

Consider these factors when sizing the global budget:

1. **Expected retry rate** - Normal retry rate under healthy conditions
2. **Incident spike capacity** - Ability to handle elevated retry during outages
3. **Backend capacity** - Compute/network budget for retries
4. **Window duration** - Shorter windows = more responsive to changes

**Example sizing:**
- Normal conditions: 100 retries/hour
- Incident spike: 500 retries/hour
- Safety buffer: 2x spike = 1000 retries/hour
- Set `GLOBAL_RETRY_BUDGET=1000` with `GLOBAL_BUDGET_WINDOW_MS=3600000`

### Sizing Per-Task Budget

Per-task budgets prevent a single failing task from consuming excessive resources:

1. **Task failure rate** - Expected failures for individual tasks
2. **Task importance** - Critical tasks may need higher budgets
3. **Retry difficulty** - Complex tasks may need more attempts

**Example sizing:**
- Most tasks: 5-10 retries per hour
- Resilient tasks: 3-5 retries per hour
- Critical tasks: 10-20 retries per hour
- Set `TASK_RETRY_BUDGET=10` with `TASK_BUDGET_WINDOW_MS=3600000`

### Cooldown Tuning

The cooldown period prevents rapid re-exhaustion after budget is depleted:

1. **Recovery time** - How long until healthy operation resumes
2. **Incident duration** - Expected incident duration
3. **Freshness requirement** - How quickly retries should resume after cooldown

**Recommendations:**
- Minimum: 30 seconds (for brief outages)
- Default: 60 seconds
- Extended: 300 seconds (5 minutes) for severe incidents

### Warning Threshold

The warning threshold (`BUDGET_WARNING_THRESHOLD`) triggers elevated logging:

- Set to 0.8 (80%) for early warning
- Operators can set up alerts when pressure reaches "high"

## Troubleshooting

### Budget Exhausted Frequently

If budgets exhaust frequently:

1. **Check for underlying issues** - High failure rate indicates problems beyond retries
2. **Increase budget temporarily** - While investigating root causes
3. **Add task-level limits** - Prevent noisy neighbors

### Cooldown Activating Often

If cooldown activates frequently:

1. **Increase global budget** - Capacity may be undersized
2. **Lengthen window** - Reduce responsiveness to brief spikes
3. **Investigate failing tasks** - May indicate systemic issues

### Retries Blocked Despite Budget Available

Check for:
1. **Per-task exhaustion** - Individual task may be exhausted
2. **Cooldown active** - Check `cooldownRemainingMs` in health response
3. **Clock skew** - If multiple keeper instances have inconsistent clocks

## Integration Points

### Keeper Index

The retry budget tracker is initialized in `keeper/index.js`:

```javascript
const { RetryBudget } = require('./src/retryBudget');

const budgetTracker = new RetryBudget(config);
await budgetTracker.initialize();

metricsServer.setRetryBudgetTracker(budgetTracker);
retryScheduler.setBudgetTracker(budgetTracker);
```

### RetryScheduler

The `RetryScheduler` automatically checks budget before scheduling:

```javascript
const result = await retryScheduler.scheduleRetry({
  taskId: 123,
  error: someError,
  currentAttempt: 1,
  taskConfig: taskConfig,
});

if (!result.scheduled) {
  console.log('Retry blocked:', result.reason);
}
```

## Persistence

Budget state is persisted to `./data/retry-budget.json` to survive restarts:
- Global consumption window
- Per-task consumption windows
- Cooldown state
- Exhaustion event counts

On startup, expired entries are filtered and cooldown is recalculated if needed.