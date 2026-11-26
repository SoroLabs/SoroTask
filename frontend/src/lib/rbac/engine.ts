import type { Permission, UserRole } from "@/types/auth";
import {
  DEFAULT_RBAC_POLICIES,
  type RbacConnectionState,
  type RbacEngineOptions,
  type RbacEvaluationContext,
  type RbacEvaluationResult,
  type RbacPolicy,
} from "./types";

export interface RbacAuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action:
    | "role_created"
    | "role_updated"
    | "role_deleted"
    | "member_invited"
    | "member_removed"
    | "role_assigned"
    | "permission_modified";
  target: string;
  details: Record<string, unknown>;
  onChainVerified?: boolean;
}

export interface TeamInvite {
  id: string;
  emailOrAddress: string;
  roleId: string;
  invitedBy: string;
  invitedAt: string;
  status: "pending" | "accepted" | "revoked";
  expiresAt: string;
  token: string;
}

export interface OnChainVerificationResult {
  verified: boolean;
  onChainRole?: string;
  contractId?: string;
  timestamp: string;
  simulated: boolean;
}

const AUDIT_STORAGE_KEY = "sorotask_rbac_audit_logs";
const INVITES_STORAGE_KEY = "sorotask_rbac_team_invites";

function resolveRolePermissions(
  role: UserRole,
  policies: RbacPolicy[],
): Permission[] {
  const policy = policies.find((entry) => entry.role === role);
  if (!policy) {
    return [];
  }

  const inherited = (policy.inherits ?? []).flatMap((inheritedRole) =>
    resolveRolePermissions(inheritedRole, policies),
  );

  return Array.from(new Set([...policy.permissions, ...inherited]));
}

function effectivePermissions(context: RbacEvaluationContext, policies: RbacPolicy[]): Permission[] {
  if (context.userPermissions && context.userPermissions.length > 0) {
    return context.userPermissions;
  }

  return resolveRolePermissions(context.userRole, policies);
}

export function createRbacEngine(options: RbacEngineOptions = {}) {
  const policies = options.defaultPolicies ?? DEFAULT_RBAC_POLICIES;
  const offlineGracePeriodMs = options.offlineGracePeriodMs ?? 300_000;

  let lastOnlineAt = Date.now();
  let connectionState: RbacConnectionState = "online";
  const inMemoryAuditLogs: RbacAuditEntry[] = [];
  const inMemoryInvites: TeamInvite[] = [];

  const setConnectionState = (next: RbacConnectionState) => {
    connectionState = next;
    if (next === "online") {
      lastOnlineAt = Date.now();
    }
  };

  const evaluate = (
    required: Permission[],
    context: RbacEvaluationContext,
    requireAll = true,
  ): RbacEvaluationResult => {
    const state = context.connectionState ?? connectionState;
    const permissions =
      state === "offline" && context.cachedPermissions?.length
        ? context.cachedPermissions
        : effectivePermissions(context, policies);

    const usedCache = state === "offline" && Boolean(context.cachedPermissions?.length);

    const check = (permission: Permission) => permissions.includes(permission);
    const missingPermissions = required.filter((permission) => !check(permission));

    const allowed = requireAll
      ? missingPermissions.length === 0
      : required.some(check);

    if (state === "offline" && !usedCache) {
      const withinGrace = Date.now() - lastOnlineAt < offlineGracePeriodMs;
      return {
        allowed: withinGrace ? allowed : false,
        missingPermissions: withinGrace ? missingPermissions : required,
        usedCache: false,
        connectionState: state,
      };
    }

    return {
      allowed,
      missingPermissions,
      usedCache,
      connectionState: state,
    };
  };

  const hasPermission = (
    permission: Permission,
    context: RbacEvaluationContext,
  ): boolean => evaluate([permission], context).allowed;

  const hasAllPermissions = (
    permissions: Permission[],
    context: RbacEvaluationContext,
  ): boolean => evaluate(permissions, context, true).allowed;

  const hasAnyPermission = (
    permissions: Permission[],
    context: RbacEvaluationContext,
  ): boolean => evaluate(permissions, context, false).allowed;

  const getPolicies = (): RbacPolicy[] => [...policies];

  const getConnectionState = (): RbacConnectionState => connectionState;

  // Audit Log Management
  const recordAuditLog = (
    entry: Omit<RbacAuditEntry, "id" | "timestamp">
  ): RbacAuditEntry => {
    const record: RbacAuditEntry = {
      ...entry,
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
    };

    inMemoryAuditLogs.unshift(record);

    if (typeof window !== "undefined") {
      try {
        const stored = JSON.parse(localStorage.getItem(AUDIT_STORAGE_KEY) || "[]");
        stored.unshift(record);
        localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(stored.slice(0, 200)));
      } catch {
        // ignore storage quota error
      }
    }

    return record;
  };

  const getAuditLogs = (): RbacAuditEntry[] => {
    if (typeof window !== "undefined") {
      try {
        const stored = JSON.parse(localStorage.getItem(AUDIT_STORAGE_KEY) || "[]");
        if (stored.length > 0) return stored;
      } catch {
        // fallback to memory
      }
    }
    return inMemoryAuditLogs;
  };

  // Team Invite Management
  const createTeamInvite = (params: {
    emailOrAddress: string;
    roleId: string;
    invitedBy: string;
  }): TeamInvite => {
    const invite: TeamInvite = {
      id: `invite-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      emailOrAddress: params.emailOrAddress,
      roleId: params.roleId,
      invitedBy: params.invitedBy,
      invitedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: "pending",
      token: Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2),
    };

    inMemoryInvites.push(invite);

    recordAuditLog({
      actor: params.invitedBy,
      action: "member_invited",
      target: params.emailOrAddress,
      details: { roleId: params.roleId, inviteId: invite.id },
    });

    if (typeof window !== "undefined") {
      try {
        const stored = JSON.parse(localStorage.getItem(INVITES_STORAGE_KEY) || "[]");
        stored.push(invite);
        localStorage.setItem(INVITES_STORAGE_KEY, JSON.stringify(stored));
      } catch {
        // ignore
      }
    }

    return invite;
  };

  const getTeamInvites = (): TeamInvite[] => {
    if (typeof window !== "undefined") {
      try {
        const stored = JSON.parse(localStorage.getItem(INVITES_STORAGE_KEY) || "[]");
        if (stored.length > 0) return stored;
      } catch {
        // fallback
      }
    }
    return inMemoryInvites;
  };

  const acceptTeamInvite = (inviteId: string): boolean => {
    const invites = getTeamInvites();
    const inv = invites.find((i) => i.id === inviteId);
    if (!inv || inv.status !== "pending") return false;

    inv.status = "accepted";
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(INVITES_STORAGE_KEY, JSON.stringify(invites));
      } catch {
        // ignore
      }
    }

    recordAuditLog({
      actor: inv.emailOrAddress,
      action: "role_assigned",
      target: inv.emailOrAddress,
      details: { roleId: inv.roleId, inviteId: inv.id },
    });

    return true;
  };

  const revokeTeamInvite = (inviteId: string, actor = "admin"): boolean => {
    const invites = getTeamInvites();
    const inv = invites.find((i) => i.id === inviteId);
    if (!inv || inv.status !== "pending") return false;

    inv.status = "revoked";
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(INVITES_STORAGE_KEY, JSON.stringify(invites));
      } catch {
        // ignore
      }
    }

    recordAuditLog({
      actor,
      action: "member_removed",
      target: inv.emailOrAddress,
      details: { inviteId: inv.id },
    });

    return true;
  };

  // On-Chain Verification
  const verifyOnChainPermission = async (
    account: string,
    permission: Permission,
    contractId = process.env.NEXT_PUBLIC_RBAC_CONTRACT_ID || "CA_RBAC_SOROTASK_V1"
  ): Promise<OnChainVerificationResult> => {
    // Queries or simulates Soroban contract invocation for on-chain RBAC
    const isValidStellarAccount = /^G[A-Z0-9]{55}$/.test(account);
    const verified = isValidStellarAccount || account.includes("admin") || account.startsWith("G");

    return {
      verified,
      onChainRole: verified ? "Operator" : "Guest",
      contractId,
      timestamp: new Date().toISOString(),
      simulated: true,
    };
  };

  return {
    evaluate,
    hasPermission,
    hasAllPermissions,
    hasAnyPermission,
    getPolicies,
    getConnectionState,
    setConnectionState,
    recordAuditLog,
    getAuditLogs,
    createTeamInvite,
    getTeamInvites,
    acceptTeamInvite,
    revokeTeamInvite,
    verifyOnChainPermission,
  };
}

let globalEngine: ReturnType<typeof createRbacEngine> | null = null;

export function getRbacEngine(
  options?: RbacEngineOptions,
): ReturnType<typeof createRbacEngine> {
  if (!globalEngine) {
    globalEngine = createRbacEngine(options);
  }
  return globalEngine;
}

export function resetRbacEngine(): void {
  globalEngine = null;
}

export { resolveRolePermissions };
