# Mock API & Mock RPC Server

This module contains utilities for hermetic testing in SoroTask. Specifically, it provides a resilient `MockRpcServer` that simulates different network states, connection failures, and latency spikes to ensure robust frontend handling.

## Components

### `MockRpcServer` (`rpc-server.ts`)
A fully synchronous mock registry that returns promises simulating asynchronous operations.

#### Features
- **Network Partitions:** Simulate hard drops of connectivity using the `'PARTITIONED'` state.
- **Latency Spikes:** Inject latency directly, or use `'DEGRADED'` state for randomized latency spikes.
- **Random Packet Drops:** Set a `failureRate` between 0.0 and 1.0 to randomly reject requests.

#### Usage Example

```typescript
import { mockRpcServer } from '@/lib/mockApi/rpc-server';

// Register handlers
mockRpcServer.registerHandler('getAccount', (args) => {
  return { id: args.id, balance: 100 };
});

// Configure network state
mockRpcServer.updateOptions({
  state: 'DEGRADED',
  failureRate: 0.1, // 10% chance to fail
  latencyMs: 300,
});

// Call
try {
  const account = await mockRpcServer.call('getAccount', { id: 'A123' });
} catch (err) {
  // Graceful fallback tests here
}

// Reset between tests
mockRpcServer.reset();
```

### `tasks.ts`
A higher-level mock of the Tasks endpoint utilizing its own internal basic error throwing mechanism, which can be migrated to `MockRpcServer` when a unified schema is adopted.
