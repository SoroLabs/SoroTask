/**
 * Dead-Letter Queue Demo
 * 
 * This script demonstrates the Dead-Letter Queue functionality
 * for handling repeatedly failing tasks.
 */

const { DeadLetterQueue } = require('../src/deadLetter');
const { ErrorClassification } = require('../src/retry');

// Create a simple logger
const logger = {
  info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
  warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || ''),
  error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ''),
  debug: (msg, data) => console.log(`[DEBUG] ${msg}`, data || ''),
};

// Initialize Dead-Letter Queue with demo config
const dlq = new DeadLetterQueue({
  logger,
  config: {
    maxFailures: 3,           // Quarantine after 3 failures
    failureWindowMs: 60000,   // Within 1 minute
    autoQuarantine: true,
    maxRecords: 100,
  },
});

// Set up event listeners
dlq.on('failure:recorded', ({ taskId, failureRecord }) => {
  console.log(`\n📝 Failure recorded for task ${taskId}`);
  console.log(`   Error: ${failureRecord.error.message}`);
  console.log(`   Classification: ${failureRecord.errorClassification}`);
});

dlq.on('task:quarantined', ({ taskId, record }) => {
  console.log(`\n🚫 Task ${taskId} QUARANTINED`);
  console.log(`   Reason: ${record.reason}`);
  console.log(`   Failure count: ${record.failureCount}`);
  console.log(`   Error pattern: ${record.errorPattern.type} (${Math.round(record.errorPattern.confidence * 100)}% confidence)`);
});

dlq.on('task:recovered', ({ taskId, recoveryReason }) => {
  console.log(`\n✅ Task ${taskId} RECOVERED`);
  console.log(`   Reason: ${recoveryReason}`);
});

// Demo scenarios
async function runDemo() {
  console.log('='.repeat(60));
  console.log('Dead-Letter Queue Demo');
  console.log('='.repeat(60));

  // Scenario 1: Retryable errors leading to quarantine
  console.log('\n📋 Scenario 1: Retryable errors exceeding threshold');
  console.log('-'.repeat(60));

  const task1Error = new Error('Network timeout');
  task1Error.code = 'TIMEOUT';

  for (let i = 1; i <= 3; i++) {
    console.log(`\nAttempt ${i} for task 1...`);
    dlq.recordFailure(1, {
      error: task1Error,
      errorClassification: ErrorClassification.RETRYABLE,
      attempt: i,
      phase: 'execution',
      taskConfig: {
        last_run: 1000,
        interval: 3600,
        gas_balance: 5000,
        target: 'CTARGET123...',
        function: 'execute_task',
      },
    });
    await sleep(100);
  }

  // Scenario 2: Non-retryable error immediate quarantine
  console.log('\n\n📋 Scenario 2: Non-retryable error');
  console.log('-'.repeat(60));

  const task2Error = new Error('Invalid arguments');
  task2Error.code = 'INVALID_ARGS';

  console.log('\nAttempt 1 for task 2...');
  dlq.recordFailure(2, {
    error: task2Error,
    errorClassification: ErrorClassification.NON_RETRYABLE,
    attempt: 1,
    phase: 'execution',
  });

  // Record more failures to trigger quarantine
  for (let i = 2; i <= 3; i++) {
    console.log(`\nAttempt ${i} for task 2...`);
    dlq.recordFailure(2, {
      error: task2Error,
      errorClassification: ErrorClassification.NON_RETRYABLE,
      attempt: i,
      phase: 'execution',
    });
    await sleep(100);
  }

  // Scenario 3: Manual quarantine
  console.log('\n\n📋 Scenario 3: Manual quarantine');
  console.log('-'.repeat(60));

  console.log('\nManually quarantining task 3...');
  dlq.quarantine(3, 'manual_quarantine', {
    operator: 'admin',
    reason: 'Suspected malicious task',
  });

  // Display statistics
  console.log('\n\n📊 Dead-Letter Queue Statistics');
  console.log('-'.repeat(60));
  const stats = dlq.getStats();
  console.log(`Total quarantined: ${stats.totalQuarantined}`);
  console.log(`Active quarantined: ${stats.activeQuarantined}`);
  console.log(`Total recovered: ${stats.totalRecovered}`);
  console.log(`Total records: ${stats.totalRecords}`);

  // Display quarantined tasks
  console.log('\n\n📋 Quarantined Tasks');
  console.log('-'.repeat(60));
  const quarantinedTasks = dlq.getQuarantinedTasks();
  console.log(`Quarantined task IDs: [${quarantinedTasks.join(', ')}]`);

  // Inspect a specific task
  console.log('\n\n🔍 Inspecting Task 1');
  console.log('-'.repeat(60));
  const record = dlq.getRecord(1);
  if (record) {
    console.log(JSON.stringify(record, null, 2));
  }

  // Scenario 4: Recovery
  console.log('\n\n📋 Scenario 4: Task recovery');
  console.log('-'.repeat(60));

  console.log('\nRecovering task 1 (issue resolved)...');
  const recovered = dlq.recover(1, 'network_issue_resolved');
  console.log(`Recovery successful: ${recovered}`);

  // Check if task is still quarantined
  console.log(`\nIs task 1 quarantined? ${dlq.isQuarantined(1)}`);
  console.log(`Is task 2 quarantined? ${dlq.isQuarantined(2)}`);

  // Final statistics
  console.log('\n\n📊 Final Statistics');
  console.log('-'.repeat(60));
  const finalStats = dlq.getStats();
  console.log(`Total quarantined: ${finalStats.totalQuarantined}`);
  console.log(`Active quarantined: ${finalStats.activeQuarantined}`);
  console.log(`Total recovered: ${finalStats.totalRecovered}`);

  // Get all records
  console.log('\n\n📋 All Dead-Letter Records');
  console.log('-'.repeat(60));
  const allRecords = dlq.getAllRecords();
  allRecords.forEach(record => {
    console.log(`\nTask ${record.taskId}:`);
    console.log(`  Status: ${record.status}`);
    console.log(`  Reason: ${record.reason}`);
    console.log(`  Failures: ${record.failureCount}`);
    console.log(`  Error pattern: ${record.errorPattern.type}`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('Demo complete!');
  console.log('='.repeat(60));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the demo
runDemo().catch(err => {
  console.error('Demo failed:', err);
  process.exit(1);
});
