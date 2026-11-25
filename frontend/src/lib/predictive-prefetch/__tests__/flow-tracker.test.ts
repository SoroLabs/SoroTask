import { FlowTracker } from "../flow-tracker";
import { DEFAULT_PREFETCH_CONFIG } from "../types";

describe("FlowTracker", () => {
  let tracker: FlowTracker;

  beforeEach(() => {
    localStorage.clear();
    tracker = new FlowTracker(DEFAULT_PREFETCH_CONFIG);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("starts with empty events", () => {
    expect(tracker.getEvents()).toEqual([]);
    expect(tracker.getTotalEvents()).toBe(0);
  });

  it("records a navigation event", () => {
    const event = tracker.recordNavigation("/dashboard", "/tasks");
    expect(event.from).toBe("/dashboard");
    expect(event.to).toBe("/tasks");
    expect(event.timestamp).toBeGreaterThan(0);
    expect(tracker.getTotalEvents()).toBe(1);
  });

  it("records navigation with null from", () => {
    const event = tracker.recordNavigation(null, "/dashboard");
    expect(event.from).toBeNull();
    expect(event.to).toBe("/dashboard");
  });

  it("updates session on navigation", () => {
    tracker.recordNavigation("/dashboard", "/tasks");
    const session = tracker.getSession();
    expect(session.currentRoute).toBe("/tasks");
    expect(session.events.length).toBe(1);
  });

  it("builds transition matrix from events", () => {
    tracker.recordNavigation("/dashboard", "/tasks");
    tracker.recordNavigation("/tasks", "/settings");
    tracker.recordNavigation("/dashboard", "/tasks");

    const matrix = tracker.getTransitionMatrix();
    expect(matrix["/dashboard"]["/tasks"]).toBe(2);
    expect(matrix["/tasks"]["/settings"]).toBe(1);
  });

  it("skips null from in transition matrix", () => {
    tracker.recordNavigation(null, "/dashboard");
    tracker.recordNavigation("/dashboard", "/tasks");

    const matrix = tracker.getTransitionMatrix();
    expect(matrix["__entry__"]).toBeUndefined();
    expect(matrix["/dashboard"]["/tasks"]).toBe(1);
  });

  it("returns sorted transitions", () => {
    tracker.recordNavigation("/a", "/b");
    tracker.recordNavigation("/a", "/b");
    tracker.recordNavigation("/a", "/c");

    const transitions = tracker.getTransitions();
    expect(transitions[0].from).toBe("/a");
    expect(transitions[0].to).toBe("/b");
    expect(transitions[0].count).toBe(2);
  });

  it("records page load", () => {
    tracker.recordPageLoad("/dashboard");
    expect(tracker.getCurrentRoute()).toBe("/dashboard");
  });

  it("resets events and session", () => {
    tracker.recordNavigation("/a", "/b");
    tracker.reset();
    expect(tracker.getEvents()).toEqual([]);
    expect(tracker.getTotalEvents()).toBe(0);
    expect(tracker.getCurrentRoute()).toBeNull();
  });

  it("resets session only", () => {
    tracker.recordNavigation("/a", "/b");
    tracker.resetSession();
    const session = tracker.getSession();
    expect(session.events).toEqual([]);
    expect(session.id).not.toBe("");
  });

  it("persists and loads events from localStorage", () => {
    const tracker1 = new FlowTracker(DEFAULT_PREFETCH_CONFIG);
    tracker1.recordNavigation("/a", "/b");
    tracker1.recordNavigation("/b", "/c");

    const tracker2 = new FlowTracker(DEFAULT_PREFETCH_CONFIG);
    expect(tracker2.getTotalEvents()).toBe(2);
    expect(tracker2.getEvents()[0].to).toBe("/b");
  });

  it("handles corrupted localStorage gracefully", () => {
    localStorage.setItem("sorotask.prefetch.v1.events", "invalid json");
    const tracker = new FlowTracker(DEFAULT_PREFETCH_CONFIG);
    expect(tracker.getEvents()).toEqual([]);
  });

  it("trims events beyond max history", () => {
    const config = { ...DEFAULT_PREFETCH_CONFIG, maxHistoryLength: 3 };
    const tracker = new FlowTracker(config);
    tracker.recordNavigation("/a", "/b");
    tracker.recordNavigation("/b", "/c");
    tracker.recordNavigation("/c", "/d");
    tracker.recordNavigation("/d", "/e");
    expect(tracker.getTotalEvents()).toBe(3);
    expect(tracker.getEvents()[0].to).toBe("/c");
  });

  it("excludes null-from events from transitions but includes in events", () => {
    tracker.recordNavigation(null, "/home");
    tracker.recordNavigation("/home", "/about");
    tracker.recordNavigation(null, "/home");
    expect(tracker.getTransitions().length).toBe(1);
    expect(tracker.getTransitions()[0].from).toBe("/home");
    expect(tracker.getTotalEvents()).toBe(3);
  });

  it("gets session events separately", () => {
    tracker.recordNavigation("/a", "/b");
    tracker.recordNavigation("/b", "/c");
    const sessionEvents = tracker.getSessionEvents();
    expect(sessionEvents.length).toBe(2);
    expect(sessionEvents[0].from).toBe("/a");
  });

  it("creates unique session ids", () => {
    const t1 = new FlowTracker(DEFAULT_PREFETCH_CONFIG);
    const t2 = new FlowTracker(DEFAULT_PREFETCH_CONFIG);
    expect(t1.getSession().id).not.toBe(t2.getSession().id);
  });
});
