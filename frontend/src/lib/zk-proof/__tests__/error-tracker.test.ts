import { ErrorTracker } from "../error-tracker";

describe("ErrorTracker", () => {
  let tracker: ErrorTracker;

  beforeEach(() => {
    tracker = new ErrorTracker({ maxErrors: 10 });
  });

  it("starts with no errors", () => {
    expect(tracker.getErrorCount()).toBe(0);
    expect(tracker.getErrors()).toHaveLength(0);
  });

  it("tracks a new error", () => {
    const error = tracker.track(
      "Test error message",
      "generation",
      "Fix your inputs",
    );

    expect(error.msg).toBe("Test error message");
    expect(error.phase).toBe("generation");
    expect(error.remediation).toBe("Fix your inputs");
    expect(error.id).toBeDefined();
    expect(error.time).toBeDefined();
    expect(tracker.getErrorCount()).toBe(1);
  });

  it("tracks errors from Error objects", () => {
    const err = new Error("Something went wrong");
    const error = tracker.trackFromError(err, "verification", "Check contract");

    expect(error.msg).toBe("Something went wrong");
    expect(error.phase).toBe("verification");
    expect(tracker.getErrorCount()).toBe(1);
  });

  it("filters errors by phase", () => {
    tracker.track("Gen error", "generation", "Fix gen");
    tracker.track("Ver error", "verification", "Fix ver");
    tracker.track("Net error", "network", "Fix net");

    expect(tracker.getErrorsByPhase("generation")).toHaveLength(1);
    expect(tracker.getErrorsByPhase("verification")).toHaveLength(1);
    expect(tracker.getErrorsByPhase("network")).toHaveLength(1);
  });

  it("limits max errors and shifts oldest", () => {
    const smallTracker = new ErrorTracker({ maxErrors: 3 });
    smallTracker.track("Error 1", "generation", "Fix 1");
    smallTracker.track("Error 2", "generation", "Fix 2");
    smallTracker.track("Error 3", "generation", "Fix 3");
    smallTracker.track("Error 4", "generation", "Fix 4");

    expect(smallTracker.getErrorCount()).toBe(3);
    expect(smallTracker.getErrors()[0].msg).toBe("Error 4");
  });

  it("calls onError callback when tracking", () => {
    const onError = jest.fn();
    const callbackTracker = new ErrorTracker({
      maxErrors: 10,
      onError,
    });

    callbackTracker.track("Test", "generation", "Fix");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "Test" }),
    );
  });

  it("calls onErrorLimitReached when limit exceeded", () => {
    const onErrorLimitReached = jest.fn();
    const limitTracker = new ErrorTracker({
      maxErrors: 1,
      onErrorLimitReached,
    });

    limitTracker.track("Error 1", "generation", "Fix 1");
    limitTracker.track("Error 2", "generation", "Fix 2");
    expect(onErrorLimitReached).toHaveBeenCalledTimes(1);
  });

  it("clears all errors", () => {
    tracker.track("Error 1", "generation", "Fix 1");
    tracker.track("Error 2", "verification", "Fix 2");
    expect(tracker.getErrorCount()).toBe(2);

    tracker.clear();
    expect(tracker.getErrorCount()).toBe(0);
  });

  it("generates report with correct structure", () => {
    tracker.track("Gen error", "generation", "Fix gen");
    tracker.track("Ver error", "verification", "Fix ver");

    const report = tracker.generateReport();
    expect(report).toHaveProperty("timestamp");
    expect(report).toHaveProperty("totalErrors", 2);
    expect(report).toHaveProperty("errorsByPhase");
    expect((report as any).errorsByPhase.generation).toBe(1);
    expect((report as any).errorsByPhase.verification).toBe(1);
    expect((report as any).errorsByPhase.network).toBe(0);
    expect((report as any).errors).toHaveLength(2);
  });

  it("generates unique error IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const error = tracker.track(
        `Error ${i}`,
        "generation",
        "Fix it",
      );
      ids.add(error.id);
    }
    expect(ids.size).toBe(100);
  });

  it("prepends new errors to the front", () => {
    tracker.track("First", "generation", "Fix");
    tracker.track("Second", "generation", "Fix");

    expect(tracker.getErrors()[0].msg).toBe("Second");
    expect(tracker.getErrors()[1].msg).toBe("First");
  });

  it("tracks multiple phases simultaneously", () => {
    for (let i = 0; i < 3; i++) {
      tracker.track(`Gen ${i}`, "generation", "Fix");
      tracker.track(`Ver ${i}`, "verification", "Fix");
      tracker.track(`Net ${i}`, "network", "Fix");
    }

    expect(tracker.getErrorCount()).toBe(9);
    expect(tracker.getErrorsByPhase("generation")).toHaveLength(3);
    expect(tracker.getErrorsByPhase("verification")).toHaveLength(3);
    expect(tracker.getErrorsByPhase("network")).toHaveLength(3);
  });
});
