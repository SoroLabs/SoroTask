# Keeper Control Panel Architecture

## Overview

The Keeper Control Panel is a comprehensive, mobile-responsive management interface for monitoring and controlling Keeper nodes in the SoroTask ecosystem. This document outlines the architectural approach, component structure, and integration patterns.

## System Architecture

### High-Level Structure

```
┌─────────────────────────────────────────────────────────┐
│             Keeper Control Panel                         │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────┐   │
│  │         UI Layer (React Components)              │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │   │
│  │  │  Table   │  │  Charts  │  │   Detail     │   │   │
│  │  │Component │  │Components│  │    Modal     │   │   │
│  │  └──────────┘  └──────────┘  └──────────────┘   │   │
│  └──────────────────────────────────────────────────┘   │
│                       ↓                                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │    State Management & Hooks Layer                │   │
│  │  ┌────────────────────────────────────────────┐ │   │
│  │  │  useKeeperStore (Zustand)                 │ │   │
│  │  │  useKeeperAPI (Data fetching)             │ │   │
│  │  │  useKeeperFilters (Filtering logic)       │ │   │
│  │  │  useKeeperMetrics (Analytics)             │ │   │
│  │  └────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────┘   │
│                       ↓                                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │    Service Layer                                 │   │
│  │  ┌────────────────────────────────────────────┐ │   │
│  │  │  keeperService                            │ │   │
│  │  │  - Fetch keeper data                      │ │   │
│  │  │  - Update keeper config                   │ │   │
│  │  │  - Handle real-time updates               │ │   │
│  │  └────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────┘   │
│                       ↓                                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │    API Layer & Error Handling                    │   │
│  │  ┌────────────────────────────────────────────┐ │   │
│  │  │  Fault-tolerant API calls                 │ │   │
│  │  │  Retry logic with exponential backoff     │ │   │
│  │  │  Error classification and recovery        │ │   │
│  │  │  Fallback mechanisms                      │ │   │
│  │  └────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Component Structure

### Core Components

#### 1. **KeeperPanel** (Main Container)
- `path`: `components/keeper/KeeperPanel.tsx`
- Responsibilities:
  - Orchestrate keeper management interface
  - Handle page-level state and routing
  - Manage responsive layouts
  - Error boundary integration

#### 2. **KeeperTable**
- `path`: `components/keeper/KeeperTable.tsx`
- Features:
  - Virtual scrolling for performance (>1000 keepers)
  - Sortable columns
  - Filterable data
  - Mobile-responsive grid/table toggle
  - Selection mode for batch operations

#### 3. **KeeperStatsCard**
- `path`: `components/keeper/KeeperStatsCard.tsx`
- Displays:
  - Active keeper count
  - Health status distribution
  - Execution success rate
  - Average gas used

#### 4. **KeeperChart**
- `path`: `components/keeper/KeeperChart.tsx`
- Visualizations:
  - Keeper health over time (line chart)
  - Distribution by region (pie chart)
  - Execution frequency heatmap
  - Response time histogram

#### 5. **KeeperDetailModal**
- `path`: `components/keeper/KeeperDetailModal.tsx`
- Displays:
  - Keeper configuration
  - Performance metrics
  - Recent execution logs
  - Health status indicators
  - Action buttons (pause, restart, etc.)

### Sub-components

```
components/keeper/
├── KeeperPanel.tsx (Main)
├── KeeperTable.tsx
├── KeeperTableRow.tsx
├── KeeperStatsCard.tsx
├── KeeperChart.tsx
├── KeeperDetailModal.tsx
├── KeeperHealthIndicator.tsx
├── KeeperActions.tsx
├── KeeperFilters.tsx
└── __tests__/
    ├── KeeperPanel.test.tsx
    ├── KeeperTable.test.tsx
    ├── KeeperChart.test.tsx
    └── ...
```

## State Management

### Zustand Store Structure

```typescript
interface KeeperState {
  // Data
  keepers: Keeper[];
  selectedKeeperIds: Set<string>;
  filters: KeeperFilters;
  
  // UI
  isLoading: boolean;
  error: KeeperError | null;
  sortBy: SortConfig;
  pagination: PaginationState;
  
  // Real-time
  lastUpdated: number;
  wsConnected: boolean;
  
  // Actions
  setKeepers: (keepers: Keeper[]) => void;
  updateKeeperStatus: (id: string, status: KeeperStatus) => void;
  setFilters: (filters: KeeperFilters) => void;
  // ... other actions
}
```

## Data Models

### Keeper

```typescript
interface Keeper {
  id: string;
  address: string;
  status: 'active' | 'inactive' | 'error' | 'paused';
  healthScore: number; // 0-100
  executionCount: number;
  successRate: number; // 0-100
  averageGasUsed: number;
  region?: string;
  lastHeartbeat: Date;
  configuration: KeeperConfig;
  metrics: KeeperMetrics;
  recentExecutions: Execution[];
}

interface KeeperConfig {
  maxConcurrentTasks: number;
  gasLimit: number;
  retryPolicy: RetryPolicy;
  alertThresholds: AlertThresholds;
}

interface KeeperMetrics {
  uptime: number; // percentage
  responseTime: number; // ms
  errorRate: number; // percentage
  throughput: number; // tasks/hour
}
```

## Error Handling Strategy

### Error Classification

```typescript
enum KeeperErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  API_ERROR = 'API_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

interface KeeperError {
  type: KeeperErrorType;
  message: string;
  timestamp: Date;
  retriable: boolean;
  retryAfter?: number;
  originalError?: Error;
}
```

### Fallback Mechanisms

1. **Network Failures**
   - Retry with exponential backoff (max 3 attempts)
   - Use cached data if available
   - Show degraded UI with available data

2. **Data Inconsistencies**
   - Validate data schema on reception
   - Log validation errors
   - Use previous valid state

3. **UI Component Failures**
   - Error boundaries around each major section
   - Graceful degradation
   - Detailed error logging

## API Integration

### Endpoints

```
GET  /api/keeper                  - List all keepers
GET  /api/keeper/{id}             - Get keeper details
GET  /api/keeper/{id}/metrics     - Get keeper metrics
GET  /api/keeper/{id}/executions  - Get recent executions
PATCH /api/keeper/{id}            - Update keeper config
POST /api/keeper/{id}/pause       - Pause keeper
POST /api/keeper/{id}/resume      - Resume keeper
GET  /api/keeper/stats            - Get aggregate stats
WS   /ws/keeper/updates           - WebSocket for real-time updates
```

### Request/Response Format

```typescript
// List keepers request
GET /api/keeper?page=1&limit=50&status=active&sortBy=healthScore

// Response
{
  data: Keeper[],
  pagination: {
    page: number,
    limit: number,
    total: number,
    hasMore: boolean
  },
  meta: {
    cached: boolean,
    timestamp: ISO8601
  }
}
```

## Mobile Responsiveness

### Breakpoints

- **Mobile** (< 640px): Single column layout, simplified charts
- **Tablet** (640px - 1024px): Two column layout
- **Desktop** (> 1024px): Full multi-column layout

### Mobile-Specific Features

1. **Touch-friendly**: Larger touch targets (48px minimum)
2. **Optimized tables**: Horizontal scroll with sticky headers
3. **Collapsible sections**: Drawer-based details
4. **Performance**: Virtual scrolling for large lists
5. **Simplified charts**: Smaller visualizations with adjusted detail level

## Performance Considerations

### Optimization Strategies

1. **Virtual Scrolling**: Handle 1000+ keepers efficiently
2. **Memoization**: Prevent unnecessary re-renders
3. **Lazy Loading**: Load components on demand
4. **Data Pagination**: Load keeper data in chunks
5. **WebSocket Optimization**: Batch updates, debounce changes
6. **Chart Optimization**: Downsampled data for large datasets

### Target Metrics

- First Contentful Paint (FCP): < 2s
- Time to Interactive (TTI): < 3s
- Load 1000 keepers: < 1s
- Update metrics every 5-10 seconds

## Security Considerations

### Data Protection

1. **Authentication**: Verify keeper management permissions
2. **Validation**: Strict schema validation on all inputs
3. **Sanitization**: XSS protection in all rendered content
4. **Rate Limiting**: Prevent API abuse

### Configuration Safety

1. **Change approval**: Log all configuration changes
2. **Rollback support**: Maintain change history
3. **Audit trail**: Track who changed what and when

## Testing Strategy

### Unit Tests (>90% Coverage)

- Component rendering
- State management actions
- Service methods
- Utility functions
- Error handling

### Integration Tests

- Data pipeline end-to-end
- API interaction mocks
- Error recovery scenarios
- WebSocket connections

### E2E Tests

- Full user workflows
- Mobile responsiveness
- Performance benchmarks
- Error scenarios

## Documentation Requirements

1. **API Documentation**: Endpoint specs and examples
2. **Component Catalog**: Storybook stories
3. **Integration Guide**: How to connect keeper data sources
4. **Troubleshooting Guide**: Common issues and solutions
5. **Performance Guide**: Optimization techniques

## Implementation Phases

### Phase 1: Foundation (Week 1)
- Data models and types
- Core components structure
- Basic state management
- API service layer

### Phase 2: UI Implementation (Week 2)
- Complete all UI components
- Responsive design implementation
- Mobile optimization
- Storybook stories

### Phase 3: Integration (Week 3)
- Real API integration
- Real-time updates via WebSocket
- Error handling implementation
- Performance optimization

### Phase 4: Testing & Polish (Week 4)
- Unit tests (>90% coverage)
- Integration tests
- E2E tests
- Security review
- Documentation

## Deployment Checklist

- [ ] Unit test coverage >90%
- [ ] Integration tests passing
- [ ] Security review completed
- [ ] Performance benchmarks met
- [ ] Accessibility audit passed (WCAG AA)
- [ ] Mobile testing on real devices
- [ ] Documentation complete
- [ ] Change logs updated
- [ ] Backwards compatibility verified
