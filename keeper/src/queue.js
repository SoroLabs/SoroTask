const EventEmitter = require('events');
const metrics = require('./metrics');

class ExecutionQueue extends EventEmitter {
    constructor(limit) {
        super();
        this.concurrencyLimit = parseInt(limit || process.env.MAX_CONCURRENT_EXECUTIONS || 3, 10);
        
        // p-limit export resolution for CJS environments depending on library version
        const pLimitMod = require('p-limit');
        const pLimit = pLimitMod.default || pLimitMod;
        
        this.limit = pLimit(this.concurrencyLimit);
        
        this.depth = 0;
        this.inFlight = 0;
        this.completed = 0;
        this.failedCount = 0;
        
        this.activePromises = [];
        this.failedTasks = new Set();
    }

    async enqueue(taskIds, executorFn) {
        // Pre-filter valid tasks (e.g., skip ones that failed in previous runs this cycle if persistent)
        const validTaskIds = taskIds.filter(id => !this.failedTasks.has(id));
        this.depth = validTaskIds.length;

        // Track tasks due for this cycle
        metrics.increment('tasksDueTotal', validTaskIds.length);

        const cycleStartTime = Date.now();

        const cyclePromises = validTaskIds.map(taskId => {
            return this.limit(async () => {
                this.inFlight++;
                this.depth--;

                this.emit('task:started', taskId);
                try {
                    await executorFn(taskId);
                    this.completed++;
                    metrics.increment('tasksExecutedTotal');
                    this.emit('task:success', taskId);
                } catch (error) {
                    this.failedCount++;
                    this.failedTasks.add(taskId);
                    metrics.increment('tasksFailedTotal');
                    this.emit('task:failed', taskId, error);
                } finally {
                    this.inFlight--;
                }
            });
        });

        this.activePromises.push(...cyclePromises);

        try {
            await Promise.all(cyclePromises);
        } catch (e) {
            // Already handled in loop
        } finally {
            const cycleDuration = Date.now() - cycleStartTime;
            metrics.record('lastCycleDurationMs', cycleDuration);

            this.emit('cycle:complete', {
                depth: this.depth,
                inFlight: this.inFlight,
                completed: this.completed,
                failed: this.failedCount
            });

            // Note: failedTasks remain stored across a cycle, to ensure tasks that fail
            // after retries are not repeatedly re-queued until manually reset if needed.
            this.activePromises = [];
            this.completed = 0;
            this.failedCount = 0;
        }
    }

    async drain() {
        console.log(`[ExecutionQueue] Draining queue. Waiting for ${this.limit.activeCount} pending/in-flight tasks to complete/cancel...`);
        
        // Clear tasks that haven't started yet
        this.limit.clearQueue();

        // When tasks are cleared, their promises stay pending forever in activePromises 
        // We only really want to wait for the ones that actually started doing work
        // We can do this implicitly by just polling or race. 
        // Actually Promise.allSettled on `this.activePromises` hangs if some limits were cleared, 
        // because pLimit cleared tasks are NEVER resolved/rejected!
        // To fix this, resolve any hanging promises locally, or simply resolve drain when inFlight is 0.
        
        while(this.inFlight > 0) {
           await new Promise(r => setTimeout(r, 50));
        }

        console.log('[ExecutionQueue] Drained successfully.');
    }
}

module.exports = ExecutionQueue;
