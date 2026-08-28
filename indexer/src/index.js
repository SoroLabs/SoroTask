const { rpc: SorobanRpc, xdr, scValToNative, nativeToScVal, Address, Contract } = require("@stellar/stellar-sdk");
const sqlite3 = require("sqlite3").verbose();
const {
  buildRepairPlan,
  compareTaskState,
  mapOnChainTask,
} = require("./reconciliation");
const { runStaleTaskCleanup } = require("./staleTasks");
const { startApiServer } = require("./api");
const { broadcastEvent } = require("./wsServer");
const { computeAndStoreLedgerMerkle } = require("./merkleStore");
const { scheduleArchival } = require("./archival");
const { pubsub, EVENT_ADDED } = require("./graphql/pubsub");
const { LedgerHashValidator } = require("./ledgerHashValidator");
const { EventSchemaRegistry } = require("./eventSchemaRegistry");

// Configuration
const RPC_URL = "https://soroban-testnet.stellar.org"; // Change as needed
const CONTRACT_ID = process.env.CONTRACT_ID || "CCKANVNJJIKGYU4TYTZBGL5JQVLPW33KQUW6JFHPLKXDLQEZETHOUAMJ"; // Replace with actual contract ID
const DB_FILE = process.env.DB_FILE || "./indexer.db";
const POLL_INTERVAL_MS = 6000; // 6 seconds
const RECONCILE_INTERVAL_MS = 300000; // 5 minutes
const STALE_CLEANUP_INTERVAL_MS = 86400000; // 24 hours

// Initialize RPC server
const rpc = new SorobanRpc.Server(RPC_URL);
const contract = new Contract(CONTRACT_ID);

// Initialize database
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error("Error opening database:", err.message);
  } else {
    console.log("Connected to SQLite database.");
    db.run(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ledger_sequence INTEGER NOT NULL,
        contract_id TEXT NOT NULL,
        event_name TEXT NOT NULL,
        task_id INTEGER NOT NULL,
        data_json TEXT NOT NULL,
        processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(ledger_sequence, contract_id, event_name, task_id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS tasks (
        task_id INTEGER PRIMARY KEY,
        creator TEXT NOT NULL,
        target TEXT NOT NULL,
        function TEXT NOT NULL,
        args_json TEXT,
        resolver TEXT,
        interval INTEGER NOT NULL,
        last_run INTEGER NOT NULL,
        gas_balance TEXT NOT NULL,
        whitelist_json TEXT,
        is_active INTEGER NOT NULL,
        blocked_by_json TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_reconciled_at TIMESTAMP
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS reconciliation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER,
        status TEXT NOT NULL,
        details_json TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
});

// Initialize ledger hash validator for reorg detection (Issue #1065)
const ledgerHashValidator = new LedgerHashValidator({
  rpc,
  db,
  windowSize: parseInt(process.env.LEDGER_HASH_WINDOW_SIZE, 10) || 64,
  onRollback: async (details) => {
    console.error(`[ReorgRollback] Rolled back to ledger ${details.rollback.rollbackToSequence}`, {
      deletedEvents: details.rollback.deletedEvents,
      deletedTasks: details.rollback.deletedTasks,
    });
  },
});

// Initialize event schema registry for multi-version event parsing (Issue #1067)
const eventSchemaRegistry = new EventSchemaRegistry();

// Promise-style adapters over the callback `db` so shared modules (merkleStore)
// can run against the indexer's live database connection.
const dbDeps = {
  queryAll: (sql, params = []) =>
    new Promise((resolve, reject) =>
      db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))),
  queryGet: (sql, params = []) =>
    new Promise((resolve, reject) =>
      db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))),
  queryRun: (sql, params = []) =>
    new Promise((resolve, reject) =>
      db.run(sql, params, function (err) { return err ? reject(err) : resolve(this); })),
};

// Helper to store cursor (last processed paging token)
let cursor = "0"; // Start from 0; will be updated to latest ledger on first poll

// Cache invalidation engine (no Redis by default; swap in a real client via env)
const cacheInvalidator = new CacheInvalidationEngine();

// Ledger gap detector — invalidates cache whenever sequence continuity breaks
const gapDetector = new LedgerGapDetector({
  cacheInvalidator,
  maxAllowedGap: 1,
  onGap: (info) => {
    console.warn(
      `[GapDetector] Ledger gap of ${info.gapSize} detected (${info.from} → ${info.to}). ` +
      `Cache flushed to prevent stale reads.`
    );
  },
});

// Event handler mapping
async function handleEvent(event) {
  // Use schema registry for versioned event decoding (Issue #1067)
  const topics = event.topic.map(t => scValToNative(xdr.ScVal.fromXDR(t, 'base64')));
  const name = topics[0];
  
  // Attempt schema-based decoding first
  const decoded = eventSchemaRegistry.decodeEvent(
    name,
    event.topic,
    event.value,
    event.ledgerSequence,
  );
  
  let taskId;
  let dataJson;
  
  if (decoded && !decoded.isFallback) {
    // Schema registry successfully decoded the event
    taskId = decoded.taskId;
    dataJson = JSON.stringify(decoded.data);
  } else {
    // Fallback to legacy parsing
    // Version-aware topic extraction
    if (topics.length > 2 && topics[1] === "v1") {
      taskId = Number(topics[2]);
    } else if (topics.length > 2 && typeof topics[1] === "string" && topics[1].startsWith("v")) {
      // Future-proofing: unknown version marker detected
      console.warn(`[Indexer] Detected unknown event version: ${topics[1]}. Attempting to parse topic[2] as taskId.`);
      taskId = Number(topics[2]);
    } else {
      // Legacy event (v0): taskId is the second topic
      taskId = Number(topics[1]);
    }
    
    const data = scValToNative(xdr.ScVal.fromXDR(event.value, 'base64')); // Array of native values

    // Convert data to JSON based on event type
    switch (name) {
      case "TaskRegistered":
      case "TaskPaused":
      case "TaskResumed":
      case "TaskCancelled":
        // Data: [creator: string]
        dataJson = JSON.stringify({ creator: data[0] });
        break;
      case "ContractInitialized":
        // Data: [token: string]
        dataJson = JSON.stringify({ token: data[0] });
        break;
      case "KeeperPaid":
        // Data: [keeper: string, fee: bigint]
        dataJson = JSON.stringify({ keeper: data[0], fee: data[1].toString() });
        break;
      case "GasDeposited":
      case "GasWithdrawn":
        // Data: [from/creator: string, amount: bigint]
        dataJson = JSON.stringify({
          address: data[0],
          amount: data[1].toString(),
        });
        break;
      default:
        console.warn(`Unknown event type: ${name}`);
        return;
    }
  }

  // Store event in database
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO events (ledger_sequence, contract_id, event_name, task_id, data_json)
     VALUES (?, ?, ?, ?, ?)`
  );
  stmt.run(
    event.ledgerSequence,
    CONTRACT_ID,
    name,
    taskId,
    dataJson,
    function (err) {
      if (err) {
        console.error("Error inserting event:", err.message);
      } else {
        recordEventIndexed(name);
        console.log(`Stored event: ${name} for task ${taskId} at ledger ${event.ledgerSequence}`);
        // Issue #861: push newly-ingested events to subscribed WebSocket clients.
        broadcastEvent({
          ledger_sequence: event.ledgerSequence,
          contract_id: CONTRACT_ID,
          event_name: name,
          task_id: taskId,
          data: JSON.parse(dataJson),
        });
        // Issue #824: publish to the GraphQL `eventAdded` subscription.
        pubsub.publish(EVENT_ADDED, {
          eventAdded: {
            id: this.lastID,
            ledger_sequence: event.ledgerSequence,
            contract_id: CONTRACT_ID,
            event_name: name,
            task_id: taskId,
            data_json: dataJson,
            processed_at: new Date().toISOString(),
          },
        });
      }
    }
  );
  stmt.finalize();

  // After storing event, reconcile this task to ensure state is correct
  if (taskId) {
    await reconcileTask(taskId);
    cacheInvalidator.invalidateForEvent(name, taskId, JSON.parse(dataJson || '{}'));
  }
}

// Fetch on-chain task state
async function fetchOnChainTask(taskId) {
  try {
    const { Keypair, TransactionBuilder, Networks, Operation } = require("@stellar/stellar-sdk");
    const source = Keypair.random();
    const account = new (require("@stellar/stellar-sdk").Account)(source.publicKey(), "0");

    let operation;
    if (typeof contract.call === 'function') {
      operation = contract.call("get_task", nativeToScVal(taskId, { type: "u64" }));
    } else {
      operation = Operation.invokeContract({
        contract: CONTRACT_ID,
        function: "get_task",
        args: [nativeToScVal(taskId, { type: "u64" })]
      });
    }

    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    }).addOperation(operation).setTimeout(30).build();

    const result = await rpc.simulateTransaction(tx);

    if (result.error) {
      console.error(`Error simulating get_task for task ${taskId}:`, result.error);
      return null;
    }

    if (!result.results || result.results.length === 0) {
      return null;
    }

    const scVal = xdr.ScVal.fromXDR(result.results[0].xdr, 'base64');
    const native = scValToNative(scVal);
    return native;
  } catch (err) {
    console.error(`Error fetching on-chain task ${taskId}:`, err.message);
    return null;
  }
}

// Get indexed task from database
function getIndexedTask(taskId) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM tasks WHERE task_id = ?", [taskId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Upsert task in database
function upsertTask(task) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO tasks 
      (task_id, creator, target, function, args_json, resolver, interval, last_run, gas_balance, whitelist_json, is_active, blocked_by_json, updated_at, last_reconciled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    stmt.run(
      task.task_id,
      task.creator,
      task.target,
      task.function,
      task.args_json || JSON.stringify([]),
      task.resolver || null,
      task.interval,
      task.last_run,
      task.gas_balance,
      task.whitelist_json || JSON.stringify([]),
      task.is_active ? 1 : 0,
      task.blocked_by_json || JSON.stringify([]),
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
    stmt.finalize();
  });
}

// Log reconciliation result
function logReconciliation(taskId, status, details) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT INTO reconciliation_logs (task_id, status, details_json)
      VALUES (?, ?, ?)
    `);
    stmt.run(
      taskId,
      status,
      JSON.stringify(details),
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
    stmt.finalize();
  });
}

// Reconcile a single task
async function reconcileTask(taskId) {
  console.log(`[Reconciliation] Starting reconciliation for task ${taskId}`);
  
  const onChainTask = await fetchOnChainTask(taskId);
  const indexedTask = await getIndexedTask(taskId);

  if (!onChainTask) {
    if (indexedTask) {
      // Task exists in index but not on chain - mark as cancelled/removed
      console.log(`[Reconciliation] Task ${taskId} exists in index but not on chain - removing from index`);
      await new Promise((resolve, reject) => {
        db.run("DELETE FROM tasks WHERE task_id = ?", [taskId], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      const comparison = compareTaskState(indexedTask, null);
      await logReconciliation(taskId, "removed", {
        reason: "Task no longer exists on chain",
        comparison,
        repairPlan: buildRepairPlan(comparison),
      });
    } else {
      console.log(`[Reconciliation] Task ${taskId} not found on chain or in index`);
    }
    return;
  }

  const taskToUpsert = mapOnChainTask(taskId, onChainTask);

  // Compare with indexed task
  let status = "unchanged";
  let details = {};
  const comparison = compareTaskState(indexedTask, taskToUpsert);
  const repairPlan = buildRepairPlan(comparison);

  if (!indexedTask) {
    status = "added";
    details = { reason: "New task discovered on chain", comparison, repairPlan };
  } else {
    if (comparison.status === "drift") {
      status = "repaired";
      details = {
        mismatches: comparison.mismatches,
        likelyCause: comparison.likelyCause,
        repairPlan,
      };
    }
  }

  await upsertTask(taskToUpsert);
  await logReconciliation(taskId, status, details);

  console.log(`[Reconciliation] Task ${taskId} reconciliation complete: ${status}`);
  return { taskId, status, details };
}

// Reconcile all known tasks (and discover new ones by checking counter)
async function reconcileAll() {
  console.log("[Reconciliation] Starting full reconciliation");
  
  // First, try to get the counter from the contract to know how many tasks exist
  let maxTaskId = 0;
  
  // Get all indexed task IDs
  const indexedTaskIds = await new Promise((resolve, reject) => {
    db.all("SELECT task_id FROM tasks ORDER BY task_id", [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(r => r.task_id));
    });
  });

  if (indexedTaskIds.length > 0) {
    maxTaskId = Math.max(...indexedTaskIds);
  }

  // Reconcile all known tasks
  const results = [];
  for (const taskId of indexedTaskIds) {
    const result = await reconcileTask(taskId);
    results.push(result);
  }

  // Check for new tasks beyond maxTaskId
  let nextTaskId = maxTaskId + 1;
  let foundNewTasks = true;
  while (foundNewTasks) {
    const onChainTask = await fetchOnChainTask(nextTaskId);
    if (onChainTask) {
      const result = await reconcileTask(nextTaskId);
      results.push(result);
      nextTaskId++;
    } else {
      foundNewTasks = false;
    }
  }

  console.log(`[Reconciliation] Full reconciliation complete. Processed ${results.length} tasks.`);
  return results;
}

// Polling loop
async function poll() {
  try {
    const latest = await rpc.getLatestLedger();
    const networkHead = latest.sequence;

    let startLedgerToUse = cursor;
    if (cursor === "now" || cursor === "0" || Number(cursor) === 0) {
      startLedgerToUse = networkHead;
      cursor = startLedgerToUse.toString(); // Initialize cursor
    }

    updateLedgerMetrics(Number(cursor), Number(networkHead));

    const response = await rpc.getEvents({
      startLedger: Number(startLedgerToUse),
      filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
      limit: 200,
    });

    // Validate ledger hashes for reorg detection (Issue #1065)
    const ledgerHashes = new Map();
    for (const event of response.events) {
      const seq = event.ledgerSequence;
      if (!ledgerHashes.has(seq)) {
        // Fetch ledger header to get hash and prev_hash
        try {
          const ledgerResponse = await rpc.getLedger(seq);
          if (ledgerResponse && ledgerResponse.hash) {
            ledgerHashes.set(seq, {
              sequence: seq,
              hash: ledgerResponse.hash,
              prevHash: ledgerResponse.prevHash || ledgerResponse.previousLedgerHash || null,
            });
          }
        } catch (ledgerErr) {
          console.warn(`[HashValidator] Could not fetch ledger ${seq}:`, ledgerErr.message);
        }
      }
    }

    // Validate ledger chain integrity
    for (const [seq, ledgerData] of ledgerHashes) {
      const validation = await ledgerHashValidator.validateNewLedger(
        ledgerData.sequence,
        ledgerData.hash,
        ledgerData.prevHash,
      );

      if (!validation.valid) {
        console.error(`[HashValidator] Ledger ${seq} validation failed: ${validation.reason}`);
        
        if (validation.reason === 'hash_mismatch') {
          // Potential reorg — collect chain data and attempt rollback
          console.error(`[ReorgRollback] Hash mismatch detected at ledger ${seq}. Initiating rollback...`);
          
          const chainData = Array.from(ledgerHashes.values());
          const rollbackResult = await ledgerHashValidator.rollbackToAncestor(chainData);
          
          if (rollbackResult.success) {
            console.log(`[ReorgRollback] Successfully rolled back to ledger ${rollbackResult.ancestor.sequence}`);
            // Update cursor to the rollback point
            cursor = rollbackResult.ancestor.sequence.toString();
          } else {
            console.error(`[ReorgRollback] Failed to rollback: ${rollbackResult.reason}`);
          }
          return; // Abort this poll cycle
        }
      }
    }

    const touchedLedgers = new Set();
    for (const event of response.events) {
      await handleEvent(event);
      touchedLedgers.add(event.ledgerSequence);
      cursor = event.ledger.toString(); // Update cursor to the last event's ledger
      updateLedgerMetrics(Number(cursor), Number(networkHead));
    }

    // Persist ledger hash window periodically
    if (touchedLedgers.size > 0) {
      await ledgerHashValidator.getState(); // Trigger persistence if needed
    }

    // Issue #863: (re)compute and persist a Merkle root over each ledger's
    // event set once that ledger's events have been ingested.
    for (const ledger of touchedLedgers) {
      try {
        await computeAndStoreLedgerMerkle(dbDeps, ledger);
      } catch (merkleErr) {
        console.error(`Error computing Merkle root for ledger ${ledger}:`, merkleErr.message);
      }
    }

    // In production, persist cursor to storage (e.g., file, database) here
  } catch (err) {
    console.error("Error polling events:", err.message);
  }
}

// CLI handler
function handleCLI() {
  const args = process.argv.slice(2);
  
  if (args.includes('--reconcile') || args.includes('-r')) {
    const taskIdArgIndex = args.findIndex(arg => arg === '--task-id' || arg === '-t');
    if (taskIdArgIndex !== -1 && args[taskIdArgIndex + 1]) {
      const taskId = Number(args[taskIdArgIndex + 1]);
      reconcileTask(taskId).then(() => process.exit(0)).catch(err => {
        console.error(err);
        process.exit(1);
      });
    } else {
      reconcileAll().then(() => process.exit(0)).catch(err => {
        console.error(err);
        process.exit(1);
      });
    }
    return true;
  }

  if (args.includes('--cleanup-stale')) {
    const dryRun = !args.includes('--apply');
    runStaleTaskCleanup(db, { dryRun }).then((summary) => {
      console.log(`[Cleanup] Stale task cleanup complete: ${JSON.stringify(summary)}`);
      process.exit(0);
    }).catch(err => {
      console.error(err);
      process.exit(1);
    });
    return true;
  }
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
SoroTask Indexer

Usage:
  node index.js                    Start the indexer
  node index.js --reconcile        Run full reconciliation
  node index.js -r -t <task-id>   Reconcile a specific task
  node index.js --cleanup-stale    Preview stale indexed task cleanup
  node index.js --cleanup-stale --apply
                                    Archive and delete stale indexed tasks
  node index.js --help             Show this help message

Options:
  -r, --reconcile    Run reconciliation
  -t, --task-id      Specify task ID for reconciliation
  --cleanup-stale    Detect stale indexed tasks and log the planned cleanup
  --apply            Apply stale cleanup; without this flag cleanup is dry-run only
  -h, --help         Show help
    `);
    process.exit(0);
    return true;
  }
  
  return false;
}

// Main
if (!handleCLI()) {
  // Initialize ledger hash validator for reorg detection
  ledgerHashValidator.initialize().catch(err => {
    console.error('[HashValidator] Initialization error:', err.message);
  });

  // Start polling
  console.log("Starting event indexer...");
  const { createWsServer } = require("./wsServer");
  startApiServer(4000)
    .then((httpServer) => {
      // Issue #861: attach the real-time WebSocket streaming server to the
      // same HTTP server, served at ws://<host>:4000/ws.
      createWsServer({ server: httpServer, path: "/ws" });
      console.log("🔌 WebSocket event stream ready at ws://localhost:4000/ws");
    })
    .catch(console.error);
  setInterval(poll, POLL_INTERVAL_MS);
  poll(); // Initial call

  // Start periodic reconciliation
  console.log("Starting periodic reconciliation (every 5 minutes)...");
  setInterval(reconcileAll, RECONCILE_INTERVAL_MS);

  // Start synthetic transaction monitoring for end-to-end ingestion health
  const syntheticMonitor = new SyntheticMonitor({
    db,
    rpc,
    contractId: CONTRACT_ID,
    intervalMs: Number(process.env.SYNTHETIC_INTERVAL_MS || 60_000),
    latencyThresholdMs: Number(process.env.SYNTHETIC_LATENCY_THRESHOLD_MS || 30_000),
    timeoutMs: Number(process.env.SYNTHETIC_TIMEOUT_MS || 120_000),
    webhookUrl: process.env.SYNTHETIC_MONITOR_WEBHOOK_URL || null,
  });
  syntheticMonitor.start();

  console.log("Starting stale task cleanup dry-run (every 24 hours)...");
  setInterval(() => {
    runStaleTaskCleanup(db, { dryRun: true }).then((summary) => {
      console.log(`[Cleanup] Stale task cleanup dry-run: ${JSON.stringify(summary)}`);
    }).catch((err) => {
      console.error("[Cleanup] Error running stale task cleanup:", err.message);
    });
  }, STALE_CLEANUP_INTERVAL_MS);

  // Issue #825: archive events older than ARCHIVAL_CUTOFF_DAYS (default 90)
  // to S3 Parquet and prune them from the primary table, checked daily.
  console.log("Starting event archival scheduler (cold storage, checked daily)...");
  scheduleArchival(dbDeps);
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down indexer...");
  db.close((err) => {
    if (err) {
      console.error("Error closing database:", err.message);
    }
    process.exit(0);
  });
});

module.exports = {
  handleEvent,
  reconcileTask,
  reconcileAll,
  HighAvailabilityManager,
  CacheInvalidationEngine,
  ParallelLedgerParser,
};

