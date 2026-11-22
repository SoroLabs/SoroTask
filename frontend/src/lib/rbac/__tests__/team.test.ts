import {
  checkTeamPermission,
  checkTeamPermissions,
  denialExplanation,
  effectiveTeamPermissions,
  isDelegationActive,
} from "../team";
import {
  canonicalizeDelegation,
  TEAM_ROLE_PERMISSIONS,
  type PermissionDelegation,
  type Team,
} from "../types";
import type { Permission } from "@/types/auth";

const T0 = 1_700_000_000_000;

const team: Team = {
  id: "team-1",
  name: "Treasury",
  members: [
    { id: "u-owner", name: "Ada", role: "owner", address: "GOWNER" },
    { id: "u-op", name: "Omar", role: "operator", address: "GOP" },
    { id: "u-aud", name: "Ava", role: "auditor", address: "GAUD" },
  ],
};

const grant = (overrides: Partial<PermissionDelegation> = {}): PermissionDelegation => ({
  id: "d-1",
  delegatorId: "u-owner",
  delegateeId: "u-op",
  permissions: ["tasks:delete"],
  issuedAt: T0,
  expiresAt: T0 + 3_600_000,
  signature: "sig",
  ...overrides,
});

describe("team role permissions", () => {
  it("lets an owner delete a task", () => {
    expect(checkTeamPermission(team, "u-owner", "tasks:delete", { now: T0 }).allowed).toBe(true);
  });

  it("stops an operator deleting a task", () => {
    expect(checkTeamPermission(team, "u-op", "tasks:delete", { now: T0 }).allowed).toBe(false);
  });

  it("lets an operator run a task", () => {
    expect(checkTeamPermission(team, "u-op", "tasks:execute", { now: T0 }).allowed).toBe(true);
  });

  it("keeps an auditor read-only", () => {
    expect(checkTeamPermission(team, "u-aud", "tasks:read", { now: T0 }).allowed).toBe(true);
    expect(checkTeamPermission(team, "u-aud", "tasks:execute", { now: T0 }).allowed).toBe(false);
    expect(checkTeamPermission(team, "u-aud", "tasks:update", { now: T0 }).allowed).toBe(false);
    expect(checkTeamPermission(team, "u-aud", "tasks:delete", { now: T0 }).allowed).toBe(false);
  });

  it("reserves team management for the owner", () => {
    expect(TEAM_ROLE_PERMISSIONS.owner).toContain("team:manage");
    expect(TEAM_ROLE_PERMISSIONS.operator).not.toContain("team:manage");
    expect(TEAM_ROLE_PERMISSIONS.auditor).not.toContain("team:manage");
    expect(checkTeamPermission(team, "u-op", "team:manage", { now: T0 }).allowed).toBe(false);
  });

  it("denies a non-member", () => {
    const decision = checkTeamPermission(team, "ghost", "tasks:read", { now: T0 });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("not_a_member");
  });
});

describe("denial explanations", () => {
  it("names the Owner and the current role for owner-only actions", () => {
    const { explanation } = checkTeamPermission(team, "u-op", "tasks:delete", { now: T0 });
    expect(explanation).toMatch(/Only the workspace Owner/);
    expect(explanation).toMatch(/Operator/);
  });

  it("explains a generic missing permission in terms of the role", () => {
    const { explanation } = checkTeamPermission(team, "u-aud", "tasks:execute", { now: T0 });
    expect(explanation).toMatch(/Auditor/);
    expect(explanation).toMatch(/missing the permission/);
  });

  it("uses plural wording for several missing permissions", () => {
    expect(denialExplanation("auditor", ["tasks:execute", "tasks:update"])).toMatch(
      /missing the permissions/,
    );
  });

  it("explains a non-member", () => {
    expect(denialExplanation(undefined, ["tasks:read"])).toMatch(/not a member/);
  });
});

describe("delegation validity window", () => {
  it("is active at issue time", () => {
    expect(isDelegationActive(grant(), T0)).toBe(true);
  });

  it("is active before expiry", () => {
    expect(isDelegationActive(grant(), T0 + 1000)).toBe(true);
  });

  it("expires exactly at the boundary", () => {
    expect(isDelegationActive(grant(), T0 + 3_600_000)).toBe(false);
  });

  it("is not active before it is issued", () => {
    expect(isDelegationActive(grant(), T0 - 1)).toBe(false);
  });

  it("is inactive once revoked", () => {
    expect(isDelegationActive(grant({ revoked: true }), T0 + 1000)).toBe(false);
  });
});

describe("delegated permissions", () => {
  it("grants what the owner delegated", () => {
    const decision = checkTeamPermission(team, "u-op", "tasks:delete", {
      delegations: [grant()],
      now: T0 + 60_000,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("delegation_grant");
    expect(decision.viaDelegationId).toBe("d-1");
    expect(decision.explanation).toMatch(/Ada/);
  });

  it("refuses an expired delegation and says so", () => {
    const decision = checkTeamPermission(team, "u-op", "tasks:delete", {
      delegations: [grant()],
      now: T0 + 3_600_001,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("expired_delegation");
    expect(decision.explanation).toMatch(/expired/);
  });

  it("refuses a revoked delegation", () => {
    expect(
      checkTeamPermission(team, "u-op", "tasks:delete", {
        delegations: [grant({ revoked: true })],
        now: T0 + 1000,
      }).allowed,
    ).toBe(false);
  });

  it("ignores a delegation from someone who lacks the permission", () => {
    expect(
      checkTeamPermission(team, "u-op", "tasks:delete", {
        delegations: [grant({ delegatorId: "u-aud" })],
        now: T0 + 1000,
      }).allowed,
    ).toBe(false);
  });

  it("ignores a delegation from an unknown member", () => {
    expect(
      checkTeamPermission(team, "u-op", "tasks:delete", {
        delegations: [grant({ delegatorId: "ghost" })],
        now: T0 + 1000,
      }).allowed,
    ).toBe(false);
  });

  it("rejects a delegation whose signature does not verify", () => {
    expect(
      checkTeamPermission(team, "u-op", "tasks:delete", {
        delegations: [grant()],
        verifySignature: () => false,
        now: T0 + 1000,
      }).allowed,
    ).toBe(false);
  });

  it("does not extend the delegation to other permissions", () => {
    expect(
      checkTeamPermission(team, "u-op", "team:manage", {
        delegations: [grant()],
        now: T0 + 1000,
      }).allowed,
    ).toBe(false);
  });
});


describe("effectiveTeamPermissions", () => {
  it("excludes delete for an operator without a grant", () => {
    const perms = effectiveTeamPermissions(team, "u-op", { now: T0 });
    expect(perms).toContain("tasks:execute");
    expect(perms).not.toContain("tasks:delete");
  });

  it("includes a delegated permission while it is live", () => {
    expect(
      effectiveTeamPermissions(team, "u-op", { delegations: [grant()], now: T0 + 1000 }),
    ).toContain("tasks:delete");
  });

  it("drops it once expired", () => {
    expect(
      effectiveTeamPermissions(team, "u-op", {
        delegations: [grant()],
        now: T0 + 7_200_000,
      }),
    ).not.toContain("tasks:delete");
  });

  it("returns nothing for a non-member", () => {
    expect(effectiveTeamPermissions(team, "ghost", { now: T0 })).toEqual([]);
  });

  it("gives an auditor exactly read and audit access", () => {
    expect(effectiveTeamPermissions(team, "u-aud", { now: T0 }).sort()).toEqual([
      "audit:view",
      "tasks:read",
    ]);
  });
});

describe("checkTeamPermissions", () => {
  it("reports the first missing permission", () => {
    const decision = checkTeamPermissions(team, "u-op", ["tasks:read", "tasks:delete"], {
      now: T0,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.missingPermissions).toEqual(["tasks:delete"]);
  });

  it("allows when every permission is held", () => {
    expect(
      checkTeamPermissions(team, "u-op", ["tasks:read", "tasks:execute"], { now: T0 }).allowed,
    ).toBe(true);
  });
});

describe("canonicalizeDelegation", () => {
  const base = {
    id: "d-1",
    delegatorId: "u-owner",
    delegateeId: "u-op",
    permissions: ["tasks:delete", "tasks:read"] as Permission[],
    issuedAt: 1,
    expiresAt: 2,
  };

  it("is independent of permission order", () => {
    expect(canonicalizeDelegation(base)).toBe(
      canonicalizeDelegation({ ...base, permissions: ["tasks:read", "tasks:delete"] }),
    );
  });

  it("covers the delegation id", () => {
    expect(canonicalizeDelegation(base)).toContain("d-1");
  });

  it("covers the validity window", () => {
    expect(canonicalizeDelegation(base)).toMatch(/\|1\|2$/);
  });

  it("changes when the expiry changes", () => {
    expect(canonicalizeDelegation(base)).not.toBe(
      canonicalizeDelegation({ ...base, expiresAt: 3 }),
    );
  });

  it("changes when the delegatee changes", () => {
    expect(canonicalizeDelegation(base)).not.toBe(
      canonicalizeDelegation({ ...base, delegateeId: "u-aud" }),
    );
  });
});

