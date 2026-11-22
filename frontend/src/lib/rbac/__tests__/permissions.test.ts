import { hasPermission, UserRole } from "../permissions";

describe("Role-Based Access Control (RBAC)", () => {
  it("grants OWNER full permissions", () => {
    expect(hasPermission("OWNER", "TASK_DELETE")).toBe(true);
    expect(hasPermission("OWNER", "SETTINGS_MANAGE")).toBe(true);
    expect(hasPermission("OWNER", "TASK_EXECUTE")).toBe(true);
  });

  it("restricts OPERATOR from destructive actions", () => {
    expect(hasPermission("OPERATOR", "TASK_CREATE")).toBe(true);
    expect(hasPermission("OPERATOR", "TASK_EXECUTE")).toBe(true);
    expect(hasPermission("OPERATOR", "TASK_DELETE")).toBe(false);
    expect(hasPermission("OPERATOR", "SETTINGS_MANAGE")).toBe(false);
  });

  it("enforces read-only access for AUDITOR", () => {
    expect(hasPermission("AUDITOR", "TASK_VIEW")).toBe(true);
    expect(hasPermission("AUDITOR", "TASK_CREATE")).toBe(false);
    expect(hasPermission("AUDITOR", "TASK_EXECUTE")).toBe(false);
    expect(hasPermission("AUDITOR", "TASK_DELETE")).toBe(false);
  });
});
