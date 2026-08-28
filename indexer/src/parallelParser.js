const { scValToNative, xdr } = require('@stellar/stellar-sdk');
const { EventSchemaRegistry } = require('./eventSchemaRegistry');

class ParallelLedgerParser {
  constructor(options = {}) {
    this.concurrency = options.concurrency || 4;
    this.schemaRegistry = options.schemaRegistry || new EventSchemaRegistry(options);
  }

  parseEvent(event) {
    try {
      const topics = event.topic.map((t) => scValToNative(xdr.ScVal.fromXDR(t, 'base64')));
      const name = topics[0];
      let taskId;

      if (topics.length > 2 && topics[1] === 'v1') {
        taskId = Number(topics[2]);
      } else if (topics.length > 2 && typeof topics[1] === 'string' && topics[1].startsWith('v')) {
        taskId = Number(topics[2]);
      } else {
        taskId = Number(topics[1]);
      }

      const data = scValToNative(xdr.ScVal.fromXDR(event.value, 'base64'));

      let dataJson;
      switch (name) {
        case 'TaskRegistered':
        case 'TaskExecuted':
        case 'TaskPaused':
        case 'TaskResumed':
        case 'TaskCancelled':
          dataJson = JSON.stringify({ creator: data[0] });
          break;
        case 'ContractInitialized':
          dataJson = JSON.stringify({ token: data[0] });
          break;
        case 'KeeperPaid':
          dataJson = JSON.stringify({ keeper: data[0], fee: data[1] ? data[1].toString() : '0' });
          break;
        case 'GasDeposited':
        case 'GasWithdrawn':
          dataJson = JSON.stringify({
            address: data[0],
            amount: data[1] ? data[1].toString() : '0',
          });
          break;
        default:
          dataJson = JSON.stringify({ raw: data });
          break;
      }

      return {
        ledgerSequence: event.ledgerSequence || event.ledger,
        eventName: name,
        taskId: taskId || 0,
        dataJson,
        parsedAt: new Date().toISOString(),
      };
    } catch (err) {
      throw new Error(`Failed to parse ledger event: ${err.message}`);
    }
  }

  /**
   * Parse an event using the schema registry for versioned decoding.
   * Falls back to legacy parsing if schema registry fails.
   *
   * @param {object} event - Raw event with topic and value arrays
   * @returns {object} Parsed event
   */
  parseEventWithSchema(event) {
    try {
      const name = scValToNative(xdr.ScVal.fromXDR(event.topic[0], 'base64'));
      const ledgerSequence = event.ledgerSequence || event.ledger;

      const decoded = this.schemaRegistry.decodeEvent(
        name,
        event.topic,
        event.value,
        ledgerSequence,
      );

      return {
        ledgerSequence,
        eventName: decoded.eventName,
        taskId: decoded.taskId,
        dataJson: JSON.stringify(decoded.data),
        schemaVersion: decoded.version,
        isFallback: decoded.isFallback,
        parsedAt: new Date().toISOString(),
      };
    } catch (err) {
      // Fallback to legacy parsing
      return this.parseEvent(event);
    }
  }

  async parseBatch(events = []) {
    if (events.length === 0) return [];

    const chunkSize = Math.ceil(events.length / this.concurrency);
    const chunks = [];

    for (let i = 0; i < events.length; i += chunkSize) {
      chunks.push(events.slice(i, i + chunkSize));
    }

    const chunkPromises = chunks.map((chunk) =>
      Promise.resolve().then(() => chunk.map((evt) => this.parseEvent(evt)))
    );

    const results = await Promise.all(chunkPromises);
    return results.flat();
  }

  batchWriteToDb(db, parsedEvents = [], contractId = 'CONTRACT_ID') {
    return new Promise((resolve, reject) => {
      if (parsedEvents.length === 0) {
        return resolve({ count: 0 });
      }

      db.serialize(() => {
        db.run('BEGIN TRANSACTION', (err) => {
          if (err) return reject(err);
        });

        const stmt = db.prepare(
          `INSERT OR IGNORE INTO events (ledger_sequence, contract_id, event_name, task_id, data_json)
           VALUES (?, ?, ?, ?, ?)`
        );

        let insertedCount = 0;
        let hasError = false;

        for (const evt of parsedEvents) {
          stmt.run(
            evt.ledgerSequence,
            contractId,
            evt.eventName,
            evt.taskId,
            evt.dataJson,
            (err) => {
              if (err && !hasError) {
                hasError = true;
                db.run('ROLLBACK', () => reject(err));
              } else {
                insertedCount++;
              }
            }
          );
        }

        stmt.finalize(() => {
          if (!hasError) {
            db.run('COMMIT', (err) => {
              if (err) reject(err);
              else resolve({ count: insertedCount });
            });
          }
        });
      });
    });
  }
}

module.exports = {
  ParallelLedgerParser,
};
