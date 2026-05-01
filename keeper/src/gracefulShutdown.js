const EventEmitter = require("events");
const { createLogger } = require("./logger");

/**
 * GracefulShutdownManager
 * 
 * Handles graceful shutdown of the Keeper with in-flight execution draining.
 * 
 * Lifecycle:
 * 1. Init: Start listening for signals
 * 2. Shutdown Initiated: Stop accepting new work, set draining state
 * 3. Drain Phase: Wait for in-flight operations to complete with timeout
 * 4. Force Phase: Cancel remaining in-flight operations after timeout
 * 5. Cleanup: Write final state, cleanup resources
 * 6. Exit: Clean process exit
 */
class GracefulShutdownManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.logger = options.logger || createLogger("shutdown");

    // Configuration
    this.drainTimeoutMs = parseInt(
      options.drainTimeoutMs || process.env.SHUTDOWN_DRAIN_TIMEOUT_MS || 30000,
      10
    );
    this.forceTimeoutMs = parseInt(
      options.forceTimeoutMs || process.env.SHUTDOWN_FORCE_TIMEOUT_MS || 60000,
      10
    );

    // State management
    this.state = "initializing"; // initializing -> running -> draining -> forced -> cleanup -> exiting
    this.startTime = null;
    this.shutdownSignal = null;
    this.shutdownReason = null;

    // In-flight tracking
    this.inFlightTasks = new Map(); // taskId -> { startTime, status }
    this.completedTasks = [];
    this.failedTasks = [];
    this.drainedTasks = [];

    // Resources to clean
    this.resources = [];
    this.signalHandlers = new Map();

    this.logger.info("GracefulShutdownManager initialized", {
      drainTimeoutMs: this.drainTimeoutMs,
      forceTimeoutMs: this.forceTimeoutMs,
    });
  }

  /**
   * Initialize the shutdown manager by registering signal handlers
   */
  init() {
    if (this.state !== "initializing") {
      throw new Error(
        `Cannot init GracefulShutdownManager in state: ${this.state}`
      );
    }

    const signals = ["SIGTERM", "SIGINT"];
    signals.forEach((signal) => {
      const handler = () => this.initiateShutdown(signal);
      process.on(signal, handler);
      this.signalHandlers.set(signal, handler);
    });

    this.state = "running";
    this.logger.info("GracefulShutdownManager is running and listening for signals", {
      signals,
    });
  }

  /**
   * Register a resource for cleanup during shutdown
   */
  registerResource(name, cleanupFn) {
    this.resources.push({
      name,
      cleanupFn,
      cleaned: false,
      error: null,
    });
    this.logger.debug("Resource registered for shutdown cleanup", { name });
  }

  /**
   * Track in-flight task
   */
  trackTask(taskId) {
    if (!this.inFlightTasks.has(taskId)) {
      this.inFlightTasks.set(taskId, {
        taskId,
        startTime: Date.now(),
        status: "in-flight",
        result: null,
        error: null,
      });
    }
  }

  /**
   * Mark task as completed
   */
  completeTask(taskId, result = null) {
    const task = this.inFlightTasks.get(taskId);
    if (task) {
      task.status = "completed";
      task.result = result;
      const duration = Date.now() - task.startTime;
      this.completedTasks.push(taskId);
      this.logger.debug("Task completed during shutdown drain", {
        taskId,
        durationMs: duration,
      });
    }
  }

  /**
   * Mark task as failed
   */
  failTask(taskId, error = null) {
    const task = this.inFlightTasks.get(taskId);
    if (task) {
      task.status = "failed";
      task.error = error?.message || String(error);
      const duration = Date.now() - task.startTime;
      this.failedTasks.push(taskId);
      this.logger.warn("Task failed during shutdown drain", {
        taskId,
        durationMs: duration,
        error: task.error,
      });
    }
  }

  /**
   * Initiate graceful shutdown
   */
  initiateShutdown(signal, reason = null) {
    if (this.state !== "running") {
      this.logger.warn("Shutdown already in progress, ignoring signal", {
        signal,
        currentState: this.state,
      });
      return;
    }

    this.state = "draining";
    this.shutdownSignal = signal;
    this.shutdownReason = reason;
    this.startTime = Date.now();

    this.logger.info("Graceful shutdown initiated", {
      signal,
      reason,
      timestamp: new Date(this.startTime).toISOString(),
    });

    this.emit("shutdown:initiated", { signal, reason });

    // Trigger the actual shutdown
    this._executeShutdown();
  }

  /**
   * Execute the shutdown process
   */
  async _executeShutdown() {
    try {
      // Phase 1: Stop accepting new work
      this.logger.info("Phase 1: Stopping new work acceptance");
      this.emit("shutdown:stop-accepting");

      // Phase 2: Drain in-flight operations with timeout
      this.logger.info("Phase 2: Draining in-flight operations", {
        timeoutMs: this.drainTimeoutMs,
        inFlightCount: this.inFlightTasks.size,
      });

      const drained = await this._drainPhase();

      if (!drained) {
        this.logger.warn("Drain phase timeout, entering force phase", {
          incompleteTasks: Array.from(this.inFlightTasks.keys()).filter(
            (id) => this.inFlightTasks.get(id).status === "in-flight"
          ),
        });

        // Phase 3: Force phase - cancel remaining tasks
        this.state = "forced";
        this.logger.info("Phase 3: Forcing shutdown of remaining tasks", {
          forceTimeoutMs: this.forceTimeoutMs,
        });
        this.emit("shutdown:force");
        await this._forcePhase();
      } else {
        this.state = "cleanup";
        this.logger.info("Phase 3: All in-flight tasks drained successfully");
      }

      // Phase 4: Cleanup resources
      this.logger.info("Phase 4: Cleaning up resources");
      await this._cleanupResources();

      // Phase 5: Final summary
      this._summarizeShutdown();

      // Phase 6: Exit
      this.state = "exiting";
      this.logger.info("Graceful shutdown complete, exiting", {
        totalDurationMs: Date.now() - this.startTime,
        completedTasks: this.completedTasks.length,
        failedTasks: this.failedTasks.length,
        drainedTasks: this.drainedTasks.length,
        inFlightRemaining: Array.from(this.inFlightTasks.values()).filter(
          (t) => t.status === "in-flight"
        ).length,
      });

      process.exit(0);
    } catch (error) {
      this.logger.error("Error during graceful shutdown", {
        error: error.message,
        stack: error.stack,
      });
      process.exit(1);
    }
  }

  /**
   * Drain phase: Wait for in-flight operations to complete
   */
  async _drainPhase() {
    const startTime = Date.now();
    const startInFlightCount = this.inFlightTasks.size;

    return new Promise((resolve) => {
      const drainTimeout = setTimeout(() => {
        this.logger.warn("Drain phase timeout", {
          durationMs: Date.now() - startTime,
          remainingInFlight: this._getInFlightTasks().length,
        });
        resolve(false); // Drain incomplete
      }, this.drainTimeoutMs);

      // Check periodically if all tasks have been drained
      const checkInterval = setInterval(() => {
        const inFlightTasks = this._getInFlightTasks();

        if (inFlightTasks.length === 0) {
          clearTimeout(drainTimeout);
          clearInterval(checkInterval);

          const durationMs = Date.now() - startTime;
          this.logger.info("Drain phase complete", {
            durationMs,
            initialCount: startInFlightCount,
            completedCount: this.completedTasks.length,
            failedCount: this.failedTasks.length,
          });

          resolve(true); // Drain complete
        } else if (inFlightTasks.length % 5 === 0) {
          // Log progress every 5 tasks
          this.logger.debug("Drain in progress", {
            remainingInFlight: inFlightTasks.length,
            durationMs: Date.now() - startTime,
            taskIds: inFlightTasks.slice(0, 5),
          });
        }
      }, 100);
    });
  }

  /**
   * Force phase: Cancel remaining tasks after timeout
   */
  async _forcePhase() {
    const inFlightTasks = this._getInFlightTasks();

    this.logger.warn("Force phase: Cancelling remaining tasks", {
      count: inFlightTasks.length,
      taskIds: inFlightTasks,
    });

    inFlightTasks.forEach((taskId) => {
      const task = this.inFlightTasks.get(taskId);
      if (task) {
        task.status = "forced-cancelled";
        this.drainedTasks.push(taskId);
      }
    });

    // Wait for force timeout to allow graceful cancellation
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        const remaining = this._getInFlightTasks();
        if (remaining.length > 0) {
          this.logger.error("Force phase timeout: Tasks still in-flight", {
            count: remaining.length,
            taskIds: remaining,
          });
        }
        resolve();
      }, Math.min(5000, this.forceTimeoutMs / 4)); // Shorter force phase timeout
    });
  }

  /**
   * Clean up registered resources
   */
  async _cleanupResources() {
    const startTime = Date.now();

    for (const resource of this.resources) {
      try {
        this.logger.info("Cleaning up resource", { name: resource.name });
        await Promise.race([
          resource.cleanupFn(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Cleanup timeout")),
              5000
            )
          ),
        ]);
        resource.cleaned = true;
        this.logger.debug("Resource cleaned", {
          name: resource.name,
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        resource.error = error.message;
        this.logger.error("Error cleaning up resource", {
          name: resource.name,
          error: error.message,
        });
      }
    }

    const cleanupDurationMs = Date.now() - startTime;
    const cleanedCount = this.resources.filter((r) => r.cleaned).length;
    this.logger.info("Resource cleanup complete", {
      cleanupDurationMs,
      cleanedCount,
      totalResources: this.resources.length,
    });
  }

  /**
   * Summarize shutdown for logs
   */
  _summarizeShutdown() {
    const totalDurationMs = Date.now() - this.startTime;

    const summary = {
      signal: this.shutdownSignal,
      reason: this.shutdownReason,
      totalDurationMs,
      timestamp: new Date().toISOString(),
      tasks: {
        completed: this.completedTasks.length,
        failed: this.failedTasks.length,
        drained: this.drainedTasks.length,
        inFlightAtEnd: this._getInFlightTasks().length,
      },
      resources: {
        registered: this.resources.length,
        cleaned: this.resources.filter((r) => r.cleaned).length,
        errored: this.resources.filter((r) => r.error).length,
      },
    };

    this.logger.info("=== GRACEFUL SHUTDOWN SUMMARY ===", summary);

    if (this.failedTasks.length > 0) {
      this.logger.warn("Failed tasks during shutdown", {
        count: this.failedTasks.length,
        taskIds: this.failedTasks,
      });
    }

    if (summary.tasks.inFlightAtEnd > 0) {
      this.logger.error("Tasks still in-flight at shutdown end", {
        count: summary.tasks.inFlightAtEnd,
        taskIds: this._getInFlightTasks(),
      });
    }

    if (summary.resources.errored > 0) {
      this.logger.error("Resource cleanup errors", {
        count: summary.resources.errored,
        resources: this.resources
          .filter((r) => r.error)
          .map((r) => ({ name: r.name, error: r.error })),
      });
    }
  }

  /**
   * Get list of in-flight tasks
   */
  _getInFlightTasks() {
    return Array.from(this.inFlightTasks.entries())
      .filter(([_, task]) => task.status === "in-flight")
      .map(([taskId, _]) => taskId);
  }

  /**
   * Get shutdown state snapshot
   */
  getStateSnapshot() {
    return {
      state: this.state,
      shutdownSignal: this.shutdownSignal,
      shutdownReason: this.shutdownReason,
      startTime: this.startTime,
      durationMs: this.startTime ? Date.now() - this.startTime : null,
      inFlight: {
        count: this._getInFlightTasks().length,
        taskIds: this._getInFlightTasks(),
      },
      completed: {
        count: this.completedTasks.length,
        taskIds: this.completedTasks,
      },
      failed: {
        count: this.failedTasks.length,
        taskIds: this.failedTasks,
      },
      drained: {
        count: this.drainedTasks.length,
        taskIds: this.drainedTasks,
      },
      resources: {
        total: this.resources.length,
        cleaned: this.resources.filter((r) => r.cleaned).length,
        withErrors: this.resources.filter((r) => r.error).length,
      },
    };
  }

  /**
   * Clean up signal handlers on destruction
   */
  destroy() {
    this.signalHandlers.forEach((handler, signal) => {
      process.removeListener(signal, handler);
    });
    this.logger.info("GracefulShutdownManager destroyed");
  }
}

module.exports = { GracefulShutdownManager };
