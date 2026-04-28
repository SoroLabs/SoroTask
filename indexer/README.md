# SoroTask Event Indexer

A lightweight event indexer for the SoroTask smart contract that indexes contract events into a SQLite database for analytics and monitoring.

## Overview

This indexer subscribes to events emitted by the SoroTask Soroban contract and stores them in a local SQLite database. It enables backend analytics, debugging, and operator insight by providing a queryable view of task lifecycle events.

## Features

- Indexes all SoroTask contract events:
  - TaskRegistered
  - TaskPaused
  - TaskResumed
  - TaskCancelled
  - KeeperPaid
  - GasDeposited
  - GasWithdrawn
- Uses SQLite for local storage with deduplication
- Implements cursor-based polling to avoid reprocessing events
- Handles chain reprocessing safely with INSERT OR IGNORE
- Graceful shutdown with database connection cleanup
- Configurable polling interval

## Installation

```bash
npm install
```

## Configuration

Edit `src/index.js` to configure:
- `RPC_URL`: Soroban RPC endpoint (default: testnet)
- `CONTRACT_ID`: Your deployed SoroTask contract ID
- `DB_FILE`: Path to SQLite database file
- `POLL_INTERVAL_MS`: Polling interval in milliseconds (default: 6000)

## Usage

```bash
node src/index.js
```

The indexer will:
1. Connect to the Soroban RPC
2. Create/open the SQLite database
3. Begin polling for new events
4. Store each unique event in the database
5. Continue until interrupted (Ctrl+C)

## Database Schema

The indexer creates an `events` table with the following structure:

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_sequence INTEGER NOT NULL,
  contract_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  task_id INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ledger_sequence, contract_id, event_name, task_id)
);
```

### Data Storage by Event Type

- **TaskRegistered, TaskPaused, TaskResumed, TaskCancelled**: 
  ```json
  {"creator": "address"}
  ```
- **KeeperPaid**:
  ```json
  {"keeper": "address", "fee": "amount_string"}
  ```
- **GasDeposited, GasWithdrawn**:
  ```json
  {"address": "address", "amount": "amount_string"}
  ```

## Event Processing Logic

The indexer maps each event type to specific database operations:
- TaskRegistered → New task entry
- TaskPaused → Task deactivated
- TaskResumed → Task activated
- TaskCancelled → Task removed
- KeeperPaid → Execution recorded
- GasDeposited → Balance increased
- GasWithdrawn → Balance decreased

## Deduplication & Re-indexing

The `UNIQUE` constraint on `(ledger_sequence, contract_id, event_name, task_id)` combined with `INSERT OR IGNORE` ensures:
- No duplicate events are stored
- Safe re-indexing from any point
- Resilience to temporary network failures

## Extending the Indexer

To add support for new event types:
1. Add the event name to the switch statement in `handleEvent()`
2. Define how to convert the event's `data` array to JSON
3. Ensure the data structure matches what your analytics need

## Production Considerations

For production deployments:
1. Persist the cursor (paging token) to survive restarts
2. Consider using a more robust database (PostgreSQL) for high volume
3. Add monitoring and alerting for indexing lag
4. Implement backup strategies for the database
5. Consider horizontal scaling with multiple instances (ensure coordination)

## Development

```bash
# Install dependencies
npm install

# Run the indexer
node src/index.js
```

## License

ISC