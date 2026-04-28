# Gas Budget Forecasting Model

## Overview

The Gas Budget Forecasting Model helps the SoroTask keeper predict near-term gas demand for scheduled task executions. It enables operators to identify underfunded tasks **before execution failures occur**, providing better visibility and control over automation costs.

## Purpose

**Problem**: Without forecasting, the system discovers insufficient gas only at execution time, leading to preventable failures and operational disruptions.

**Solution**: The forecaster analyzes historical execution costs and upcoming task schedules to:
- Estimate gas demands before tasks are due
- Detect underfunded risk conditions early
- Quantify prediction confidence levels
- Suggest minimum recommended balances

## Architecture

### Components

#### 1. **GasForecaster** (`src/gasForecaster.js`)
Core forecasting engine that:
- Maintains rolling history of execution costs per task
- Computes statistical measures (mean, median, p95, p99, std dev)
- Generates individual task forecasts with confidence levels
- Aggregates forecasts by time window
- Detects underfunded conditions

#### 2. **GasMonitor** (`src/gasMonitor.js`)
Updated monitoring layer that:
- Records execution costs from completed transactions
- Exposes forecasting methods to other components
- Supplies forecaster state to metrics endpoints
- Maintains backward compatibility with existing alert logic

#### 3. **Metrics Integration** (`src/metrics.js`)
Surfaces forecasting data through:
- `/metrics/forecast` endpoint - forecaster state and configuration
- `/metrics` endpoint - includes forecasting metrics
- Prometheus metrics - underfunded count, confidence levels, risk level
- Real-time forecast queries for external integrations

#### 4. **Task Poller** (`src/poller.js`)
Enhanced with:
- `checkForecast()` method for querying predictions before execution
- Optional forecast-based task skipping (can be enabled per workflow)
- Structured logging of forecast warnings

### Data Flow

```
Task Execution
      ↓
Extract Fee Paid
      ↓
gasMonitor.recordExecution(taskId, feePaid)
      ↓
forecaster.gasHistory[taskId].push({timestamp, feePaid})
      ↓
       
Next Polling Cycle
      ↓
poller.pollDueTasks(taskIds)
      ↓
[Optional] poller.checkForecast(taskId, taskConfig, gasMonitor)
      ↓
forecaster.forecastTaskGas(taskId, gasBalance)
      ↓
Return: {estimatedCost, confidence, isUnderfunded, ...}
```

## Forecasting Model

### Statistical Approach

For each task, the forecaster maintains a **rolling window of execution costs** (last 100 samples by default).

**Metrics Computed**:
- **Mean**: Average gas cost
- **Median**: Middle value (50th percentile)
- **Std Dev**: Standard deviation measuring variability
- **Min/Max**: Bounds of historical costs
- **P95/P99**: 95th and 99th percentile costs

### Forecast Calculation

**Estimated Cost** = P95 (95th percentile of historical costs)

Using the 95th percentile provides a conservative estimate that accounts for normal variability while avoiding extreme outliers.

**Recommended Balance** = Estimated Cost + Safety Buffer

**Safety Buffer** = Estimated Cost × (SAFETY_BUFFER_MULTIPLIER - 1)

Default: `SAFETY_BUFFER_MULTIPLIER = 1.5x`
- Recommended = P95 × 1.5
- Example: If P95 = 1000, recommend 1500 (500 stroops buffer)

### Confidence Levels

**High-Confidence Forecast**
- Condition: ≥ 5 historical samples
- Meaning: Model has sufficient data to make reliable predictions
- Use: Can inform critical operational decisions

**Low-Confidence Forecast**
- Condition: < 5 historical samples
- Meaning: Insufficient data; prediction is exploratory
- Use: Should not override other operational rules

### Risk Level (Multi-Task Forecasts)

When forecasting multiple tasks:
- **Low Risk**: No underfunded tasks, or only low-confidence underfunded tasks
- **Medium Risk**: One or more low-confidence tasks underfunded
- **High Risk**: One or more high-confidence tasks underfunded ⚠️

## API Endpoints

### GET /metrics/forecast

Returns forecaster state and configuration.

**Response**:
```json
{
  "trackedTasks": 42,
  "totalHistoricalSamples": 847,
  "safetyBufferMultiplier": 1.5,
  "aggregationWindowSeconds": 3600,
  "highConfidenceThreshold": 5,
  "taskSamples": [
    {
      "taskId": "1",
      "samples": 23
    },
    {
      "taskId": "2",
      "samples": 18
    }
  ]
}
```

### GET /metrics

Includes forecasting information in main metrics.

**Forecasting Fields**:
```json
{
  "forecasting": {
    "enabled": true,
    "safetyBuffer": 1.5,
    "aggregationWindowSeconds": 3600,
    "trackedTasks": 42,
    "totalHistoricalSamples": 847
  }
}
```

### Prometheus Metrics

New metrics available at `/metrics/prometheus`:

- `keeper_forecast_underfunded_tasks` - Gauge: number of underfunded tasks
- `keeper_forecast_high_confidence` - Gauge: high-confidence forecasts
- `keeper_forecast_low_confidence` - Gauge: low-confidence forecasts  
- `keeper_forecast_risk_level` - Gauge: 0=low, 1=medium, 2=high

## Configuration

Environment variables (in `.env` or system environment):

```bash
# Gas Forecasting
GAS_FORECAST_SAFETY_BUFFER=1.5           # Multiplier for recommended balance (default: 1.5)
GAS_FORECAST_WINDOW_SECONDS=3600         # Aggregation window for multi-task forecasts (default: 3600)

# Metrics Server
METRICS_PORT=3000                         # Port for metrics endpoints
```

## Usage Examples

### 1. Check Forecast Before Task Execution

```javascript
const forecast = gasMonitor.getForecast(taskId, gasBalance);
console.log(forecast);
// {
//   taskId: '123',
//   estimatedCost: 5000,
//   confidence: 'high',
//   isUnderfunded: true,
//   recommendedBalance: 7500,
//   stats: { count: 12, mean: 4800, p95: 5000, ... }
// }
```

### 2. Record Execution Cost

```javascript
// After transaction completes successfully
gasMonitor.recordExecution(taskId, feePaid);
```

### 3. Forecast Multiple Tasks

```javascript
const tasks = [
  { taskId: 1, gasBalance: 3000 },
  { taskId: 2, gasBalance: 5000 },
  { taskId: 3, gasBalance: 1500 }
];

const forecast = gasMonitor.getForecastMultiple(tasks);
console.log(forecast);
// {
//   highConfidenceCount: 2,
//   lowConfidenceCount: 1,
//   underfundedCount: 1,
//   riskLevel: 'high',
//   summary: '3 tasks forecasted: 2 high-confidence, 1 low-confidence. 1 underfunded.'
// }
```

### 4. Query Forecaster State

```javascript
const state = gasMonitor.getForecasterState();
console.log(`Tracking ${state.trackedTasks} tasks with ${state.totalHistoricalSamples} samples`);
```

### 5. Query via HTTP

```bash
# Get forecaster state
curl http://localhost:3000/metrics/forecast

# Get main metrics with forecasting info
curl http://localhost:3000/metrics

# Get Prometheus metrics
curl http://localhost:3000/metrics/prometheus
```

## Model Limitations

### Known Limitations

1. **Historical Pattern Assumption**
   - Model assumes future execution costs follow historical patterns
   - **Risk**: Contract behavior changes, network upgrades, or state mutations may invalidate this assumption
   - **Mitigation**: Regularly review forecasts against actual results; reset history after major network changes

2. **Network Congestion Not Modeled**
   - Forecaster does not account for temporal trends in network congestion
   - **Risk**: May underestimate costs during high-traffic periods
   - **Mitigation**: Use higher safety buffer during known congestion windows

3. **Contract State Changes Not Predicted**
   - Cannot predict unprecedented contract state changes affecting execution cost
   - **Risk**: Tasks with state-dependent costs may have volatile forecasts
   - **Mitigation**: Use low-confidence forecasts cautiously; manual review recommended for critical tasks

4. **Seasonal/Temporal Variations Ignored**
   - Model treats all samples equally; does not detect time-based patterns
   - **Risk**: Weekend vs. weekday patterns would not be captured
   - **Mitigation**: Future version could implement time-series analysis

5. **Sample Size Dependency**
   - Confidence based only on sample count, not actual forecast accuracy
   - **Risk**: A task with 5 samples may have high variance but be marked "high-confidence"
   - **Mitigation**: Manual override available; consider coefficient of variation in future

6. **Percentile-Based Estimation**
   - Using P95 may be overly conservative for some tasks, leading to unnecessary alerts
   - **Risk**: Operational overhead from false-positive underfunded warnings
   - **Mitigation**: Monitor false positive rate; adjust percentile or safety buffer as needed

### Forecast Accuracy

- **Scope of Confidence**: Confidence levels indicate data sufficiency, not prediction accuracy
- **Empirical Validation**: Operators should track forecast vs. actual costs
- **Iterative Tuning**: Safety buffer and percentile choices can be tuned based on operational experience

## Future Enhancements

Potential improvements to the forecasting model:

1. **Time-Series Analysis**
   - Detect and model temporal patterns (daily/weekly cycles)
   - Weight recent samples more heavily

2. **Anomaly Detection**
   - Identify and handle outlier executions
   - Alert on unusual cost spikes

3. **Task-Specific Models**
   - Different models per task frequency, target contract, or function
   - Learn task-specific cost patterns

4. **Cost Predictors**
   - Integrate external factors (network load metrics, contract event counts)
   - Multi-variate prediction model

5. **Confidence Intervals**
   - Return prediction ranges (low/high bounds) instead of point estimates
   - Probabilistic forecasting

6. **Model Evaluation**
   - Continuous accuracy tracking
   - A/B testing of model variants
   - Automated model tuning

## Testing

The forecasting model includes comprehensive test coverage:

```bash
# Run all tests including forecasting tests
npm test

# Test specific module
npm test -- gasMonitor.test.js
npm test -- gasForecaster.test.js
npm test -- prometheus.test.js
```

Test scenarios cover:
- Recording and retrieving historical data
- Statistical calculations (mean, percentiles, std dev)
- Forecast generation and confidence levels
- Multi-task aggregation
- Time-window based aggregation
- Underfunded detection
- Risk level calculation

## Troubleshooting

### Low-Confidence Forecasts

**Symptom**: All forecasts show `confidence: 'low'`

**Causes**:
- System recently restarted (history cleared)
- Tracking new tasks (< 5 samples each)

**Resolution**:
- Wait for tasks to execute 5+ times
- Check `/metrics/forecast` to see sample counts
- Manual oversight recommended until confidence improves

### Underfunded Warnings Keep Appearing

**Symptom**: Tasks marked underfunded but execute successfully

**Causes**:
- Safety buffer too conservative
- Actual costs lower than P95 estimate
- False positive

**Resolution**:
- Review actual vs. forecast costs
- Reduce safety buffer if pattern confirmed (set `GAS_FORECAST_SAFETY_BUFFER`)
- Increase gas balance to match recommended amount

### Forecaster Not Recording Costs

**Symptom**: `totalHistoricalSamples` not increasing after executions

**Causes**:
- Metrics not integrated (check `index.js`)
- Execution cost extraction failing
- Transaction status not 'SUCCESS'

**Resolution**:
- Check keeper logs for extraction errors
- Verify transaction completion status
- Manual `recordExecution()` call for testing

## References

- [GasForecaster Implementation](../src/gasForecaster.js)
- [GasMonitor Integration](../src/gasMonitor.js)
- [Metrics Endpoints](../src/metrics.js)
- [Task Poller Enhancement](../src/poller.js)
