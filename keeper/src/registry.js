const fs = require('fs');
const path = require('path');
const { xdr } = require('@stellar/stellar-sdk');
const { createLogger } = require('./logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

class TaskRegistry {
  constructor(server, contractId, options = {}) {
    this.server = server;
    this.contractId = contractId;
    this.taskIds = new Set();
    this.tasks = new Map(); // Store taskId -> taskDetails (including status, logs)
    this.lastSeenLedger = options.startLedger || 0;
    this.logger = options.logger || createLogger('registry');
    this._ensureDataDir();
    this._loadFromDisk();
  }

  /**
     * Initialize the registry: load persisted state, then backfill any
     * historical events we may have missed since the last run.
     */
  async init() {
    this.logger.info('Initializing task registry');
    await this._fetchEvents();
    this.logger.info('Registry initialized', { taskCount: this.taskIds.size });
  }

  /**
     * Poll for new TaskRegistered events since last seen ledger.
     * Call this on every polling cycle.
     */
  async poll() {
    await this._fetchEvents();
  }

  /**
     * Return the current list of known task IDs.
     * @returns {number[]}
     */
  getTaskIds() {
    return Array.from(this.taskIds).sort((a, b) => a - b);
  }

  /**
   * Get all tasks with their current details and status.
   * @returns {Object[]}
   */
  getTasksWithStats() {
    return Array.from(this.tasks.values()).sort((a, b) => b.id - a.id);
  }

  /**
   * Update task details or status.
   * @param {number} taskId 
   * @param {Object} update 
   */
  updateTask(taskId, update) {
    const existing = this.tasks.get(taskId) || { id: taskId, status: 'unknown' };
    this.tasks.set(taskId, { ...existing, ...update, updatedAt: new Date().toISOString() });
    
    // Also ensure it's in taskIds
    if (!this.taskIds.has(taskId)) {
      this.taskIds.add(taskId);
    }
  }

  // ---- internal ----

  async _fetchEvents() {
    try {
      // We need a valid startLedger. If we don't have one, grab the latest.
      if (!this.lastSeenLedger) {
        const info = await this.server.getLatestLedger();
        // Look back a reasonable window (default ~1 hour on testnet ≈ 720 ledgers)
        this.lastSeenLedger = Math.max(info.sequence - 720, 0);
      }

      const contractId = this.contractId;

      // Fetch events page by page
      let cursor = undefined;
      let hasMore = true;

      while (hasMore) {
        const params = {
          startLedger: cursor ? undefined : this.lastSeenLedger,
          filters: [
            {
              type: 'contract',
              contractIds: [contractId],
              topics: [
                ['AAAADwAAAA9UYXNrUmVnaXN0ZXJlZAA=', '*'],  // Symbol("TaskRegistered"), *
              ],
            },
          ],
          limit: 100,
        };

        if (cursor) {
          params.cursor = cursor;
          delete params.startLedger;
        }

        const response = await this.server.getEvents(params);

        if (!response || !response.events || response.events.length === 0) {
          hasMore = false;
          break;
        }

        for (const event of response.events) {
          try {
            const taskId = this._extractTaskId(event);
            if (taskId !== null && !this.taskIds.has(taskId)) {
              this.taskIds.add(taskId);
              this.updateTask(taskId, { id: taskId, status: 'registered', registeredAt: event.ledgerCloseAt });
              this.logger.info('Discovered task ID', { taskId });
            }
          } catch (err) {
            this.logger.warn('Failed to decode event', { error: err.message });
          }

          // Track the latest ledger we've processed
          if (event.ledger && event.ledger > this.lastSeenLedger) {
            this.lastSeenLedger = event.ledger;
          }
        }

        // If we got fewer events than the limit, we're done
        if (response.events.length < 100) {
          hasMore = false;
        } else {
          cursor = response.cursor || response.events[response.events.length - 1].pagingToken;
        }
      }

      this._saveToDisk();
    } catch (err) {
      // Don't crash on transient RPC errors — just log and keep going
      this.logger.error('Error fetching events', { error: err.message });
    }
  }

  /**
     * Extract the u64 task ID from the second topic of a TaskRegistered event.
     */
  _extractTaskId(event) {
    // event.topic is an array of base64-encoded XDR ScVal values
    // topic[0] = Symbol("TaskRegistered"), topic[1] = task_id (u64)
    if (!event.topic || event.topic.length < 2) {
      return null;
    }

    const taskIdXdr = event.topic[1];

    // The topic values come as base64-encoded XDR
    const scVal = xdr.ScVal.fromXDR(taskIdXdr, 'base64');

    // Extract the u64 value
    if (scVal.switch().name === 'scvU64') {
      return Number(scVal.u64());
    }

    return null;
  }

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  _loadFromDisk() {
    try {
      if (fs.existsSync(TASKS_FILE)) {
        const data = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
        if (Array.isArray(data.taskIds)) {
          data.taskIds.forEach(id => this.taskIds.add(id));
        }
        if (data.tasks) {
          Object.entries(data.tasks).forEach(([id, details]) => {
            this.tasks.set(Number(id), details);
          });
        }
        if (data.lastSeenLedger && data.lastSeenLedger > this.lastSeenLedger) {
          this.lastSeenLedger = data.lastSeenLedger;
        }
        this.logger.info('Loaded tasks from disk', { taskCount: this.taskIds.size, ledger: this.lastSeenLedger });
      }
    } catch (err) {
      this.logger.warn('Could not load persisted tasks', { error: err.message });
    }
  }

  _saveToDisk() {
    try {
      const data = {
        taskIds: Array.from(this.taskIds).sort((a, b) => a - b),
        tasks: Object.fromEntries(this.tasks),
        lastSeenLedger: this.lastSeenLedger,
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.warn('Could not persist tasks', { error: err.message });
    }
  }
}

module.exports = TaskRegistry;

