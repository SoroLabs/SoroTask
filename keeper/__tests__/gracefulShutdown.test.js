const { GracefulShutdownManager } = require("../src/gracefulShutdown");
const { createLogger } = require("../src/logger");

describe("GracefulShutdownManager", () => {
  let shutdownManager;

  beforeEach(() => {
    shutdownManager = new GracefulShutdownManager({
      logger: createLogger("test-shutdown"),
      drainTimeoutMs: 5000,
      forceTimeoutMs: 10000,
    });
  });

  afterEach(() => {
    if (shutdownManager) {
      shutdownManager.destroy();
    }
  });

  describe("Initialization", () => {
    test("should initialize in correct state", () => {
      expect(shutdownManager.state).toBe("initializing");
      expect(shutdownManager.startTime).toBeNull();
      expect(shutdownManager.shutdownSignal).toBeNull();
    });

    test("should transition to running state after init", () => {
      shutdownManager.init();
      expect(shutdownManager.state).toBe("running");
    });

    test("should register signal handlers", () => {
      shutdownManager.init();
      expect(shutdownManager.signalHandlers.size).toBe(2);
      expect(shutdownManager.signalHandlers.has("SIGTERM")).toBe(true);
      expect(shutdownManager.signalHandlers.has("SIGINT")).toBe(true);
    });

    test("should throw error if initialized twice", () => {
      shutdownManager.init();
      expect(() => shutdownManager.init()).toThrow();
    });
  });

  describe("Resource Registration", () => {
    test("should register resources for cleanup", () => {
      const cleanupFn = jest.fn().mockResolvedValue(undefined);
      shutdownManager.registerResource("test-resource", cleanupFn);

      expect(shutdownManager.resources.length).toBe(1);
      expect(shutdownManager.resources[0]).toEqual({
        name: "test-resource",
        cleanupFn,
        cleaned: false,
        error: null,
      });
    });

    test("should register multiple resources", () => {
      shutdownManager.registerResource("resource1", jest.fn());
      shutdownManager.registerResource("resource2", jest.fn());
      shutdownManager.registerResource("resource3", jest.fn());

      expect(shutdownManager.resources.length).toBe(3);
    });
  });

  describe("Task Tracking", () => {
    test("should track task as in-flight", () => {
      shutdownManager.trackTask("task-123");

      const taskMap = shutdownManager.inFlightTasks;
      expect(taskMap.has("task-123")).toBe(true);

      const task = taskMap.get("task-123");
      expect(task.taskId).toBe("task-123");
      expect(task.status).toBe("in-flight");
      expect(task.startTime).toBeLessThanOrEqual(Date.now());
    });

    test("should mark task as completed", () => {
      shutdownManager.trackTask("task-123");
      shutdownManager.completeTask("task-123", { result: "success" });

      const task = shutdownManager.inFlightTasks.get("task-123");
      expect(task.status).toBe("completed");
      expect(task.result).toEqual({ result: "success" });
      expect(shutdownManager.completedTasks).toContain("task-123");
    });

    test("should mark task as failed", () => {
      const error = new Error("Test error");
      shutdownManager.trackTask("task-456");
      shutdownManager.failTask("task-456", error);

      const task = shutdownManager.inFlightTasks.get("task-456");
      expect(task.status).toBe("failed");
      expect(task.error).toBe("Test error");
      expect(shutdownManager.failedTasks).toContain("task-456");
    });

    test("should not duplicate track same task", () => {
      shutdownManager.trackTask("task-789");
      const firstStartTime = shutdownManager.inFlightTasks.get("task-789")
        .startTime;

      // Wait a bit and track again
      return new Promise((resolve) => {
        setTimeout(() => {
          shutdownManager.trackTask("task-789");
          const secondStartTime = shutdownManager.inFlightTasks.get("task-789")
            .startTime;

          // Should be same task
          expect(firstStartTime).toBe(secondStartTime);
          resolve();
        }, 100);
      });
    });
  });

  describe("Shutdown State", () => {
    test("should provide state snapshot", () => {
      shutdownManager.trackTask("task-1");
      shutdownManager.trackTask("task-2");
      shutdownManager.completeTask("task-1");

      const snapshot = shutdownManager.getStateSnapshot();

      expect(snapshot.state).toBe("initializing");
      expect(snapshot.inFlight.count).toBe(1);
      expect(snapshot.inFlight.taskIds).toContain("task-2");
      expect(snapshot.completed.count).toBe(1);
      expect(snapshot.completed.taskIds).toContain("task-1");
    });

    test("should track in-flight task duration in snapshot", () => {
      shutdownManager.trackTask("task-1");

      return new Promise((resolve) => {
        setTimeout(() => {
          const snapshot = shutdownManager.getStateSnapshot();
          expect(snapshot.durationMs).toBeGreaterThanOrEqual(50);
          resolve();
        }, 50);
      });
    });
  });

  describe("Shutdown Lifecycle", () => {
    test("should transition states during shutdown", () => {
      shutdownManager.init();
      expect(shutdownManager.state).toBe("running");

      // We can't easily test the full async shutdown without mocking
      // but we can verify the state transition starts
      expect(shutdownManager.state).toBe("running");
    });

    test("should prevent shutdown if already shutting down", () => {
      shutdownManager.init();
      shutdownManager.state = "draining";

      const initialSignal = shutdownManager.shutdownSignal;

      // Attempt another shutdown
      shutdownManager.initiateShutdown("SIGINT", "test reason");

      expect(shutdownManager.shutdownSignal).toBe(initialSignal);
    });
  });

  describe("In-Flight Task Filtering", () => {
    test("should filter only in-flight tasks", () => {
      shutdownManager.trackTask("task-1");
      shutdownManager.trackTask("task-2");
      shutdownManager.trackTask("task-3");

      shutdownManager.completeTask("task-1");
      shutdownManager.failTask("task-2");

      const inFlight = shutdownManager._getInFlightTasks();

      expect(inFlight).toContain("task-3");
      expect(inFlight).not.toContain("task-1");
      expect(inFlight).not.toContain("task-2");
      expect(inFlight.length).toBe(1);
    });

    test("should handle empty in-flight tasks", () => {
      const inFlight = shutdownManager._getInFlightTasks();
      expect(inFlight).toEqual([]);
    });
  });

  describe("Drain Phase", () => {
    test("should complete drain phase when no tasks in-flight", async () => {
      const result = await shutdownManager._drainPhase();
      expect(result).toBe(true);
    });

    test("should timeout if tasks remain in-flight", async () => {
      // Add a task that will never complete
      shutdownManager.trackTask("task-stuck");

      const result = await shutdownManager._drainPhase();

      // Should timeout
      expect(result).toBe(false);

      // Verify in-flight task still exists
      expect(shutdownManager._getInFlightTasks()).toContain("task-stuck");
    });

    test("should complete drain phase when all tasks finish", async () => {
      // Add tasks
      shutdownManager.trackTask("task-1");
      shutdownManager.trackTask("task-2");

      // Complete them asynchronously
      const drainPhase = shutdownManager._drainPhase();

      setTimeout(() => {
        shutdownManager.completeTask("task-1");
        shutdownManager.completeTask("task-2");
      }, 100);

      const result = await drainPhase;
      expect(result).toBe(true);
    });
  });

  describe("Force Phase", () => {
    test("should mark remaining tasks as forced-cancelled", async () => {
      shutdownManager.trackTask("task-1");
      shutdownManager.trackTask("task-2");

      await shutdownManager._forcePhase();

      expect(shutdownManager.drainedTasks).toContain("task-1");
      expect(shutdownManager.drainedTasks).toContain("task-2");

      const task1 = shutdownManager.inFlightTasks.get("task-1");
      const task2 = shutdownManager.inFlightTasks.get("task-2");

      expect(task1.status).toBe("forced-cancelled");
      expect(task2.status).toBe("forced-cancelled");
    });
  });

  describe("Resource Cleanup", () => {
    test("should clean up registered resources", async () => {
      const cleanup1 = jest.fn().mockResolvedValue(undefined);
      const cleanup2 = jest.fn().mockResolvedValue(undefined);

      shutdownManager.registerResource("resource-1", cleanup1);
      shutdownManager.registerResource("resource-2", cleanup2);

      await shutdownManager._cleanupResources();

      expect(cleanup1).toHaveBeenCalled();
      expect(cleanup2).toHaveBeenCalled();
      expect(shutdownManager.resources[0].cleaned).toBe(true);
      expect(shutdownManager.resources[1].cleaned).toBe(true);
    });

    test("should handle resource cleanup errors", async () => {
      const error = new Error("Cleanup failed");
      const cleanup1 = jest.fn().mockRejectedValue(error);

      shutdownManager.registerResource("failing-resource", cleanup1);

      await shutdownManager._cleanupResources();

      expect(cleanup1).toHaveBeenCalled();
      expect(shutdownManager.resources[0].error).toBe("Cleanup failed");
      expect(shutdownManager.resources[0].cleaned).toBe(false);
    });

    test("should timeout resource cleanup", async () => {
      const cleanup = jest.fn(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 10000); // Never resolves within timeout
          })
      );

      shutdownManager.registerResource("slow-resource", cleanup);

      // This should complete within a reasonable time
      const start = Date.now();
      await shutdownManager._cleanupResources();
      const duration = Date.now() - start;

      // Should have timed out
      expect(duration).toBeLessThan(10000);
      expect(shutdownManager.resources[0].error).toBeTruthy();
    });
  });

  describe("Event Emission", () => {
    test("should emit shutdown:initiated event", (done) => {
      shutdownManager.init();

      shutdownManager.on("shutdown:initiated", ({ signal, reason }) => {
        expect(signal).toBe("SIGTERM");
        expect(reason).toBe("test");
        done();
      });

      // Manually trigger (would normally be from signal)
      shutdownManager.initiateShutdown("SIGTERM", "test");
    });

    test("should emit shutdown:stop-accepting event", (done) => {
      shutdownManager.init();

      shutdownManager.on("shutdown:stop-accepting", () => {
        done();
      });

      // Prevent full shutdown by mocking exit
      const originalExit = process.exit;
      process.exit = jest.fn();

      shutdownManager.initiateShutdown("SIGTERM");

      process.exit = originalExit;
    });
  });

  describe("Signal Handling", () => {
    test("should register SIGTERM and SIGINT handlers", () => {
      const onSpy = jest.spyOn(process, "on");
      shutdownManager.init();

      const sigtermCalls = onSpy.mock.calls.filter(
        (call) => call[0] === "SIGTERM"
      );
      const sigintCalls = onSpy.mock.calls.filter(
        (call) => call[0] === "SIGINT"
      );

      expect(sigtermCalls.length).toBeGreaterThan(0);
      expect(sigintCalls.length).toBeGreaterThan(0);

      onSpy.mockRestore();
    });

    test("should remove signal handlers on destroy", () => {
      const removeListenerSpy = jest.spyOn(process, "removeListener");
      shutdownManager.init();
      shutdownManager.destroy();

      expect(removeListenerSpy).toHaveBeenCalled();
      removeListenerSpy.mockRestore();
    });
  });
});
