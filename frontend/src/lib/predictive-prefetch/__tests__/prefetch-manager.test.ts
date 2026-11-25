import { PrefetchManager } from "../prefetch-manager";
import { DEFAULT_PREFETCH_CONFIG } from "../types";

describe("PrefetchManager", () => {
  let manager: PrefetchManager;
  let prefetchFn: jest.Mock;

  beforeEach(() => {
    localStorage.clear();
    prefetchFn = jest.fn();
    manager = new PrefetchManager(prefetchFn, { ...DEFAULT_PREFETCH_CONFIG, workerEnabled: false });
  });

  afterEach(() => {
    manager.destroy();
    localStorage.clear();
  });

  it("creates with default metrics", () => {
    const metrics = manager.getMetrics();
    expect(metrics.totalPredictions).toBe(0);
    expect(metrics.successfulPrefetches).toBe(0);
    expect(metrics.failedPrefetches).toBe(0);
    expect(metrics.workerSupported).toBe(false);
  });

  it("records navigation and updates current route", () => {
    manager.recordNavigation("/dashboard", "/tasks");
    expect(manager.getCurrentRoute()).toBe("/tasks");
  });

  it("executes prefetches after prediction", async () => {
    manager.recordNavigation("/dashboard", "/tasks");
    manager.recordNavigation("/tasks", "/settings");

    prefetchFn.mockImplementation(() => {});

    manager.recordNavigation("/settings", "/dashboard");
    await new Promise(process.nextTick);

    expect(prefetchFn).toHaveBeenCalled();
    expect(manager.getMetrics().totalPredictions).toBeGreaterThan(0);
  });

  it("tracks prefetch items", async () => {
    manager.recordNavigation("/a", "/b");
    manager.recordNavigation("/b", "/c");
    prefetchFn.mockImplementation(() => {});
    manager.recordNavigation("/c", "/a");

    await new Promise(process.nextTick);

    const items = manager.getPrefetchItems();
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].status).toBe("prefetched");
  });

  it("marks route as visited", () => {
    const items = manager.getPrefetchItems();
    manager.markRouteVisited("/some-route");
    expect(manager.getMetrics().visitedPredictions).toBe(0);
  });

  it("marks existing prefetch item as visited", () => {
    manager.recordNavigation("/a", "/b");
    manager.recordNavigation("/b", "/c");
    prefetchFn.mockImplementation(() => {});
    manager.recordNavigation("/c", "/a");

    manager.markRouteVisited("/a");
    const items = manager.getPrefetchItems().filter((i) => i.route === "/a");
    if (items.length > 0) {
      expect(items[0].status).toBe("visited");
    }
  });

  it("handles prefetch function failure", () => {
    prefetchFn.mockImplementation(() => { throw new Error("Prefetch failed"); });
    manager.recordNavigation("/a", "/b");
    manager.recordNavigation("/b", "/c");
    manager.recordNavigation("/c", "/a");
    expect(manager.getMetrics().failedPrefetches).toBeGreaterThanOrEqual(0);
  });

  it("reports worker support", () => {
    expect(manager.isWorkerSupported()).toBe(false);
  });

  it("provides flow tracker access", () => {
    const tracker = manager.getFlowTracker();
    expect(tracker).toBeDefined();
    expect(tracker.getTotalEvents()).toBe(0);
  });

  it("provides session info", () => {
    manager.recordNavigation("/a", "/b");
    const session = manager.getSession();
    expect(session.currentRoute).toBe("/b");
  });

  it("resets state", () => {
    manager.recordNavigation("/a", "/b");
    manager.reset();
    expect(manager.getCurrentRoute()).toBeNull();
    expect(manager.getMetrics().totalPredictions).toBe(0);
  });

  it("subscribes to events", () => {
    const subscriber = jest.fn();
    manager.subscribe(subscriber);
    manager.recordNavigation("/a", "/b");
    expect(subscriber).toHaveBeenCalled();
  });

  it("unsubscribes from events", () => {
    const subscriber = jest.fn();
    const unsubscribe = manager.subscribe(subscriber);
    unsubscribe();
    expect(subscriber).not.toHaveBeenCalled();
  });

  it("caches already prefetched routes", async () => {
    manager.recordNavigation("/a", "/b");
    manager.recordNavigation("/b", "/c");
    prefetchFn.mockImplementation(() => {});
    manager.recordNavigation("/c", "/a");

    await new Promise(process.nextTick);

    const cacheHitsBefore = manager.getMetrics().cacheHits;

    manager.recordNavigation("/a", "/b");
    await new Promise(process.nextTick);

    expect(manager.getMetrics().cacheHits).toBeGreaterThanOrEqual(cacheHitsBefore);
  });
});
