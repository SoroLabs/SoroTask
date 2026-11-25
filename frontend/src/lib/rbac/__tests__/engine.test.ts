import { createRbacEngine, getRbacEngine, resetRbacEngine } from "../engine";
import { DEFAULT_RBAC_POLICIES } from "../types";
import type { Permission } from "@/types/auth";

describe("rbac engine", () => {
  beforeEach(() => {
    resetRbacEngine();
  });

  afterEach(() => {
    resetRbacEngine();
  });

  it("evaluates permissions for admin role", () => {
    const engine = createRbacEngine();

    const result = engine.evaluate(["tasks:read", "admin:users"], {
      userPermissions: [],
      userRole: "admin",
    });

    expect(result.allowed).toBe(true);
    expect(result.missingPermissions).toHaveLength(0);
  });

  it("denies missing permissions for viewer role", () => {
    const engine = createRbacEngine();

    const result = engine.evaluate(["tasks:create"], {
      userPermissions: [],
      userRole: "viewer",
    });

    expect(result.allowed).toBe(false);
    expect(result.missingPermissions).toContain("tasks:create");
  });

  it("supports requireAny evaluation", () => {
    const engine = createRbacEngine();

    const result = engine.evaluate(
      ["tasks:create", "tasks:read"],
      { userPermissions: [], userRole: "viewer" },
      false,
    );

    expect(result.allowed).toBe(true);
  });

  it("uses cached permissions when offline", () => {
    const engine = createRbacEngine();
    engine.setConnectionState("offline");

    const cached: Permission[] = ["tasks:read", "tasks:create"];
    const result = engine.evaluate(["tasks:read"], {
      userPermissions: [],
      userRole: "viewer",
      cachedPermissions: cached,
      connectionState: "offline",
    });

    expect(result.allowed).toBe(true);
    expect(result.usedCache).toBe(true);
  });

  it("returns default policies", () => {
    const engine = createRbacEngine();
    expect(engine.getPolicies()).toEqual(DEFAULT_RBAC_POLICIES);
  });

  it("reuses singleton engine", () => {
    const first = getRbacEngine();
    const second = getRbacEngine();
    expect(first).toBe(second);
  });
});
