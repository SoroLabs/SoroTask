# Gas Fee Estimation and Optimization Engine

## Overview

The Gas Fee Estimation and Optimization Engine is a frontend system that calculates historical gas trends and suggests optimal execution windows for scheduled tasks on the SoroTask platform. This engine integrates with the existing keeper backend to provide intelligent gas fee forecasting and optimization recommendations.

## Architecture

### Core Components

#### 1. **Type System** (`types/gas.ts`)
Defines all TypeScript interfaces and types for the gas fee engine:
- `GasFeeDataPoint`: Historical gas fee data with timestamps
- `GasFeeStatistics`: Statistical measures (mean, median, p95, p99, std dev)
- `GasFeeForecast`: Single task gas fee prediction with confidence levels
- `MultiTaskForecast`: Aggregated forecasts for multiple tasks
- `ExecutionWindow`: Time-based optimization windows
- `GasPriceTrend`: Current gas price trend analysis
- `OptimizationRecommendation`: Actionable optimization suggestions
- `GasFeeAnalysis`: Comprehensive analysis result
- `GasFeeEngineConfig`: Configuration parameters
- `GasFeeEngineState`: Engine runtime state
- `GasFeeError`: Error handling structure

#### 2. **Error Handling** (`lib/gas/errors.ts`)
Comprehensive error management system:
- Error classification (network, API, validation, timeout, insufficient data)
- Automatic retry logic with exponential backoff
- User-friendly error messages
- Data validation and sanitization
- Sentry integration for error tracking

#### 3. **Gas Fee Service** (`lib/gas/service.ts`)
Core service layer providing:
- Historical data management
- Statistical calculations
- Gas fee forecasting
- Price trend analysis
- Optimization window generation
- Recommendation generation
- Caching and retry mechanisms
- Backend integration with fallback to client-side calculation

#### 4. **Optimization Algorithm** (`lib/gas/optimizer.ts`)
Advanced optimization engine:
- Pattern detection (daily, weekly cycles)
- Temporal trend analysis
- Execution window optimization
- Batch execution scheduling
- Confidence scoring
- Risk assessment

#### 5. **Keeper Integration** (`lib/gas/integration.ts`)
Integration layer with keeper service:
- Automatic data synchronization
- Execution gas recording
- Real-time updates
- Status monitoring
- Lifecycle management

#### 6. **React Hooks** (`hooks/useGasFeeEngine.ts`)
React integration:
- `useGasFeeEngine`: Main hook for engine access
- `useTaskGasAnalysis`: Single task analysis
- `useGasPriceTrend`: Trend monitoring with auto-refresh

#### 7. **UI Components** (`components/gas/`)
- `GasFeeForecastCard`: Display forecast information
- `OptimizationRecommendations`: Show actionable recommendations
- `GasPriceTrendIndicator`: Visual trend indicator

## Data Flow

```
Task Execution
    ↓
Keeper Backend (records gas fee)
    ↓
Gas Fee Integration (syncs data)
    ↓
Gas Fee Engine (stores in history)
    ↓
Statistical Analysis (calculates metrics)
    ↓
Forecasting (generates predictions)
    ↓
Optimization (finds best windows)
    ↓
Recommendations (actionable insights)
    ↓
UI Components (displays to user)
```

## Configuration

### Environment Variables

```bash
# API Configuration
NEXT_PUBLIC_API_URL=/api

# Gas Fee Engine Configuration
GAS_FORECAST_SAFETY_BUFFER=1.5
GAS_FORECAST_WINDOW_SECONDS=3600
GAS_PRICE_HISTORY_SIZE=200
GAS_PRICE_SHORT_WINDOW_SECONDS=300
GAS_PRICE_LONG_WINDOW_SECONDS=1800
GAS_PRICE_MIN_MULTIPLIER=0.85
GAS_PRICE_MAX_MULTIPLIER=2.0
GAS_PRICE_TREND_SENSITIVITY=0.5
```

### Engine Configuration

```typescript
const config: GasFeeEngineConfig = {
  safetyBufferMultiplier: 1.5,      // Safety buffer for gas estimates
  aggregationWindowSeconds: 3600,  // Time window for aggregation (1 hour)
  highConfidenceThreshold: 5,     // Minimum samples for high confidence
  maxHistoricalSamples: 100,      // Max samples per task
  optimizationHorizonHours: 24,   // Optimization look-ahead (24 hours)
  minSavingsThreshold: 100,       // Minimum savings to recommend (stroops)
};
```

## Usage Examples

### Basic Usage

```typescript
import { useGasFeeEngine } from '@/hooks/useGasFeeEngine';

function MyComponent() {
  const { forecastTask, forecast, isLoading, error } = useGasFeeEngine();

  const getForecast = async () => {
    const result = await forecastTask('task-123', 5000);
    console.log('Estimated cost:', result.estimatedCost);
    console.log('Confidence:', result.confidence);
    console.log('Underfunded:', result.isUnderfunded);
  };

  return (
    <div>
      <button onClick={getForecast} disabled={isLoading}>
        Get Gas Forecast
      </button>
      {forecast && <GasFeeForecastCard forecast={forecast} />}
    </div>
  );
}
```

### Task Analysis

```typescript
import { useTaskGasAnalysis } from '@/hooks/useGasFeeEngine';

function TaskAnalysis({ taskId, gasBalance }: { taskId: string; gasBalance: number }) {
  const { forecast, isLoading } = useTaskGasAnalysis(taskId, gasBalance);

  if (isLoading) return <div>Loading...</div>;
  if (!forecast) return <div>No forecast available</div>;

  return (
    <div>
      <GasFeeForecastCard forecast={forecast} />
    </div>
  );
}
```

### Price Trend Monitoring

```typescript
import { useGasPriceTrend } from '@/hooks/useGasFeeEngine';

function TrendMonitor() {
  const { priceTrend, isLoading, refresh } = useGasPriceTrend(60000); // Refresh every minute

  if (isLoading) return <div>Loading trend...</div>;
  if (!priceTrend) return <div>No trend data</div>;

  return (
    <div>
      <GasPriceTrendIndicator trend={priceTrend} />
      <button onClick={refresh}>Refresh</button>
    </div>
  );
}
```

### Optimization Recommendations

```typescript
import { useGasFeeEngine } from '@/hooks/useGasFeeEngine';
import { OptimizationRecommendations } from '@/components/gas';

function OptimizationPanel({ taskId }: { taskId: string }) {
  const { analyzeTask, analysis, isLoading } = useGasFeeEngine();

  useEffect(() => {
    analyzeTask(taskId);
  }, [taskId, analyzeTask]);

  if (isLoading) return <div>Analyzing...</div>;
  if (!analysis) return <div>No analysis available</div>;

  return (
    <div>
      <h3>Optimization Recommendations</h3>
      <OptimizationRecommendations
        recommendations={analysis.recommendations}
        onApplyRecommendation={(rec) => {
          console.log('Apply recommendation:', rec);
          // Handle recommendation application
        }}
      />
    </div>
  );
}
```

### Integration with Keeper Service

```typescript
import { getGasFeeIntegration } from '@/lib/gas/integration';

// Initialize integration
const integration = getGasFeeIntegration({
  autoSync: true,
  syncInterval: 60000,
  enableRealtimeUpdates: true,
});

// Start integration
await integration.initialize();

// Get task forecast
const forecast = await integration.getTaskGasForecast('task-123', 5000);

// Sync execution gas from keeper
await integration.syncExecutionGas('keeper-456');

// Get integration status
const status = integration.getStatus();
console.log('Integration status:', status);

// Cleanup when done
integration.destroy();
```

## API Reference

### GasFeeEngine

#### Methods

- `initialize()`: Initialize the engine and sync data
- `forecastTaskGas(taskId, gasBalance)`: Get forecast for single task
- `forecastMultipleTasks(tasks)`: Get forecasts for multiple tasks
- `getGasPriceTrend()`: Get current price trend
- `analyzeGasFees(taskId)`: Get comprehensive analysis
- `recordGasFee(taskId, fee, blockHeight?)`: Record gas fee data
- `getState()`: Get current engine state
- `reset()`: Reset engine state

### GasFeeOptimizer

#### Methods

- `detectPatterns(data)`: Detect temporal patterns in gas data
- `generateOptimizedWindows(forecast, priceTrend, historicalData)`: Generate optimization windows
- `generateRecommendations(...)`: Generate actionable recommendations
- `optimizeBatchExecution(tasks)`: Optimize batch task scheduling

### GasFeeIntegration

#### Methods

- `initialize()`: Initialize integration
- `getTaskGasForecast(taskId, gasBalance)`: Get task forecast
- `getMultiTaskForecasts(tasks)`: Get multiple task forecasts
- `recordExecutionGas(taskId, fee, blockHeight?)`: Record execution gas
- `analyzeTaskGas(taskId)`: Analyze task gas fees
- `syncExecutionGas(keeperId)`: Sync gas from keeper executions
- `getStatus()`: Get integration status
- `destroy()`: Cleanup integration

## Testing

### Running Tests

```bash
# Run all gas fee engine tests
cd frontend
npm test -- lib/gas/__tests__

# Run specific test file
npm test -- lib/gas/__tests__/errors.test.ts
npm test -- lib/gas/__tests__/optimizer.test.ts

# Run with coverage
npm test -- --coverage -- lib/gas/__tests__
```

### Test Coverage

The gas fee engine includes comprehensive unit tests covering:
- Error handling and classification
- Retry logic and exponential backoff
- Data validation and sanitization
- Statistical calculations
- Pattern detection algorithms
- Optimization window generation
- Recommendation generation
- Batch execution scheduling

Target coverage: >90%

## Security Considerations

### Data Validation

- All input data is validated before processing
- Gas fee values are sanitized to prevent injection attacks
- Timestamps are validated to ensure reasonable ranges
- Numeric values are clamped to safe ranges

### Error Handling

- Errors are classified and handled appropriately
- Sensitive information is not exposed in error messages
- Error tracking integrates with Sentry for monitoring
- Retry logic prevents infinite loops

### API Security

- All API calls use HTTPS in production
- Sensitive data is not cached in localStorage
- API keys are stored in environment variables
- Rate limiting is handled with exponential backoff

### Integration Security

- Keeper integration respects existing authentication
- No direct database access
- All data flows through established API endpoints
- Integration can be disabled if needed

## Performance Optimization

### Caching

- API responses are cached for 5 minutes
- Historical data is stored in memory
- Cache invalidation on data updates
- Configurable cache TTL

### Efficient Calculations

- Rolling window for historical data (max 100 samples)
- Lazy evaluation of statistics
- Batch processing for multiple tasks
- Debounced trend calculations

### Memory Management

- Automatic cleanup of old data
- Configurable sample limits
- Efficient data structures (Maps)
- Memory usage monitoring

## Troubleshooting

### Low Confidence Forecasts

**Symptom**: All forecasts show `confidence: 'low'`

**Causes**:
- System recently restarted (history cleared)
- Tracking new tasks (< 5 samples each)

**Resolution**:
- Wait for tasks to execute 5+ times
- Check engine state for sample counts
- Manual oversight recommended until confidence improves

### Underfunded Warnings Keep Appearing

**Symptom**: Tasks marked underfunded but execute successfully

**Causes**:
- Safety buffer too conservative
- Actual costs lower than P95 estimate
- False positive

**Resolution**:
- Review actual vs. forecast costs
- Reduce safety buffer if pattern confirmed
- Increase gas balance to match recommended amount

### Integration Not Syncing

**Symptom**: Gas data not syncing from keeper

**Causes**:
- Auto-sync disabled
- Keeper API unavailable
- Network connectivity issues

**Resolution**:
- Check integration status
- Verify keeper API is accessible
- Manual sync using `syncExecutionGas()`

### High Memory Usage

**Symptom**: Memory usage increasing over time

**Causes**:
- Too many historical samples
- Cache not clearing
- Memory leak in integration

**Resolution**:
- Reduce `maxHistoricalSamples`
- Clear cache manually
- Restart integration

## Future Enhancements

Potential improvements to the gas fee engine:

1. **Time-Series Analysis**
   - Detect and model temporal patterns (daily/weekly cycles)
   - Weight recent samples more heavily
   - Seasonal adjustments

2. **Anomaly Detection**
   - Identify and handle outlier executions
   - Alert on unusual cost spikes
   - Automatic pattern adaptation

3. **Machine Learning**
   - Train models on historical data
   - Predict execution costs more accurately
   - Adaptive confidence scoring

4. **Real-Time Optimization**
   - WebSocket-based live updates
   - Dynamic execution scheduling
   - Automatic recommendation application

5. **Advanced Visualizations**
   - Interactive gas fee charts
   - Historical trend graphs
   - Cost comparison tools

## References

- [Keeper Gas Forecasting](../../keeper/GAS_FORECASTING.md)
- [Gas Monitor Implementation](../../keeper/src/gasMonitor.js)
- [Gas Forecaster Implementation](../../keeper/src/gasForecaster.js)
- [Keeper Service Integration](../keeper/service.ts)
- [Type Definitions](../../types/gas.ts)
