import { createRbacAuditLog, getRbacAuditLog, resetRbacAuditLog } from "../auditLog";

const T0 = 1_700_000_000_000;

/** Deterministic log: fixed clock, sequential ids. */
function makeLog(maxEntries = 10) {
  let tick = 0;
  let ids = 0;
  return createRbacAuditLog({
    maxEntries,
    now: () => T0 + tick++ * 1000,
    generateId: () => `id-${ids++}`,
  });
}

describe("rbac audit log", () => {
  it("records the acting user id", () => {
    const log = makeLog();
    log.record({ userId: "u-op", action: "create", allowed: true, reason: "role_grant" });
    expect(log.list()[0].userId).toBe("u-op");
  });

  it("records denied attempts as well as allowed ones", () => {
    const log = makeLog();
    log.record({ userId: "u-op", action: "delete", allowed: false, reason: "missing_permission" });
    log.record({ userId: "u-op", action: "create", allowed: true, reason: "role_grant" });
    expect(log.list().filter((e) => !e.allowed)).toHaveLength(1);
  });

  it("returns entries newest first", () => {
    const log = makeLog();
    log.record({ userId: "a", action: "first", allowed: true, reason: "role_grant" });
    log.record({ userId: "b", action: "second", allowed: true, reason: "role_grant" });
    expect(log.list().map((e) => e.action)).toEqual(["second", "first"]);
  });

  it("filters by user", () => {
    const log = makeLog();
    log.record({ userId: "u-op", action: "a", allowed: true, reason: "role_grant" });
    log.record({ userId: "u-aud", action: "b", allowed: true, reason: "role_grant" });
    log.record({ userId: "u-op", action: "c", allowed: true, reason: "role_grant" });
    expect(log.entriesFor("u-op")).toHaveLength(2);
    expect(log.entriesFor("nobody")).toHaveLength(0);
  });

  it("drops the oldest entries past the cap", () => {
    const log = makeLog(3);
    log.record({ userId: "a", action: "1", allowed: true, reason: "role_grant" });
    log.record({ userId: "a", action: "2", allowed: true, reason: "role_grant" });
    log.record({ userId: "a", action: "3", allowed: true, reason: "role_grant" });
    log.record({ userId: "a", action: "4", allowed: true, reason: "role_grant" });

    expect(log.size()).toBe(3);
    expect(log.list().map((e) => e.action)).not.toContain("1");
  });

  it("stamps entries with an ISO timestamp", () => {
    const log = makeLog();
    const entry = log.record({ userId: "a", action: "x", allowed: true, reason: "role_grant" });
    expect(entry.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("keeps the optional context fields", () => {
    const log = makeLog();
    log.record({
      userId: "u-op",
      userName: "Omar",
      action: "delete",
      permission: "tasks:delete",
      allowed: false,
      reason: "missing_permission",
      target: "task-42",
    });
    const [entry] = log.list();
    expect(entry.userName).toBe("Omar");
    expect(entry.permission).toBe("tasks:delete");
    expect(entry.target).toBe("task-42");
  });

  it("clears on request", () => {
    const log = makeLog();
    log.record({ userId: "a", action: "x", allowed: true, reason: "role_grant" });
    log.clear();
    expect(log.size()).toBe(0);
  });
});

describe("getRbacAuditLog", () => {
  afterEach(() => {
    resetRbacAuditLog();
  });

  it("returns the same instance until reset", () => {
    expect(getRbacAuditLog()).toBe(getRbacAuditLog());
  });

  it("returns a fresh instance after reset", () => {
    const first = getRbacAuditLog();
    resetRbacAuditLog();
    expect(getRbacAuditLog()).not.toBe(first);
  });
});
