# Distributed Keeper Consensus Engine - Implementation Guide

## Quick Start

This guide shows how to integrate the consensus engine into the existing keeper.

## Step 1: Install Consensus Engine

The consensus engine is included in the keeper codebase. No additional dependencies required.

```bash
cd keeper
npm install  # If not already installed
```

## Step 2: Configure Environment

Add to `.env`:

```bash
# Consensus Configuration
CONSENSUS_ENABLED=true
CONSENSUS_HMAC_SECRET=your-32-byte-hex-secret-key-here
KEEPER_TOTAL_COUNT=3
CONSENSUS_DATA_DIR=./data/consensus
CONSENSUS_VOTE_TIMEOUT_MS=10000
```

Generate a secure HMAC secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Important:** Share the same secret across all keepers in the network.

## Step 3: Initialize Consensus Engine in Keeper

In `index.js`, after initializing the RPC server:

```javascript
const {
  ConsensusEngine,
  ConsensusExecutor,
  ConsensusNetworkAdapter,
} = require('./src/consensus');

// ... existing code ...

// Initialize consensus engine
const consensusEngine = new ConsensusEngine({
  keeperId: keeperData.publicKey.substring(0, 8), // or use env var
  totalKeepers: parseInt(process.env.KEEPER_TOTAL_COUNT || '3'),
  hmacSecret: process.env.CONSENSUS_HMAC_SECRET,
  enabled: process.env.CONSENSUS_ENABLED !== 'false',
  networkBroadcaster: null, // Will be set via adapter
  dataDir: process.env.CONSENSUS_DATA_DIR || './data/consensus',
  logger: createLogger('consensus-engine'),
});

logger.info('Consensus engine initialized', {
  keeperId: consensusEngine.keeperId,
  totalKeepers: consensusEngine.totalKeepers,
});

// Setup network adapter to route consensus messages
const networkAdapter = new ConsensusNetworkAdapter({
  p2pNetwork: p2pNetworkInstance, // Your existing P2P network
  consensusEngine: consensusEngine,
  keeperId: consensusEngine.keeperId,
  logger: createLogger('consensus-network'),
});

// Connect network broadcaster
consensusEngine.networkBroadcaster = networkAdapter;
```

## Step 4: Integrate with Executor Queue

Wrap task execution with consensus:

```javascript
const ConsensusExecutor = require('./src/consensus').ConsensusExecutor;

// After initializing ExecutionQueue
const consensusExecutor = new ConsensusExecutor({
  consensusEngine: consensusEngine,
  executorDeps: {
    server: server,
    keypair: keypair,
    account: keeperAccount,
    contractId: config.contractId,
    networkPassphrase: config.networkPassphrase,
  },
  lockManager: lockManager, // Your existing lock manager
  enabled: process.env.CONSENSUS_ENABLED !== 'false',
  logger: createLogger('consensus-executor'),
});

// Modify ExecutionQueue.execute() to use consensusExecutor
// Old: await executeTaskWithRetry(taskId, deps, options)
// New: await consensusExecutor.execute(taskId, options)

// Example wrapper:
async function executeTaskWithConsensus(taskId, options = {}) {
  return await consensusExecutor.execute(taskId, {
    correlationId: options.correlationId || crypto.randomUUID(),
    maxRetries: 3,
    ...options,
  });
}
```

## Step 5: Setup Periodic Maintenance

In your main keeper loop or scheduler:

```javascript
// Run consensus maintenance every 5 minutes
setInterval(async () => {
  try {
    await consensusEngine.maintain();
    logger.debug('Consensus maintenance completed');
  } catch (err) {
    logger.error('Consensus maintenance failed', { error: err.message });
  }
}, 300000); // 5 minutes
```

## Step 6: Integration with Polling Loop

In your task poller, propose tasks before execution:

```javascript
// In TaskPoller or Poller
const dueTasks = []; // Your existing due task detection

for (const taskId of dueTasks) {
  try {
    // Propose for consensus
    const proposal = await consensusEngine.proposeTask(taskId);
    
    if (proposal.approved) {
      if (proposal.executorId === consensusEngine.keeperId) {
        // I'm assigned - queue for execution
        executionQueue.enqueue(taskId, {
          consensusEpoch: proposal.epoch,
          consensusApproved: true,
        });
        
        logger.info('Task approved and assigned', {
          taskId,
          epoch: proposal.epoch,
        });
      } else {
        // Another keeper is assigned
        logger.info('Task approved but assigned to another keeper', {
          taskId,
          assignedTo: proposal.executorId,
        });
      }
    } else {
      // Task rejected by consensus
      logger.debug('Task rejected by consensus', { taskId });
      // Skip execution
    }
  } catch (err) {
    logger.error('Consensus proposal failed', {
      taskId,
      error: err.message,
    });
    // Fall back to lock-based execution if enabled
  }
}
```

## Step 7: Graceful Shutdown

Update shutdown handlers:

```javascript
// In graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down');
  
  // Shutdown in order
  await executionQueue.shutdown();
  networkAdapter.shutdown();
  consensusEngine.shutdown();
  await server.close();
  
  process.exit(0);
});
```

## Step 8: Monitoring & Metrics

Expose consensus metrics in your metrics endpoint:

```javascript
// In MetricsServer or health endpoint
const getConsensusMetrics = () => {
  const stats = consensusEngine.getStats();
  return {
    consensus: {
      enabled: stats.enabled,
      keeper_id: stats.keeperId,
      quorum: stats.voter.quorumSize,
      active_sessions: stats.voter.activeSessions,
      active_proposals: stats.proposer.activeProposals,
      total_executed: stats.ledger.executedCount,
      total_failed: stats.ledger.failedCount,
    },
  };
};
```

## Testing the Integration

### 1. Single Keeper Test

Start a single keeper:

```bash
CONSENSUS_ENABLED=true npm start
```

Check logs:

```bash
tail -f logs/keeper.log | grep consensus
```

You should see:
- Consensus engine initialized
- Proposals and decisions logged

### 2. Multi-Keeper Test (Local)

Start 3 keepers in separate terminals:

```bash
# Terminal 1
KEEPER_ID=keeper-1 CONSENSUS_ENABLED=true npm start

# Terminal 2
KEEPER_ID=keeper-2 CONSENSUS_ENABLED=true npm start

# Terminal 3
KEEPER_ID=keeper-3 CONSENSUS_ENABLED=true npm start
```

All keepers should:
1. Connect via P2P network
2. Propose tasks to each other
3. Vote on proposals
4. Assign executor
5. Execute task

### 3. Verify Consensus

Create a task and check:

```bash
# Check consensus metrics
curl http://localhost:3001/metrics | grep consensus
```

Expected output:

```json
{
  "consensus": {
    "enabled": true,
    "keeper_id": "keeper-1",
    "quorum": 2,
    "active_sessions": 0,
    "active_proposals": 0,
    "total_executed": 15,
    "total_failed": 0
  }
}
```

### 4. Test Network Partition

Stop one keeper:

```bash
# Ctrl+C in one terminal
```

Other keepers should:
- Fail proposals (can't reach quorum)
- Fall back to lock-based execution (if enabled)
- Log warnings about connection loss

## Troubleshooting Integration

### Issue: Consensus messages not being delivered

**Solution:**
- Verify P2P network is connected: `curl http://localhost:3001/metrics | grep peers`
- Check HMAC secret is identical across all keepers
- Verify network ports are open between keepers

### Issue: Tasks executing twice

**Solution:**
- Ensure CONSENSUS_ENABLED=true on all keepers
- Verify consensus is working: check proposal logs
- Check lock manager is still active as fallback

### Issue: Consensus timeouts

**Solution:**
- Increase CONSENSUS_VOTE_TIMEOUT_MS if network is slow
- Verify all keepers are running and healthy
- Check for clock skew: `ntpdate -q 0.pool.ntp.org`

### Issue: Ledger growing too large

**Solution:**
- Ensure `consensusEngine.maintain()` is called periodically
- Check logs for maintenance messages
- Manually trigger cleanup: `consensusEngine.maintain()`

## Performance Tuning

### For Small Networks (1-3 keepers)

```bash
CONSENSUS_VOTE_TIMEOUT_MS=5000      # Shorter timeouts
CONSENSUS_DATA_DIR=./data/consensus # Local fast disk
```

### For Large Networks (5+ keepers)

```bash
CONSENSUS_VOTE_TIMEOUT_MS=15000     # Longer for more votes
CONSENSUS_DATA_DIR=/mnt/nvme/data   # Use fast storage
```

### For High Throughput

```bash
MAX_CONCURRENT_EXECUTIONS=10         # Increase from default 3
CONSENSUS_ENABLED=true               # Consensus prevents duplicates
```

## Security Checklist

- [ ] CONSENSUS_HMAC_SECRET is strong (32 bytes)
- [ ] Same secret on all keepers
- [ ] Secret rotated every 90 days
- [ ] Secret never logged
- [ ] P2P network secured (TLS if over internet)
- [ ] Firewall rules restrict P2P ports to keeper IPs
- [ ] Consensus ledger directory has appropriate permissions
- [ ] Regular backups of `data/consensus/`

## Migration from Lock-Only

If migrating from lock-based coordination:

### Step 1: Deploy with Consensus Disabled

```bash
CONSENSUS_ENABLED=false  # Run both consensus and locks
```

Both systems run in parallel, consensus logs decisions only.

### Step 2: Monitor for Consistency

Watch consensus logs for 24-48 hours:

```bash
grep "consensus" logs/keeper.log | grep "APPROVED\|EXECUTED"
```

Verify:
- Tasks being approved correctly
- Right executors assigned
- Results being reported

### Step 3: Enable Consensus

```bash
CONSENSUS_ENABLED=true  # Now consensus drives execution
```

Locks still available as fallback for edge cases.

### Step 4: Decommission Locks (Optional)

After running for 1 week with consensus enabled:

```bash
# Remove lock acquisition from executor
# Locks still serve as safety net but not primary mechanism
```

## Monitoring Checklist

Create monitoring for:

1. **Active Sessions**
   ```
   consensus.active_sessions < 100
   ```

2. **Executed Tasks**
   ```
   consensus.total_executed increasing
   consensus.total_failed < 1% of executed
   ```

3. **P2P Connectivity**
   ```
   p2p.connected = true
   p2p.peers >= N/2
   ```

4. **Ledger Health**
   ```
   ledger.total_entries < 1000000
   ledger.snapshot_age < 3600 (seconds)
   ```

## Next Steps

1. Deploy consensus engine to test network
2. Run load tests with multiple tasks
3. Test network partition scenarios
4. Monitor consensus metrics for 1 week
5. Roll out to production keepers one-by-one
6. Document operational procedures

## Support

For integration help:
- Review example in `src/consensus/__tests__/engine.test.js`
- Check test fixtures for setup patterns
- Reference API documentation in `src/consensus/API.md`
