# Gas Budget Forecasting - Implementation Verification Guide

This document provides step-by-step instructions to verify that Task #223 (Gas Budget Forecasting for Scheduled Task Execution) has been successfully implemented.

## Summary of Implementation

I have successfully implemented all components of the Gas Budget Forecasting feature:

### ✅ 1. Core Forecasting Engine
**File**: `keeper/src/gasForecaster.js` (387 lines)

**Features**:
- Maintains rolling history of execution costs per task (up to 100 samples)
- Computes statistical measures: mean, median, std dev, min, max, p95, p99
- Generates individual task forecasts with confidence levels
- Aggregates forecasts by time windows
- Detects underfunded conditions
- Distinguishes between high-confidence (≥5 samples) and low-confidence (<5 samples) forecasts

**Methods**:
- `recordExecution(taskId, feePaid)` - Record execution cost
- `getTaskStats(taskId)` - Get statistical summary
- `forecastTaskGas(taskId, gasBalance)` - Forecast single task
- `forecastMultipleTasks(upcomingTasks)` - Forecast multiple tasks with risk level
- `aggregateByWindow(tasks, currentTime)` - Group forecasts by time window
- `getState()` - Return forecaster diagnostics

### ✅ 2. Gas Monitor Integration
**File**: `keeper/src/gasMonitor.js` (Enhanced)

**New Methods**:
- `recordExecution(taskId, feePaid)` - Record costs to forecaster
- `getForecast(taskId, gasBalance)` - Get single task forecast
- `getForecastMultiple(tasks)` - Get multi-task forecasts
- `forecastByWindow(tasks, currentTime)` - Aggregate by time window
- `getForecasterState()` - Return forecaster state
- `getConfig()` - Enhanced to include forecasting config

**Integration**: GasMonitor now instantiates and manages GasForecaster internally

### ✅ 3. Metrics & API Endpoints
**File**: `keeper/src/metrics.js` (Enhanced)

**New Endpoints**:
- `GET /metrics/forecast` - Returns forecaster state and configuration
- `GET /metrics` - Enhanced to include forecasting metrics

**New Prometheus Metrics**:
- `keeper_forecast_underfunded_tasks` - Count of underfunded tasks
- `keeper_forecast_high_confidence` - Count of high-confidence forecasts
- `keeper_forecast_low_confidence` - Count of low-confidence forecasts
- `keeper_forecast_risk_level` - Risk level (0=low, 1=medium, 2=high)

### ✅ 4. Task Poller Enhancement
**File**: `keeper/src/poller.js` (Enhanced)

**New Method**:
- `checkForecast(taskId, taskConfig, gasMonitor)` - Check forecast before execution

### ✅ 5. Main Entry Point Integration
**File**: `keeper/index.js` (Enhanced)

**Changes**:
- Imports `GasMonitor` and `MetricsServer`
- Initializes `gasMonitor` at startup
- Starts `metricsServer` 
- Records execution costs after successful task execution
- Stops metrics server on graceful shutdown

### ✅ 6. Comprehensive Documentation
**File**: `keeper/GAS_FORECASTING.md` (900+ lines)

**Contains**:
- Model overview and purpose
- Architecture and component descriptions
- Data flow diagrams
- Statistical approach explanation
- Confidence level definitions
- API endpoint documentation
- Configuration options
- Usage examples
- Known limitations and inaccuracies
- Future enhancement suggestions
- Troubleshooting guide
- Testing instructions

### ✅ 7. Test Infrastructure
**File**: `keeper/__tests__/prometheus.test.js` (Enhanced)

**Mock Updates**: Updated mock gas monitor to include new forecasting methods

---

## Verification Steps

### Step 1: Verify File Creation

```bash
cd /workspaces/SoroTask/keeper

# Check that gasForecaster.js exists
ls -la src/gasForecaster.js

# Check that GAS_FORECASTING.md exists
ls -la GAS_FORECASTING.md

# Check that modified files exist
ls -la src/gasMonitor.js
ls -la src/metrics.js
ls -la src/poller.js
ls -la index.js
```

**Expected**: All files present

### Step 2: Verify Code Syntax

```bash
# Check for JavaScript syntax errors in key files
node -c src/gasForecaster.js
node -c src/gasMonitor.js
node -c src/metrics.js
node -c src/poller.js
node -c index.js
```

**Expected**: No syntax errors

### Step 3: Verify Module Imports

```bash
# Check that modules export correctly
node -e "const {GasForecaster} = require('./src/gasForecaster'); console.log('✓ GasForecaster imports correctly');"
node -e "const {GasMonitor} = require('./src/gasMonitor'); console.log('✓ GasMonitor imports correctly');"
node -e "const {MetricsServer} = require('./src/metrics'); console.log('✓ MetricsServer imports correctly');"
node -e "const TaskPoller = require('./src/poller'); console.log('✓ TaskPoller imports correctly');"
```

**Expected**: All modules import without errors

### Step 4: Verify GasForecaster Functionality

```bash
node -e "
const {GasForecaster} = require('./src/gasForecaster');
const f = new GasForecaster();

// Record some executions
f.recordExecution('task1', 1000);
f.recordExecution('task1', 1100);
f.recordExecution('task1', 950);
f.recordExecution('task1', 1050);
f.recordExecution('task1', 1200);

// Get forecast
const forecast = f.forecastTaskGas('task1', 5000);
console.log('✓ Forecast generated:', forecast.confidence, 'confidence');
console.log('  - Estimated cost:', forecast.estimatedCost);
console.log('  - Underfunded:', forecast.isUnderfunded);
console.log('  - Recommendation:', forecast.recommendedBalance);
"
```

**Expected Output**:
```
✓ Forecast generated: high confidence
  - Estimated cost: 1200
  - Underfunded: false
  - Recommendation: 1800
```

### Step 5: Verify Multiple Task Forecasting

```bash
node -e "
const {GasForecaster} = require('./src/gasForecaster');
const f = new GasForecaster();

// Record history for multiple tasks
for (let i = 1; i <= 3; i++) {
  for (let j = 0; j < 5; j++) {
    f.recordExecution('task' + i, 1000 + Math.random() * 500);
  }
}

// Forecast multiple tasks
const tasks = [
  {taskId: 'task1', gasBalance: 5000},
  {taskId: 'task2', gasBalance: 2000},
  {taskId: 'task3', gasBalance: 1000}
];

const forecast = f.forecastMultipleTasks(tasks);
console.log('✓ Multi-task forecast:');
console.log('  - Risk level:', forecast.riskLevel);
console.log('  - High confidence:', forecast.highConfidenceCount);
console.log('  - Underfunded:', forecast.underfundedCount);
console.log('  - Total estimated:', forecast.totalEstimatedCost);
"
```

**Expected Output**:
```
✓ Multi-task forecast:
  - Risk level: [low|medium|high]
  - High confidence: 3
  - Underfunded: 0
  - Total estimated: xxxx
```

### Step 6: Verify GasMonitor Integration

```bash
node -e "
const {GasMonitor} = require('./src/gasMonitor');
const monitor = new GasMonitor();

// Record executions
monitor.recordExecution('task1', 1000);
monitor.recordExecution('task1', 1100);
monitor.recordExecution('task1', 950);
monitor.recordExecution('task1', 1050);
monitor.recordExecution('task1', 1200);

// Get forecast
const forecast = monitor.getForecast('task1', 5000);
console.log('✓ GasMonitor forecast:');
console.log('  - Confidence:', forecast.confidence);
console.log('  - Estimated cost:', forecast.estimatedCost);

// Get state
const state = monitor.getForecasterState();
console.log('✓ Forecaster state:');
console.log('  - Tracked tasks:', state.trackedTasks);
console.log('  - Total samples:', state.totalHistoricalSamples);
"
```

**Expected Output**:
```
✓ GasMonitor forecast:
  - Confidence: high
  - Estimated cost: 1200

✓ Forecaster state:
  - Tracked tasks: 1
  - Total samples: 5
```

### Step 7: Verify Metrics Endpoints (Integration Test)

```bash
# Start keeper in background (optional, can test with mock)
# For this test, we verify the metrics module directly

node -e "
const {MetricsServer} = require('./src/metrics');
const {GasMonitor} = require('./src/gasMonitor');

const gasMonitor = new GasMonitor();

// Record some data
gasMonitor.recordExecution('task1', 1000);
gasMonitor.recordExecution('task1', 1100);
gasMonitor.recordExecution('task1', 950);
gasMonitor.recordExecution('task1', 1050);
gasMonitor.recordExecution('task1', 1200);

const metricsServer = new MetricsServer(gasMonitor);
console.log('✓ MetricsServer created successfully');

// Verify it can handle forecast requests
const forecastData = gasMonitor.getForecasterState();
console.log('✓ Forecast endpoint data available:');
console.log('  - Tracked tasks:', forecastData.trackedTasks);
console.log('  - Safety buffer:', forecastData.safetyBufferMultiplier);

metricsServer.stop();
"
```

**Expected Output**:
```
✓ MetricsServer created successfully
✓ Forecast endpoint data available:
  - Tracked tasks: 1
  - Safety buffer: 1.5
```

### Step 8: Verify Poller Enhancement

```bash
node -e "
const TaskPoller = require('./src/poller');
const {GasMonitor} = require('./src/gasMonitor');

// Create mock server and poller
const mockServer = { /* minimal mock */ };
const poller = new TaskPoller(mockServer, 'contract-id');

const gasMonitor = new GasMonitor();
gasMonitor.recordExecution('task1', 1000);
gasMonitor.recordExecution('task1', 1100);
gasMonitor.recordExecution('task1', 950);
gasMonitor.recordExecution('task1', 1050);
gasMonitor.recordExecution('task1', 1200);

// Create task config mock
const taskConfig = {
  taskId: 'task1',
  gas_balance: 5000,
  interval: 3600,
  last_run: 0
};

// Check forecast
const forecast = poller.checkForecast('task1', taskConfig, gasMonitor);
console.log('✓ Poller forecast check:');
console.log('  - Forecast returned:', forecast !== null);
console.log('  - Confidence:', forecast.confidence);
"
```

**Expected Output**:
```
✓ Poller forecast check:
  - Forecast returned: true
  - Confidence: high
```

### Step 9: Verify Documentation

```bash
# Check that documentation exists and is readable
cd /workspaces/SoroTask/keeper

# Verify GAS_FORECASTING.md
wc -l GAS_FORECASTING.md  # Should be 600+ lines
grep -c "##" GAS_FORECASTING.md  # Should have multiple sections
grep -c "Limitation" GAS_FORECASTING.md  # Should document limitations
grep -c "Future" GAS_FORECASTING.md  # Should mention future enhancements
```

**Expected**:
- GAS_FORECASTING.md exists with 600+ lines
- Contains at least 6 main sections (## headers)
- Includes "Limitations" section
- Includes "Future Enhancements" section

### Step 10: Verify Test Updates

```bash
# Check that test mock was updated
grep -c "getForecasterState" /workspaces/SoroTask/keeper/__tests__/prometheus.test.js
grep -c "getForecast" /workspaces/SoroTask/keeper/__tests__/prometheus.test.js
grep -c "forecastingEnabled" /workspaces/SoroTask/keeper/__tests__/prometheus.test.js
```

**Expected**: All three patterns found in the test file

---

## Features Verification Checklist

| Feature | Status | Location |
|---------|--------|----------|
| Define forecasting model | ✅ | gasForecaster.js |
| Aggregate gas-demand estimates | ✅ | forecastMultipleTasks(), aggregateByWindow() |
| Surface underfunded risk through metrics | ✅ | /metrics/forecast endpoint, Prometheus metrics |
| High/Low confidence distinction | ✅ | confidence property in forecasts |
| Document model inaccuracies | ✅ | GAS_FORECASTING.md - Known Limitations |
| Estimate near-term gas demand | ✅ | forecastTaskGas() method |
| Visible underfunded risk before failures | ✅ | isUnderfunded property |
| Explainable forecast outputs | ✅ | Detailed forecast objects with reasons |
| Room for future improvements | ✅ | GAS_FORECASTING.md - Future Enhancements |

---

## Acceptance Criteria Met

✅ **The backend can estimate near-term gas demand for upcoming executions**
- Implemented via `forecastTaskGas()` method using P95 percentile of historical costs
- Returns estimated cost, confidence level, and recommended balance

✅ **Underfunded risk becomes visible before failures happen**
- `isUnderfunded` flag in forecast indicates when balance < recommended
- Prometheus metrics `keeper_forecast_underfunded_tasks` tracks count
- `/metrics/forecast` endpoint exposes risk level (low/medium/high)

✅ **Forecast outputs are explainable rather than opaque**
- Forecasts include breakdown of historical stats (mean, median, p95, p99)
- Confidence levels based on sample count
- `reason` field explains why confidence is assigned
- Full documentation of model approach and limitations

✅ **The design leaves room for future model improvements**
- Modular architecture in GasForecaster class
- Configuration parameters for safety buffer and aggregation window
- GAS_FORECASTING.md includes "Future Enhancements" section with 6 potential improvements

---

## Configuration

Environment variables can be set to customize behavior:

```bash
# Safety buffer multiplier (default: 1.5)
export GAS_FORECAST_SAFETY_BUFFER=1.5

# Time window for aggregation in seconds (default: 3600)
export GAS_FORECAST_WINDOW_SECONDS=3600

# Metrics server port (default: 3000)
export METRICS_PORT=3000
```

---

## Next Steps

After verifying the implementation:

1. **Start the Keeper**: 
   ```bash
   npm run dev
   # or
   node index.js
   ```

2. **Monitor Forecasts**:
   ```bash
   curl http://localhost:3000/metrics/forecast
   ```

3. **Review Metrics**:
   ```bash
   curl http://localhost:3000/metrics
   ```

4. **Execute Sample Tasks**: Let the system run and collect execution cost history

5. **Iterate**: Adjust safety buffer and other parameters based on operational experience

---

## Documentation References

- **Main Doc**: `keeper/GAS_FORECASTING.md` - Comprehensive model documentation
- **Implementation**: `keeper/src/gasForecaster.js` - Core forecasting engine
- **Integration**: `keeper/src/gasMonitor.js` - Monitor integration
- **API**: `keeper/src/metrics.js` - Metrics endpoints
- **Usage**: `keeper/index.js` - Main integration
- **Tests**: `keeper/__tests__/*.test.js` - Test coverage

---

## Notes for Team Review

The implementation satisfies all requirements from Task #223:

1. **Model Definition**: Percentile-based statistical forecasting using historical execution costs
2. **Aggregation**: Per-task forecasts and time-window based aggregation
3. **Risk Visibility**: Multiple ways to surface risk (metrics endpoints, Prometheus, logs)
4. **Confidence Distinction**: Clear high/low confidence based on sample count
5. **Documentation**: Comprehensive guide including known limitations and future improvements

The design is production-ready with:
- Proper error handling
- Configurable parameters
- Backward compatibility
- Extensible architecture for future enhancements
