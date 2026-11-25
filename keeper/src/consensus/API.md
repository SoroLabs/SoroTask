# Consensus Engine API Reference

## Table of Contents

1. [ConsensusEngine](#consensusengine)
2. [Voter](#voter)
3. [Proposer](#proposer)
4. [ConsensusLedger](#consensusledger)
5. [ConsensusMessages](#consensusmessages)
6. [ConsensusExecutor](#consensusexecutor)
7. [ConsensusNetworkAdapter](#consensusnetworkadapter)

---

## ConsensusEngine

Main orchestrator for the consensus protocol.

### Constructor

```javascript
const ConsensusEngine = require('./src/consensus/engine');

const engine = new ConsensusEngine({
  keeperId: string,           // Required: unique keeper identifier
  totalKeepers: number,       // Required: total keepers in network
  networkBroadcaster: object, // Required: network broadcaster
  hmacSecret: string,         // Optional: HMAC signing secret
  enabled: boolean,           // Optional: enable/disable consensus (default: true)
  dataDir: string,           // Optional: ledger data directory
  logger: object,            // Optional: logger instance
});
```

### Methods

#### proposeTask(taskId)
Proposes a task for consensus and waits for quorum approval.

```javascript
const result = await engine.proposeTask('task-123');

// Returns:
{
  approved: boolean,      // Quorum approved task execution
  executorId: string,     // Assigned keeper to execute
  epoch: number,          // Proposal epoch
  consensus: boolean,     // Whether consensus was used
  error?: string         // Error message if failed
}
```

**Example:**

```javascript
try {
  const proposal = await engine.proposeTask('task-xyz');
  
  if (proposal.approved) {
    if (proposal.executorId === myKeeperId) {
      // I'm assigned - execute the task
      console.log(`Executing task ${proposal.taskId}`);
    } else {
      // Another keeper is assigned
      console.log(`Task assigned to ${proposal.executorId}`);
    }
  } else {
    console.log('Task rejected by consensus');
  }
} catch (err) {
  console.error('Proposal failed:', err);
}
```

#### reportExecution(taskId, epoch, success)
Reports execution result to the consensus network.

```javascript
await engine.reportExecution(taskId, epoch, success);
```

**Parameters:**
- `taskId` (string): Task that was executed
- `epoch` (number): Proposal epoch
- `success` (boolean): Execution succeeded or failed

**Example:**

```javascript
try {
  const result = await executeTask(taskId);
  
  await engine.reportExecution(taskId, epoch, result.success);
  console.log(`Task ${taskId} reported: ${result.success ? 'success' : 'failed'}`);
} catch (err) {
  await engine.reportExecution(taskId, epoch, false);
}
```

#### handleMessage(message)
Processes incoming consensus message from peers.

```javascript
const result = await engine.handleMessage(message);

// Returns:
{
  handled: boolean,      // Message was processed
  result?: any,         // Handler-specific result
  error?: string       // Error message if failed
}
```

**Example:**

```javascript
// In P2P message handler
p2pNetwork.on('message', async (envelope) => {
  if (envelope.type === 'consensus') {
    const result = await engine.handleMessage(envelope.payload);
    if (result.handled) {
      logger.debug('Consensus message processed');
    } else {
      logger.warn('Failed to handle message:', result.error);
    }
  }
});
```

#### getStats()
Returns consensus statistics.

```javascript
const stats = engine.getStats();

// Returns:
{
  keeperId: string,
  enabled: boolean,
  voter: {
    totalKeepers: number,
    quorumSize: number,
    activeSessions: number,
    minApprovalsNeeded: number
  },
  proposer: {
    totalProposals: number,
    activeProposals: number,
    executedProposals: number,
    failedProposals: number
  },
  ledger: {
    totalEntries: number,
    approvedCount: number,
    rejectedCount: number,
    executedCount: number,
    failedCount: number
  }
}
```

#### maintain()
Runs periodic maintenance (cleanup, pruning, snapshots).

```javascript
await engine.maintain();
```

**Should be called every 5-10 minutes.**

#### shutdown()
Gracefully shuts down the consensus engine.

```javascript
engine.shutdown();
```

---

## Voter

Manages voting sessions and quorum validation.

### Constructor

```javascript
const Voter = require('./src/consensus/voter');

const voter = new Voter({
  keeperId: string,           // Keeper ID
  totalKeepers: number,       // Total keepers in network
  sessionTimeoutMs: number,   // Session timeout (default: 30000)
  logger: object,            // Logger instance
});
```

### Methods

#### startVotingSession(taskId, epoch, proposerId)
Creates a new voting session.

```javascript
const session = voter.startVotingSession('task-1', 1, 'keeper-1');

// Returns:
{
  taskId: string,
  epoch: number,
  proposerId: string,
  startedAt: number,
  votes: Map,          // voterId -> boolean
  status: string,      // PENDING, APPROVED, REJECTED, TIMEOUT
  approvalCount: number,
  rejectionCount: number,
  participantCount: number
}
```

#### recordVote(taskId, epoch, voterId, approve)
Records a vote in a session.

```javascript
voter.recordVote('task-1', 1, 'keeper-2', true);  // Vote YES
voter.recordVote('task-1', 1, 'keeper-3', false); // Vote NO
```

**Note:** Duplicate votes from same keeper are ignored.

#### hasApprovalQuorum(taskId, epoch)
Checks if quorum has approved the task.

```javascript
if (voter.hasApprovalQuorum('task-1', 1)) {
  console.log('Quorum reached!');
}
```

#### hasRejectionQuorum(taskId, epoch)
Checks if quorum has rejected the task.

```javascript
if (voter.hasRejectionQuorum('task-1', 1)) {
  console.log('Rejection confirmed');
}
```

#### getSession(taskId, epoch)
Retrieves a voting session.

```javascript
const session = voter.getSession('task-1', 1);
if (!session) {
  console.log('Session not found');
}
```

#### getQuorumInfo()
Returns quorum configuration.

```javascript
const info = voter.getQuorumInfo();
// {
//   totalKeepers: 3,
//   quorumSize: 2,
//   activeSessions: 5
// }
```

#### shutdown()
Cleans up and shuts down voter.

```javascript
voter.shutdown();
```

---

## Proposer

Handles task proposals and executor assignment.

### Constructor

```javascript
const Proposer = require('./src/consensus/proposer');

const proposer = new Proposer({
  keeperId: string,      // Keeper ID
  totalKeepers: number,  // Total keepers
  logger: object,       // Logger instance
});
```

### Methods

#### createProposal(taskId)
Creates a new proposal with incrementing epoch.

```javascript
const proposal = proposer.createProposal('task-1');

// Returns:
{
  taskId: string,
  epoch: number,         // Auto-incremented
  proposerId: string,
  createdAt: number,
  status: string,        // PROPOSED
  executorId: null,
  votes: [],
  metadata: {}
}
```

#### assignExecutor(taskId, epoch, candidateKeepers)
Assigns executor deterministically.

```javascript
const executorId = proposer.assignExecutor(
  'task-1',
  1,
  ['keeper-1', 'keeper-2', 'keeper-3']
);

console.log(`Executor assigned: ${executorId}`);
```

**Note:** Same task always gets same executor (deterministic).

#### markExecuted(taskId, epoch, success)
Marks proposal as executed.

```javascript
proposer.markExecuted('task-1', 1, true);   // Success
proposer.markExecuted('task-1', 1, false);  // Failure
```

#### getProposal(taskId, epoch)
Retrieves a specific proposal.

```javascript
const proposal = proposer.getProposal('task-1', 1);
if (proposal && proposal.status === 'EXECUTED') {
  console.log('Task was executed');
}
```

#### getLatestProposal(taskId)
Gets the most recent proposal for a task.

```javascript
const latest = proposer.getLatestProposal('task-1');
console.log(`Latest epoch: ${latest.epoch}`);
```

#### getActiveProposals()
Returns all pending proposals.

```javascript
const active = proposer.getActiveProposals();
active.forEach(p => {
  console.log(`${p.taskId}: ${p.status}`);
});
```

#### cleanup(maxAge)
Removes old completed proposals.

```javascript
proposer.cleanup(300000); // Remove proposals older than 5 minutes
```

---

## ConsensusLedger

Persistent record of consensus decisions.

### Constructor

```javascript
const ConsensusLedger = require('./src/consensus/ledger');

const ledger = new ConsensusLedger({
  dataDir: string,  // Data directory for WAL and snapshots
  logger: object,  // Logger instance
});
```

### Methods

#### recordDecision(taskId, epoch, decision, metadata)
Records a consensus decision.

```javascript
ledger.recordDecision('task-1', 1, 'APPROVED', {
  approvers: 2,
  timestamp: Date.now()
});
```

**Decision types:** APPROVED, REJECTED, EXECUTED, FAILED

#### getDecision(taskId, epoch)
Retrieves a decision.

```javascript
const decision = ledger.getDecision('task-1', 1);
if (decision && decision.decision === 'EXECUTED') {
  console.log('Task was executed');
}
```

#### hasDecision(taskId, epoch)
Checks if decision exists.

```javascript
if (ledger.hasDecision('task-1', 1)) {
  console.log('Decision recorded');
}
```

#### getTaskDecisions(taskId)
Gets all decisions for a task.

```javascript
const decisions = ledger.getTaskDecisions('task-1');
decisions.forEach(d => {
  console.log(`Epoch ${d.epoch}: ${d.decision}`);
});
```

#### getLatestDecision(taskId)
Gets most recent decision for task.

```javascript
const latest = ledger.getLatestDecision('task-1');
if (latest && latest.decision === 'APPROVED') {
  // Task was approved
}
```

#### getFinalizedDecisions()
Returns all executed or failed decisions.

```javascript
const finalized = ledger.getFinalizedDecisions();
console.log(`Tasks executed: ${finalized.length}`);
```

#### snapshot()
Saves ledger to disk.

```javascript
ledger.snapshot();
```

**Automatically called during maintenance.**

#### prune(maxAge)
Removes old entries.

```javascript
ledger.prune(86400000); // Remove entries >24 hours old
```

---

## ConsensusMessages

Message creation and verification utilities.

### Functions

#### createProposalMessage(taskId, epoch, keeperId, secret)
Creates a signed proposal message.

```javascript
const msg = require('./src/consensus/messages')
  .createProposalMessage('task-1', 1, 'keeper-1', hmacSecret);
```

#### createVoteMessage(taskId, epoch, approve, voterId, proposerId, secret)
Creates a signed vote message.

```javascript
const msg = require('./src/consensus/messages')
  .createVoteMessage('task-1', 1, true, 'keeper-2', 'keeper-1', hmacSecret);
```

#### createCommitMessage(taskId, epoch, executorId, proposerId, secret)
Creates a signed commit message.

```javascript
const msg = require('./src/consensus/messages')
  .createCommitMessage('task-1', 1, 'keeper-2', 'keeper-1', hmacSecret);
```

#### createResultMessage(taskId, executorId, success, metadata, secret)
Creates a signed result message.

```javascript
const msg = require('./src/consensus/messages')
  .createResultMessage('task-1', 'keeper-2', true, { txHash: 'abc' }, hmacSecret);
```

#### verifySignature(message, secret)
Verifies message signature.

```javascript
const { verifySignature } = require('./src/consensus/messages');

if (verifySignature(message, hmacSecret)) {
  console.log('Message is authentic');
} else {
  console.log('Message failed verification');
}
```

---

## ConsensusExecutor

Wrapper integrating consensus with task execution.

### Constructor

```javascript
const ConsensusExecutor = require('./src/consensus/executor-wrapper');

const executor = new ConsensusExecutor({
  consensusEngine: engine,         // ConsensusEngine instance
  executorDeps: {                 // Executor dependencies
    server: rpcServer,
    keypair: keeperKeypair,
    account: keeperAccount,
    contractId: contractId,
    networkPassphrase: Networks.FUTURENET
  },
  lockManager: lockManager,       // Optional: fallback locking
  enabled: true,                 // Optional: enable consensus
  logger: logger,               // Optional: logger
});
```

### Methods

#### execute(taskId, options)
Executes task with consensus coordination.

```javascript
const result = await executor.execute('task-123', {
  correlationId: 'abc-123',
  maxRetries: 3,
  baseDelayMs: 1000,
});

// Returns:
{
  taskId: string,
  success: boolean,              // Execution succeeded
  consensusApproved: boolean,    // Consensus approved
  assignedAsExecutor: boolean,   // This keeper assigned
  executed: boolean,             // Task was executed
  txHash: string|null,          // Transaction hash
  error: string|null,           // Error message
  duration: number,             // Execution time (ms)
  consensusEpoch: number|null,  // Proposal epoch
}
```

**Example:**

```javascript
const result = await executor.execute('task-xyz', {
  correlationId: generateCorrelationId(),
  maxRetries: 3,
});

if (result.success) {
  console.log(`Task executed: ${result.txHash}`);
} else if (result.consensusApproved) {
  if (result.assignedAsExecutor) {
    console.log(`Execution failed: ${result.error}`);
  } else {
    console.log(`Another keeper assigned for execution`);
  }
} else {
  console.log(`Task rejected by consensus`);
}
```

#### getStats()
Returns executor statistics.

```javascript
const stats = executor.getStats();
// {
//   consensusEnabled: boolean,
//   consensusEngineStats: {...}
// }
```

---

## ConsensusNetworkAdapter

Integrates consensus messaging with P2P network.

### Constructor

```javascript
const ConsensusNetworkAdapter = require('./src/consensus/network-adapter');

const adapter = new ConsensusNetworkAdapter({
  p2pNetwork: network,         // P2P network instance
  consensusEngine: engine,     // ConsensusEngine instance
  keeperId: 'keeper-1',       // Keeper identifier
  logger: logger,             // Logger instance
});
```

### Methods

#### broadcast(message)
Broadcasts message to all peers.

```javascript
await adapter.broadcast(consensusMessage);
```

#### sendToPeer(peerId, message)
Sends message to specific peer.

```javascript
await adapter.sendToPeer('keeper-2', consensusMessage);
```

#### getNetworkStatus()
Returns network connectivity status.

```javascript
const status = adapter.getNetworkStatus();
// {
//   connected: boolean,
//   peers: string[],
//   sentMessages: number
// }
```

#### cleanup()
Removes expired message tracking.

```javascript
adapter.cleanup();
```

---

## Complete Integration Example

```javascript
const ConsensusEngine = require('./src/consensus/engine');
const ConsensusExecutor = require('./src/consensus/executor-wrapper');
const ConsensusNetworkAdapter = require('./src/consensus/network-adapter');

// Initialize consensus engine
const consensusEngine = new ConsensusEngine({
  keeperId: process.env.KEEPER_ID || 'keeper-1',
  totalKeepers: parseInt(process.env.KEEPER_TOTAL_COUNT || '3'),
  hmacSecret: process.env.CONSENSUS_HMAC_SECRET,
  enabled: process.env.CONSENSUS_ENABLED !== 'false',
  networkBroadcaster: null, // Will be set via adapter
});

// Setup network adapter
const networkAdapter = new ConsensusNetworkAdapter({
  p2pNetwork: p2pNetworkInstance,
  consensusEngine: consensusEngine,
  keeperId: consensusEngine.keeperId,
});

// Set network broadcaster for consensus engine
consensusEngine.networkBroadcaster = networkAdapter;

// Wrap executor with consensus
const consensusExecutor = new ConsensusExecutor({
  consensusEngine,
  executorDeps: { server, keypair, account, contractId, networkPassphrase },
  lockManager: redisLockManager,
  enabled: true,
});

// In task execution loop
async function executeTask(taskId) {
  const result = await consensusExecutor.execute(taskId, {
    correlationId: generateId(),
    maxRetries: 3,
  });

  if (result.success) {
    console.log(`Task succeeded: ${result.txHash}`);
  } else {
    console.log(`Task failed: ${result.error}`);
  }

  return result;
}

// Periodic maintenance
setInterval(() => {
  consensusEngine.maintain();
}, 300000); // Every 5 minutes

// Graceful shutdown
process.on('SIGTERM', () => {
  consensusEngine.shutdown();
  consensusExecutor.shutdown();
  networkAdapter.shutdown();
  process.exit(0);
});
```

---

## Error Handling

### Common Errors

```javascript
// Proposal timeout (quorum not reached)
try {
  const proposal = await engine.proposeTask('task-1');
  if (!proposal.approved) {
    console.log('Task not approved by quorum');
  }
} catch (err) {
  if (err.message.includes('timeout')) {
    console.log('Consensus timed out - network issue?');
  }
}

// Execution when not assigned
const result = await executor.execute('task-1');
if (result.consensusApproved && !result.assignedAsExecutor) {
  console.log('Another keeper is executing this task');
}

// Ledger persistence issues
try {
  ledger.snapshot();
} catch (err) {
  logger.error('Failed to persist ledger:', err);
  // System continues - ledger already in memory
}
```

---

## Best Practices

1. **Always verify executor assignment** before executing task
2. **Report execution results** for ledger consistency
3. **Call maintain() periodically** for cleanup
4. **Handle timeouts gracefully** with fallback logic
5. **Verify network connectivity** before consensus operations
6. **Monitor consensus stats** for health checks
7. **Rotate HMAC secrets regularly** for security
8. **Test with network delays** before production

