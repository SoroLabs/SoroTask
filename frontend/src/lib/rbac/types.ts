import type { Permission, UserRole } from "@/types/auth";

export type RbacConnectionState = "online" | "offline" | "degraded";

export type RbacPolicy = {
  role: UserRole;
  permissions: Permission[];
  inherits?: UserRole[];
};

/**
 * Team roles for a shared treasury workspace (issue #1244).
 *
 * Deliberately separate from the app-level `UserRole`: an instance admin can
 * still be an Auditor inside one workspace, so collapsing the two would let
 * someone escalate by switching context.
 */
export type TeamRole = "owner" | "operator" | "auditor";

export type TeamMember = {
  id: string;
  name: string;
  role: TeamRole;
  /** Address used to verify delegated signatures. */
  address: string;
};

export type Team = {
  id: string;
  name: string;
  members: TeamMember[];
};

/** Why an action was allowed or denied — surfaced in the audit log. */
export type RbacDecisionReason =
  | "role_grant"
  | "delegation_grant"
  | "missing_permission"
  | "expired_delegation"
  | "revoked_delegation"
  | "not_a_member"
  | "insufficient_role";

export type RbacEvaluationContext = {
  userPermissions: Permission[];
  userRole: UserRole;
  policies?: RbacPolicy[];
  connectionState?: RbacConnectionState;
  cachedPermissions?: Permission[];
};

export type RbacEvaluationResult = {
  allowed: boolean;
  missingPermissions: Permission[];
  usedCache: boolean;
  connectionState: RbacConnectionState;
};

export type RbacEngineOptions = {
  defaultPolicies?: RbacPolicy[];
  offlineGracePeriodMs?: number;
};

export const DEFAULT_RBAC_POLICIES: RbacPolicy[] = [
  {
    role: "admin",
    permissions: [
      "tasks:create",
      "tasks:read",
      "tasks:update",
      "tasks:delete",
      "tasks:execute",
      "tasks:pause",
      "tasks:resume",
      "admin:users",
      "admin:settings",
      "admin:system",
    ],
  },
  {
    role: "user",
    permissions: [
      "tasks:create",
      "tasks:read",
      "tasks:update",
      "tasks:delete",
      "tasks:execute",
      "tasks:pause",
      "tasks:resume",
    ],
  },
  {
    role: "viewer",
    permissions: ["tasks:read"],
  },
];

export const RBAC_EVENT_NAME = "sorotask:rbac-state-change";

/**
 * Permissions granted by each team role (issue #1244).
 *
 * The split encodes the issue's core complaint: a junior engineer must not be
 * able to delete a critical task. Operators can run and reschedule work but
 * not destroy it; only the owner can, and only the owner can change roles.
 */
export const TEAM_ROLE_PERMISSIONS: Record<TeamRole, Permission[]> = {
  owner: [
    "tasks:create",
    "tasks:read",
    "tasks:update",
    "tasks:delete",
    "tasks:execute",
    "tasks:pause",
    "tasks:resume",
    "team:manage",
    "team:invite",
    "team:delegate",
    "audit:view",
  ],
  operator: [
    "tasks:create",
    "tasks:read",
    "tasks:update",
    "tasks:execute",
    "tasks:pause",
    "tasks:resume",
    "audit:view",
  ],
  // Read-only: an auditor can inspect the audit trail and the task list and
  // nothing else. No execute, no write, no delete.
  auditor: ["tasks:read", "audit:view"],
};

/** Permissions that only a workspace owner may exercise. */
export const OWNER_ONLY_PERMISSIONS: Permission[] = [
  "tasks:delete",
  "team:manage",
  "team:invite",
  "team:delegate",
];

/** Human-readable role labels for badges and tooltips. */
export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  owner: "Owner",
  operator: "Operator",
  auditor: "Auditor",
};

/** One-line explanation of what each role can do, shown in the team UI. */
export const TEAM_ROLE_DESCRIPTIONS: Record<TeamRole, string> = {
  owner: "Full control, including deleting tasks and managing team members.",
  operator: "Can create, run, pause and reschedule tasks. Cannot delete them.",
  auditor: "Read-only. Can view tasks and the audit trail but change nothing.",
};

/**
 * A time-bound grant of specific permissions from one member to another
 * (issue #1244, "time-bound signature delegation").
 *
 * The delegatee never holds the permission directly — it is only in force
 * while `now` sits inside `[issuedAt, expiresAt)` and the grant has not been
 * revoked, so a delegation cannot silently become permanent.
 */
export type PermissionDelegation = {
  id: string;
  /** Member who granted the permissions. Must be an owner. */
  delegatorId: string;
  /** Member who received them. */
  delegateeId: string;
  permissions: Permission[];
  /** Epoch milliseconds. */
  issuedAt: number;
  /** Epoch milliseconds. Must be after `issuedAt`. */
  expiresAt: number;
  /** Signature over the canonical grant payload, hex. */
  signature: string;
  revoked?: boolean;
};

/** Canonical string that a delegation signature covers. */
export function canonicalizeDelegation(
  delegation: Omit<PermissionDelegation, "signature">,
): string {
  // Permissions are sorted so the signature does not depend on the order the
  // caller happened to list them in.
  const permissions = [...delegation.permissions].sort().join(",");
  return [
    delegation.id,
    delegation.delegatorId,
    delegation.delegateeId,
    permissions,
    String(delegation.issuedAt),
    String(delegation.expiresAt),
  ].join("|");
}

export type RbacStateChangeEvent = {
  connectionState: RbacConnectionState;
  timestamp: string;
  error?: string;
};
