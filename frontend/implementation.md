# Keeper Control Panel - API Integration Guide

## Table of Contents

1. [Overview](#overview)
2. [API Endpoints](#api-endpoints)
3. [Data Models](#data-models)
4. [Integration Examples](#integration-examples)
5. [Error Handling](#error-handling)
6. [WebSocket Integration](#websocket-integration)
7. [Testing Guide](#testing-guide)

## Overview

This document provides comprehensive guidance for integrating backend services with the Keeper Control Panel frontend. The control panel expects specific API endpoints and data formats.

## API Endpoints

### Base URL

```
Production: https://api.sorotask.com/api/keeper
Development: http://localhost:3001/api/keeper
```

### List Keepers

**Endpoint**: `GET /api/keeper`

**Query Parameters**:
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 50, max: 500)
- `status` (string): Comma-separated status filter (active, inactive, paused, error, unhealthy)
- `region` (string): Comma-separated region filter
- `sortBy` (string): Field to sort by (default: healthScore)
- `sortOrder` (string): Sort order - 'asc' or 'desc' (default: desc)
- `search` (string): Search query for address/ID

**Request Example**:
```bash
curl -X GET "https://api.sorotask.com/api/keeper?page=1&limit=50&status=active&sortBy=healthScore&sortOrder=desc"
```

**Response Format**:
```json
{
  "data": [
    {
      "id": "keeper-1",
      "address": "GA7QSTF47FSUJJQQ5L5TR4DIBBS5IOJ4BB4A7JLBG2W34Hchiesq",
      "status": "active",
      "healthScore": 95,
      "executionCount": 1250,
      "successRate": 99.5,
      "failureRate": 0.5,
      "averageGasUsed": 5000,
      "region": "us-east",
      "lastHeartbeat": "2026-06-01T10:30:00Z",
      "uptimePercentage": 99.9,
      "totalTasks": 2000,
      "failedTasks": 10,
      "configuration": { ... },
      "metrics": { ... },
      "recentExecutions": [ ... ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1000,
    "hasMore": true,
    "totalPages": 20
  },
  "meta": {
    "cached": false,
    "timestamp": "2026-06-01T10:35:00Z"
  }
}
```

### Get Keeper Details

**Endpoint**: `GET /api/keeper/{keeperId}`

**Path Parameters**:
- `keeperId` (string, required): Keeper ID

**Request Example**:
```bash
curl -X GET "https://api.sorotask.com/api/keeper/keeper-1"
```

**Response Format**:
```json
{
  "data": {
    "id": "keeper-1",
    "address": "GA7QSTF47FSUJJQQ5L5TR4DIBBS5IOJ4BB4A7JLBG2W34HCHIE",
    "status": "active",
    "healthScore": 95,
    ...
    "recentExecutions": [
      {
        "id": "exec-1",
        "taskId": "task-1",
        "keeperId": "keeper-1",
        "status": "success",
        "startTime": "2026-06-01T10:30:00Z",
        "endTime": "2026-06-01T10:30:05Z",
        "duration": 5000,
        "gasUsed": 5000,
        "result": {}
      }
    ]
  },
  "meta": {
    "cached": false,
    "timestamp": "2026-06-01T10:35:00Z"
  }
}
```

### Get Keeper Metrics

**Endpoint**: `GET /api/keeper/{keeperId}/metrics`

**Response Format**:
```json
{
  "uptime": 99.9,
  "responseTime": 150,
  "p95ResponseTime": 250,
  "p99ResponseTime": 350,
  "errorRate": 0.5,
  "throughput": 100,
  "averageGasPerTask": 5000,
  "totalGasUsed": 500000,
  "lastUpdate": "2026-06-01T10:35:00Z"
}
```

### Get Recent Executions

**Endpoint**: `GET /api/keeper/{keeperId}/executions`

**Query Parameters**:
- `limit` (number): Number of recent executions to return (default: 50, max: 500)
- `offset` (number): Pagination offset (default: 0)

**Response Format**:
```json
[
  {
    "id": "exec-1",
    "taskId": "task-1",
    "keeperId": "keeper-1",
    "status": "success",
    "startTime": "2026-06-01T10:30:00Z",
    "endTime": "2026-06-01T10:30:05Z",
    "duration": 5000,
    "gasUsed": 5000,
    "result": {}
  },
  {
    "id": "exec-2",
    "taskId": "task-2",
    "keeperId": "keeper-1",
    "status": "failed",
    "startTime": "2026-06-01T10:25:00Z",
    "endTime": "2026-06-01T10:25:10Z",
    "duration": 10000,
    "gasUsed": 0,
    "errorMessage": "Task execution timeout",
    "errorCode": "TIMEOUT"
  }
]
```

### Get Keeper Statistics

**Endpoint**: `GET /api/keeper/stats`

**Response Format**:
```json
{
  "totalKeepers": 100,
  "activeKeepers": 95,
  "inactiveKeepers": 3,
  "unhealthyKeepers": 2,
  "averageHealthScore": 94.2,
  "averageSuccessRate": 99.1,
  "totalExecutions": 50000,
  "totalFailedExecutions": 450,
  "regionDistribution": {
    "us-east": 30,
    "us-west": 25,
    "eu-central": 25,
    "ap-southeast": 15,
    "other": 5
  },
  "statusDistribution": {
    "active": 95,
    "inactive": 3,
    "paused": 1,
    "error": 1,
    "unhealthy": 0
  }
}
```

### Update Keeper Configuration

**Endpoint**: `PATCH /api/keeper/{keeperId}`

**Request Body**:
```json
{
  "configuration": {
    "maxConcurrentTasks": 15,
    "gasLimit": 60000,
    "networkTimeout": 35000,
    "retryPolicy": {
      "maxRetries": 4,
      "initialDelayMs": 1500,
      "maxDelayMs": 45000,
      "backoffMultiplier": 2
    },
    "alertThresholds": {
      "errorRateThreshold": 10,
      "responseTimeThreshold": 6000,
      "lowUptimeThreshold": 90,
      "gasLimitWarning": 85
    }
  }
}
```

**Response Format**:
```json
{
  "success": true,
  "message": "Keeper configuration updated successfully",
  "data": {
    "id": "keeper-1",
    ...
  }
}
```

### Pause Keeper

**Endpoint**: `POST /api/keeper/{keeperId}/pause`

**Request Body**: (empty)

**Response Format**:
```json
{
  "success": true,
  "message": "Keeper paused successfully"
}
```

### Resume Keeper

**Endpoint**: `POST /api/keeper/{keeperId}/resume`

**Request Body**: (empty)

**Response Format**:
```json
{
  "success": true,
  "message": "Keeper resumed successfully"
}
```

### Restart Keeper

**Endpoint**: `POST /api/keeper/{keeperId}/restart`

**Request Body**: (empty)

**Response Format**:
```json
{
  "success": true,
  "message": "Keeper restart initiated"
}
```

## Data Models

### Keeper

```typescript
interface Keeper {
  id: string;
  address: string;
  status: 'active' | 'inactive' | 'error' | 'paused' | 'unhealthy';
  healthScore: number; // 0-100
  executionCount: number;
  successRate: number; // 0-100
  failureRate: number; // 0-100
  averageGasUsed: number;
  region?: 'us-east' | 'us-west' | 'eu-central' | 'ap-southeast' | 'other';
  lastHeartbeat: string; // ISO 8601 date
  uptimePercentage: number; // 0-100
  totalTasks: number;
  failedTasks: number;
  configuration: KeeperConfig;
  metrics: KeeperMetrics;
  recentExecutions: Execution[];
  createdAt: string; // ISO 8601 date
  updatedAt: string; // ISO 8601 date
}
```

### KeeperConfig

```typescript
interface KeeperConfig {
  maxConcurrentTasks: number;
  gasLimit: number;
  gasPrice: string;
  networkTimeout: number; // milliseconds
  retryPolicy: RetryPolicy;
  alertThresholds: AlertThresholds;
  enableHeartbeat: boolean;
  heartbeatInterval: number; // seconds
}
```

### KeeperMetrics

```typescript
interface KeeperMetrics {
  uptime: number; // percentage
  responseTime: number; // average response time in ms
  p95ResponseTime: number; // 95th percentile response time
  p99ResponseTime: number; // 99th percentile response time
  errorRate: number; // percentage
  throughput: number; // tasks per hour
  averageGasPerTask: number;
  totalGasUsed: number;
  lastUpdate: string; // ISO 8601 date
}
```

## Integration Examples

### JavaScript/TypeScript

```typescript
import { keeperService } from '@/lib/keeper/service';

// Fetch all keepers
async function loadKeepers() {
  try {
    const response = await keeperService.fetchKeepers({
      page: 1,
      limit: 50,
      status: ['active'],
      sortBy: 'healthScore',
      sortOrder: 'desc',
    });
    
    console.log('Keepers:', response.data);
    console.log('Pagination:', response.pagination);
  } catch (error) {
    console.error('Failed to fetch keepers:', error);
  }
}

// Fetch specific keeper
async function getKeeperDetails(keeperId: string) {
  try {
    const response = await keeperService.fetchKeeperDetail(keeperId);
    return response.data;
  } catch (error) {
    console.error('Failed to fetch keeper:', error);
  }
}

// Update keeper configuration
async function updateKeeper(keeperId: string) {
  try {
    const result = await keeperService.updateKeeperConfig(keeperId, {
      configuration: {
        maxConcurrentTasks: 15,
      },
    });
    
    console.log('Update successful:', result);
  } catch (error) {
    console.error('Failed to update keeper:', error);
  }
}

// Pause keeper
async function pauseKeeper(keeperId: string) {
  try {
    const result = await keeperService.pauseKeeper(keeperId);
    console.log('Keeper paused:', result);
  } catch (error) {
    console.error('Failed to pause keeper:', error);
  }
}
```

### React Component Integration

```typescript
import { useKeeperStore } from '@/app/Zustand/keeperStore';
import { KeeperPanel } from '@/components/keeper';

export function KeeperManagement() {
  const { keepers, isLoading, error } = useKeeperStore();

  return (
    <div>
      {error && <ErrorAlert error={error} />}
      <KeeperPanel />
    </div>
  );
}
```

## Error Handling

### Error Response Format

```json
{
  "success": false,
  "message": "Failed to update keeper configuration",
  "error": {
    "type": "VALIDATION_ERROR",
    "code": "INVALID_CONFIG",
    "details": {
      "field": "maxConcurrentTasks",
      "message": "Must be between 1 and 100"
    }
  }
}
```

### Common Error Codes

| Status | Code | Message |
|--------|------|---------|
| 400 | INVALID_CONFIG | Invalid configuration provided |
| 400 | MISSING_FIELD | Required field missing |
| 401 | UNAUTHORIZED | Authentication required |
| 403 | FORBIDDEN | Insufficient permissions |
| 404 | NOT_FOUND | Keeper not found |
| 429 | RATE_LIMITED | Too many requests |
| 500 | INTERNAL_ERROR | Server error |
| 503 | SERVICE_UNAVAILABLE | Service temporarily unavailable |

### Frontend Error Handling

```typescript
import { createKeeperError, logKeeperError } from '@/lib/keeper/errors';

try {
  await keeperService.updateKeeperConfig(keeperId, config);
} catch (error) {
  if (error instanceof KeeperError) {
    logKeeperError(error);
    
    if (error.retriable) {
      // Retry with exponential backoff
      await retryOperation();
    } else {
      // Show user-friendly error message
      showErrorNotification(getErrorMessage(error));
    }
  }
}
```

## WebSocket Integration

### Connection Setup

```typescript
import { KeeperWebSocketManager } from '@/lib/keeper/service';

const wsManager = new KeeperWebSocketManager();

// Connect to WebSocket
await wsManager.connect();

// Subscribe to keeper updates
const unsubscribe = wsManager.onMessage((message) => {
  if (message.type === 'keeper-status') {
    updateKeeperStatus(message.keeperId, message.data);
  }
});

// Disconnect when done
wsManager.disconnect();
```

### Message Format

```typescript
interface KeeperUpdateMessage {
  type: 'keeper-status' | 'keeper-metrics' | 'keeper-execution' | 'keeper-error';
  keeperId: string;
  data: Partial<Keeper> | Partial<KeeperMetrics> | Execution | KeeperError;
  timestamp: string; // ISO 8601
}
```

### Example Messages

**Keeper Status Update**:
```json
{
  "type": "keeper-status",
  "keeperId": "keeper-1",
  "data": {
    "status": "active",
    "lastHeartbeat": "2026-06-01T10:35:00Z"
  },
  "timestamp": "2026-06-01T10:35:00Z"
}
```

**Metrics Update**:
```json
{
  "type": "keeper-metrics",
  "keeperId": "keeper-1",
  "data": {
    "uptime": 99.9,
    "responseTime": 145,
    "errorRate": 0.4
  },
  "timestamp": "2026-06-01T10:35:00Z"
}
```

## Testing Guide

### Unit Tests

```bash
npm run test -- keeper
```

### Integration Tests

```bash
npm run test:integration -- keeper
```

### E2E Tests

```bash
npm run test:e2e -- keeper-panel.spec.ts
```

### Manual Testing Checklist

- [ ] Load keeper list
- [ ] Filter by status
- [ ] Sort by different columns
- [ ] Scroll through large lists (>1000 keepers)
- [ ] Open keeper detail modal
- [ ] Update keeper configuration
- [ ] Pause/resume keeper
- [ ] Test error scenarios
- [ ] Verify WebSocket updates
- [ ] Test on mobile devices

## Rate Limiting

### Frontend Rate Limiting

The service automatically implements rate limiting:
- Max 3 retries per request
- Exponential backoff: 1s, 2s, 4s, 8s...
- Jitter to prevent thundering herd

### Backend Rate Limiting (Recommended)

Implement rate limiting at API gateway:
- 100 requests per minute per user
- 1000 requests per minute per IP
- Burst limit: 20 requests per 10 seconds

## Performance Tuning

### Pagination

Recommended page sizes:
- Desktop: 50-100 keepers per page
- Mobile: 20-30 keepers per page

### Caching Strategy

- List: Cache for 5 minutes
- Details: Cache for 1 minute
- Stats: Cache for 2 minutes
- Metrics: No cache (real-time)

### Virtual Scrolling

- Enabled for lists > 50 items
- Overscan: 10 items
- Estimated item size: Desktop 50px, Mobile 220px

---

**API Version**: 1.0  
**Last Updated**: 2026-06-01  
**Status**: Production Ready
