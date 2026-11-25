# Background Sync API - Implementation Summary

## Overview

The Background Sync API provides a resilient offline execution mechanism for the SoroTask frontend. It handles network partitions and RPC failures gracefully by queueing operations and automatically retrying when connectivity is restored.

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                        Background Sync System                       │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐     ┌──────────────┐     ┌──────────────────┐   │
│  │   React     │────▶│   Sync       │────▶│   Execution      │   │
│  │ Components  │     │   Manager    │     │   Queue          │   │
│  └─────────────┘     └──────────────┘     └──────────────────┘   │
│                            │                      │                │
│                            │                      ▼                │
│                            │              ┌──────────────────┐   │
│                            │              │   Handlers       │   │
│                            │              │   (API calls)    │   │
│                            │              └──────────────────┘   │
│                            │                                      │
│                            ▼                                      │
│                   ┌──────────────────┐                           │
│                   │   Network        │                           │
│                   │   Monitor        │                           │
│                   └──────────────────┘                           │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Core Types (`src/lib/sync/types.ts`)

Defines the type system for the sync mechanism:
- `SyncOperationType` - Enumeration of all operation types (execute, cancel, register, etc.)
- `QueuedSyncAction` - Full action model with status, attempts, and priority
- `NetworkHealth` - Connection quality and failure tracking
- `SyncManagerState` - Complete state snapshot for React consumers

### 2. Execution Queue (`src/lib/sync/executionQueue.ts`)

Wraps the existing `ActionQueue` with task-specific handlers:
- Priority-based ordering (execute > cancel > register > ...)
- Per-operation-type handler registration
- Automatic deduplication of identical payloads
- Exponential backoff with configurable limits

### 3. Network Monitor (`src/lib/sync/networkMonitor.ts`)

Monitors connectivity with lightweight RPC probes:
- `HEAD` request to configured RPC endpoint
- Quality assessment (excellent/good/poor/offline)
- Browser event listener integration (`online`/`offline`)
- Configurable probe interval and timeout

### 4. Sync Manager (`src/lib/sync/syncManager.ts`)

Orchestrates queue and network state:
- Singleton pattern for global access
- Automatic flush on connectivity restore
- State subscription for React integration
- Sentry error tracking integration

### 5. React Integration (`src/components/SyncProvider.tsx`, `src/hooks/useBackgroundSync.ts`)

- `SyncProvider` - Context provider that initializes the manager
- `useBackgroundSync` - Primary hook with derived state (`isOnline`, `isSyncing`, etc.)

## Usage

### Basic Setup

```tsx
import { SyncProvider } from '@/src/components/SyncProvider';
import { createExecutionQueue, type ExecutionQueueHandler } from '@/src/lib/sync/executionQueue';

const handlers: ExecutionQueueHandler = {
  execute: async ({ taskId, functionName, contractAddress, gasEstimate }) => {
    // Call your actual API
    await api.executeTask(taskId, { functionName, contractAddress, gasEstimate });
  },
  register: async ({ contract, fn, intervalSec, gas }) => {
    await api.registerTask({ contract, fn, intervalSec, gas });
  },
  // ... other handlers
};

export default function RootLayout({ children }) {
  return (
    <SyncProvider
      handlers={handlers}
      rpcEndpoint={process.env.NEXT_PUBLIC_API_URL}
    >
      {children}
    </SyncProvider>
  );
}
```

### Using the Hook

```tsx
import { useBackgroundSync } from '@/src/hooks/useBackgroundSync';

function TaskPanel() {
  const {
    isOnline,
    isSyncing,
    pendingCount,
    enqueue,
    retry,
    cancel,
    getActions,
  } = useBackgroundSync();

  const handleExecute = async (taskId: string) => {
    enqueue('task.execute', {
      taskId,
      functionName: 'harvest_yield',
      contractAddress: 'CABCDEF1234',
      gasEstimate: 500,
    });
  };

  return (
    <div>
      {!isOnline && <OfflineBanner />}
      {isSyncing && <SyncIndicator />}
      <button onClick={() => handleExecute('task-1')}>Execute</button>
    </div>
  );
}
```

## Configuration

### Sync Manager Config

| Option | Default | Description |
|--------|---------|-------------|
| `storageKey` | `sorotask-sync-queue` | localStorage key for persistence |
| `maxAttempts` | `5` | Maximum retry attempts |
| `baseDelayMs` | `1000` | Initial retry delay |
| `maxDelayMs` | `30000` | Maximum retry delay |

### Network Monitor Config

| Option | Default | Description |
|--------|---------|-------------|
| `rpcEndpoint` | `NEXT_PUBLIC_API_URL` | RPC health check target |
| `healthCheckIntervalMs` | `30000` | Probe interval |
| `timeoutMs` | `5000` | Request timeout |
| `requiredConsecutiveSuccesses` | `2` | Successes before marking online |

## Error Handling

- Failed actions transition through `pending` → `in_flight` → `failed`
- Exponential backoff: `min(base * 2^attempt, maxDelay)`
- Actions exceeding `maxAttempts` enter terminal `failed` state
- All failures logged to Sentry with queue context

## Testing

Tests cover:
- Network quality assessment
- Connection state transitions
- Queue enqueue/dequeue behavior
- Retry with backoff
- Offline/online transitions
- Persistence boundaries

Run tests:
```bash
cd frontend && npx jest src/lib/sync/__tests__
```

## Integration Points

- **Existing ActionQueue**: Reuses proven queue implementation
- **Sentry**: Error tracking via `@sentry/nextjs`
- **Zustand**: Compatible with existing store patterns
- **React 19**: Uses `useSyncExternalStore` for optimal re-renders
