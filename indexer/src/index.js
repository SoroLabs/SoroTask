const { SorobanRpc, xdr, nativeToScVal } = require("@stellar/stellar-sdk");
const sqlite3 = require("sqlite3").verbose();

// Configuration
const RPC_URL = "https://soroban-testnet.stellar.org"; // Change as needed
const CONTRACT_ID = "YOUR_CONTRACT_ID"; // Replace with actual contract ID
const DB_FILE = "./indexer.db";
const POLL_INTERVAL_MS = 6000; // 6 seconds

// Initialize RPC server
const rpc = new SorobanRpc.Server(RPC_URL);

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
  }
});

// Helper to store cursor (last processed paging token)
let cursor = "now"; // Start from now; in production, load from storage

// Event handler mapping
async function handleEvent(event) {
  const name = event.topic[0].value();
  const taskId = Number(event.topic[1].value());
  const data = event.value.value(); // Array of ScVal values

  // Convert data to JSON based on event type
  let dataJson;
  switch (name) {
    case "TaskRegistered":
    case "TaskPaused":
    case "TaskResumed":
    case "TaskCancelled":
      // Data: [creator: Address]
      dataJson = JSON.stringify({ creator: data[0].toString() });
      break;
    case "KeeperPaid":
      // Data: [keeper: Address, fee: i128]
      dataJson = JSON.stringify({ keeper: data[0].toString(), fee: data[1].toString() });
      break;
    case "GasDeposited":
    case "GasWithdrawn":
      // Data: [from/creator: Address, amount: i128]
      dataJson = JSON.stringify({
        address: data[0].toString(),
        amount: data[1].toString(),
      });
      break;
    default:
      console.warn(`Unknown event type: ${name}`);
      return;
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
    (err) => {
      if (err) {
        console.error("Error inserting event:", err.message);
      } else {
        console.log(`Stored event: ${name} for task ${taskId} at ledger ${event.ledgerSequence}`);
      }
    }
  );
  stmt.finalize();
}

// Polling loop
async function poll() {
  try {
    const response = await rpc.getEvents({
      startLedger: cursor === "now" ? undefined : cursor,
      filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
      limit: 200,
    });

    for (const event of response.events) {
      await handleEvent(event);
      cursor = event.pagingToken; // Update cursor to the last event's paging token
    }

    // In production, persist cursor to storage (e.g., file, database) here
  } catch (err) {
    console.error("Error polling events:", err.message);
  }
}

// Start polling
console.log("Starting event indexer...");
setInterval(poll, POLL_INTERVAL_MS);
poll(); // Initial call

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