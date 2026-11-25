import type { Permission } from "@/types/auth";
import {
  OWNER_ONLY_PERMISSIONS,
  TEAM_ROLE_DESCRIPTIONS,
  TEAM_ROLE_LABELS,
  TEAM_ROLE_PERMISSIONS,
  canonicalizeDelegation,
  type PermissionDelegation,
  type RbacDecisionReason,
  type Team,
  type TeamMember,
  type TeamRole,
} from "./types";

export type TeamActionDecision = {
  allowed: boolean;
  reason: RbacDecisionReason;
  /** User-facing sentence explaining the outcome; used as the tooltip. */
  explanation: string;
  /** The delegation that authorised the action, when one did. */
  viaDelegationId?: string;
  missingPermissions: Permission[];
};

/** Locate a member by id. */
export function findMember(team: Team, memberId: string): TeamMember | undefined {
  return team.members.find((member) => member.id === memberId);
}

/** True when `now` falls inside the delegation's validity window. */
export function isDelegationActive(delegation: PermissionDelegation, now: number): boolean {
  if (delegation.revoked) return false;
  // Half-open interval: a grant expires exactly at `expiresAt`, so back-to-back
  // delegations cannot both be live at the same instant.
  return delegation.issuedAt <= now && now < delegation.expiresAt;
}

/**
 * Build the sentence shown when an action is blocked.
 *
 * Kept separate from the decision logic so the wording can be asserted in tests
 * and reused by the tooltip in `PermissionGuard`.
 */
export function denialExplanation(
  role: TeamRole | undefined,
  missing: Permission[],
): string {
  const missingLabel = missing.length === 1 ? "permission" : "permissions";
  const list = missing.map((p) => `\`${p}\``).join(", ");

  if (!role) {
    return `You are not a member of this workspace, so ${list} cannot be granted.`;
  }
  if (missing.every((p) => OWNER_ONLY_PERMISSIONS.includes(p))) {
    return `Only the workspace Owner can ${list}. Your role is ${TEAM_ROLE_LABELS[role]} — ${TEAM_ROLE_DESCRIPTIONS[role]}`;
  }
  return `Your role (${TEAM_ROLE_LABELS[role]}) is missing the ${missingLabel} ${list}.`;
}

/**
 * Decide whether `memberId` may exercise `permission` in `team`.
 *
 * Resolution order:
 *  1. direct role grant,
 *  2. an active, signed delegation from a member who holds the permission,
 *  3. denial.
 *
 * Step 2's "holds it themselves" check matters: without it a compromised
 * auditor could sign their own way to `tasks:delete`.
 */
export function checkTeamPermission(
  team: Team,
  memberId: string,
  permission: Permission,
  options: {
    delegations?: PermissionDelegation[];
    now?: number;
    /** Verifies a delegation signature; defaults to trusting the record. */
    verifySignature?: (delegation: PermissionDelegation) => boolean;
  } = {},
): TeamActionDecision {
  const now = options.now ?? Date.now();
  const member = findMember(team, memberId);

  if (!member) {
    return {
      allowed: false,
      reason: "not_a_member",
      explanation: denialExplanation(undefined, [permission]),
      missingPermissions: [permission],
    };
  }

  if (TEAM_ROLE_PERMISSIONS[member.role].includes(permission)) {
    return {
      allowed: true,
      reason: "role_grant",
      explanation: `Granted by your ${TEAM_ROLE_LABELS[member.role]} role.`,
      missingPermissions: [],
    };
  }

  const delegation = (options.delegations ?? []).find((d) => {
    if (d.delegateeId !== memberId) return false;
    if (!d.permissions.includes(permission)) return false;
    if (!isDelegationActive(d, now)) return false;
    if (options.verifySignature && !options.verifySignature(d)) return false;

    const delegator = findMember(team, d.delegatorId);
    if (!delegator) return false;
    return d.permissions.every((p) => TEAM_ROLE_PERMISSIONS[delegator.role].includes(p));
  });

  if (delegation) {
    const delegator = findMember(team, delegation.delegatorId);
    return {
      allowed: true,
      reason: "delegation_grant",
      explanation: `Temporarily delegated by ${delegator?.name ?? delegation.delegatorId} until ${new Date(
        delegation.expiresAt,
      ).toLocaleString()}.`,
      viaDelegationId: delegation.id,
      missingPermissions: [],
    };
  }

  // Distinguish "expired" from "never had it", so a lapsed delegation is
  // explained rather than implying the user was never allowed.
  const lapsed = (options.delegations ?? []).find(
    (d) => d.delegateeId === memberId && d.permissions.includes(permission) && !d.revoked,
  );

  return {
    allowed: false,
    reason: lapsed && now >= lapsed.expiresAt ? "expired_delegation" : "missing_permission",
    explanation: lapsed
      ? `${denialExplanation(member.role, [permission])} A delegation for it expired on ${new Date(
          lapsed.expiresAt,
        ).toLocaleString()}.`
      : denialExplanation(member.role, [permission]),
    missingPermissions: [permission],
  };
}


/** Evaluate several permissions, reporting the first that is missing. */
export function checkTeamPermissions(
  team: Team,
  memberId: string,
  permissions: Permission[],
  options: Parameters<typeof checkTeamPermission>[3] = {},
): TeamActionDecision {
  for (const permission of permissions) {
    const decision = checkTeamPermission(team, memberId, permission, options);
    if (!decision.allowed) return decision;
  }
  const member = findMember(team, memberId);
  return {
    allowed: true,
    reason: "role_grant",
    explanation: `Granted by your ${member ? TEAM_ROLE_LABELS[member.role] : "membership"} role.`,
    missingPermissions: [],
  };
}

/** Effective permissions for a member, including any active delegation. */
export function effectiveTeamPermissions(
  team: Team,
  memberId: string,
  options: {
    delegations?: PermissionDelegation[];
    now?: number;
    verifySignature?: (delegation: PermissionDelegation) => boolean;
  } = {},
): Permission[] {
  const now = options.now ?? Date.now();
  const member = findMember(team, memberId);
  if (!member) return [];

  const direct = new Set(TEAM_ROLE_PERMISSIONS[member.role]);

  for (const d of options.delegations ?? []) {
    if (d.delegateeId !== memberId) continue;
    if (!isDelegationActive(d, now)) continue;
    if (options.verifySignature && !options.verifySignature(d)) continue;

    const delegator = findMember(team, d.delegatorId);
    if (!delegator) continue;
    // Never accept a permission the delegator does not hold themselves.
    for (const p of d.permissions) {
      if (TEAM_ROLE_PERMISSIONS[delegator.role].includes(p)) direct.add(p);
    }
  }

  return Array.from(direct);
}

/** Signature payload for a delegation, exposed so wallets can sign it. */
export function delegationSigningPayload(
  delegation: Omit<PermissionDelegation, "signature">,
): string {
  return canonicalizeDelegation(delegation);
}

