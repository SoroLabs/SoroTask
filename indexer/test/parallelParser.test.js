const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite3 = require('sqlite3').verbose();
const { nativeToScVal } = require('@stellar/stellar-sdk');
const { ParallelLedgerParser } = require('../src/parallelParser');

function createInMemoryEventsDb() {
  const db = new sqlite3.Database(':memory:');
  db.serialize(() => {
    db.run(`
      CREATE TABLE events (
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
  });
  return db;
}

test('ParallelLedgerParser - parses event topics and data', async () => {
  const parser = new ParallelLedgerParser();

  const topicName = nativeToScVal('TaskRegistered').toXDR('base64');
  const topicVersion = nativeToScVal('v1').toXDR('base64');
  const topicTaskId = nativeToScVal(42).toXDR('base64');
  const valueData = nativeToScVal(['G_CREATOR_ADDRESS']).toXDR('base64');

  const mockEvent = {
    ledgerSequence: 100,
    topic: [topicName, topicVersion, topicTaskId],
    value: valueData,
  };

  const parsed = parser.parseEvent(mockEvent);

  assert.equal(parsed.ledgerSequence, 100);
  assert.equal(parsed.eventName, 'TaskRegistered');
  assert.equal(parsed.taskId, 42);
  assert.deepEqual(JSON.parse(parsed.dataJson), { creator: 'G_CREATOR_ADDRESS' });
});

test('ParallelLedgerParser - batch parses and writes to sqlite in single transaction', async () => {
  const parser = new ParallelLedgerParser({ concurrency: 2 });
  const db = createInMemoryEventsDb();

  const events = [];
  for (let i = 1; i <= 10; i++) {
    events.push({
      ledgerSequence: 1000 + i,
      topic: [
        nativeToScVal('TaskExecuted').toXDR('base64'),
        nativeToScVal('v1').toXDR('base64'),
        nativeToScVal(i).toXDR('base64'),
      ],
      value: nativeToScVal([`G_CREATOR_${i}`]).toXDR('base64'),
    });
  }

  const parsedBatch = await parser.parseBatch(events);
  assert.equal(parsedBatch.length, 10);

  const res = await parser.batchWriteToDb(db, parsedBatch, 'CONTRACT_123');
  assert.equal(res.count, 10);

  const rows = await new Promise((resolve, reject) => {
    db.all('SELECT * FROM events ORDER BY task_id ASC', [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  assert.equal(rows.length, 10);
  assert.equal(rows[0].task_id, 1);
  assert.equal(rows[9].task_id, 10);

  db.close();
});
