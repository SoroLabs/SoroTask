import type { Permission, UserRole } from "@/types/auth";
import {
  DEFAULT_RBAC_POLICIES,
  type RbacConnectionState,
  type RbacEngineOptions,
  type RbacEvaluationContext,
  type RbacEvaluationResult,
  type RbacPolicy,
} from "./types";

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
  if (context.userPermissions.length > 0) {
    return context.userPermissions;
  }

  return resolveRolePermissions(context.userRole, policies);
}

export function createRbacEngine(options: RbacEngineOptions = {}) {
  const policies = options.defaultPolicies ?? DEFAULT_RBAC_POLICIES;
  const offlineGracePeriodMs = options.offlineGracePeriodMs ?? 300_000;

  let lastOnlineAt = Date.now();
  let connectionState: RbacConnectionState = "online";

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

  return {
    evaluate,
    hasPermission,
    hasAllPermissions,
    hasAnyPermission,
    getPolicies,
    getConnectionState,
    setConnectionState,
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
