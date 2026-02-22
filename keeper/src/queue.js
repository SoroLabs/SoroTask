import EventEmitter from "events";
import pLimit from "p-limit";

export class ExecutionQueue extends EventEmitter {
  constructor(limit) {
    super();

    this.concurrencyLimit = parseInt(
      limit || process.env.MAX_CONCURRENT_EXECUTIONS || 3,
      10
    );

    this.limit = pLimit(this.concurrencyLimit);

    this.depth = 0;
    this.inFlight = 0;
    this.completed = 0;
    this.failedCount = 0;

    this.activePromises = [];
    this.failedTasks = new Set();
  }

  async enqueue(taskIds, executorFn) {
    const validTaskIds = taskIds.filter(
      (id) => !this.failedTasks.has(id)
    );

    this.depth = validTaskIds.length;

    const cyclePromises = validTaskIds.map((taskId) => {
      return this.limit(async () => {
        this.inFlight++;
        this.depth--;

        this.emit("task:started", taskId);

        try {
          await executorFn(taskId);
          this.completed++;
          this.emit("task:success", taskId);
        } catch (error) {
          this.failedCount++;
          this.failedTasks.add(taskId);
          this.emit("task:failed", taskId, error);
        } finally {
          this.inFlight--;
        }
      });
    });

    this.activePromises.push(...cyclePromises);

    try {
      await Promise.all(cyclePromises);
    } catch (_) {
      // already handled
    } finally {
      this.emit("cycle:complete", {
        depth: this.depth,
        inFlight: this.inFlight,
        completed: this.completed,
        failed: this.failedCount,
      });

      this.activePromises = [];
      this.completed = 0;
      this.failedCount = 0;
    }
  }

  async drain() {
    this.limit.clearQueue();

    while (this.inFlight > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}