/**
 * Permission Guard Component
 *
 * Conditionally renders children based on user permissions. When the user is
 * denied, the child is disabled in place with an explanatory tooltip rather
 * than removed, so the user can see the action exists and learn why it is
 * unavailable (issue #1244). Every decision is written to the audit log with
 * the acting user's ID.
 */

'use client';

import React, { useEffect, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getRbacAuditLog } from '@/src/lib/rbac/auditLog';
import { checkTeamPermission } from '@/src/lib/rbac/team';
import { TEAM_ROLE_LABELS, type PermissionDelegation, type Team } from '@/src/lib/rbac/types';
import type { Permission } from '@/types/auth';

interface PermissionGuardProps {
  children: React.ReactNode;
  permissions: Permission[];
  fallback?: React.ReactNode;
  requireAll?: boolean; // true = AND (user must have ALL permissions), false = OR (user must have ANY permission)
  /**
   * When false, a denied child is disabled with a tooltip instead of being
   * unmounted. Keeps the action discoverable and explains the restriction.
   */
  disableWhenDenied?: boolean;
  /** Workspace used for the richer team-aware explanation. */
  team?: Team;
  delegations?: PermissionDelegation[];
  /** Action name recorded in the audit log. Defaults to the required permissions. */
  actionName?: string;
}

const DENIED_CLASS = 'cursor-not-allowed opacity-50';

export default function PermissionGuard({
  children,
  permissions,
  fallback = null,
  requireAll = true,
  disableWhenDenied = false,
  team,
  delegations,
  actionName,
}: PermissionGuardProps) {
  const { hasAllPermissions, hasAnyPermission, isLoading, user } = useAuth();

  const hasAccess = isLoading
    ? false
    : requireAll
      ? hasAllPermissions(permissions)
      : hasAnyPermission(permissions);

  // Prefer the team engine when a workspace is supplied: it understands roles
  // and delegations, so the explanation names the real reason.
  const needsTeamCheck = !isLoading && !hasAccess && Boolean(team && user);
  const decision = useMemo(() => {
    if (!needsTeamCheck || !team || !user) return null;
    // For requireAll the first permission is the one that will block; for
    // requireAny the last one is the best single explanation.
    const probe = requireAll ? permissions[0] : permissions[permissions.length - 1];
    return checkTeamPermission(team, user.id, probe, { delegations });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsTeamCheck, team, user, delegations, requireAll, permissions.join(',')]);

  const denied = !isLoading && !hasAccess;

  // Record the blocked attempt. Kept in an effect so a re-render never writes a
  // duplicate row, and so the log is a side effect rather than render output.
  useEffect(() => {
    if (!denied || !user) return;
    getRbacAuditLog().record({
      userId: user.id,
      userName: user.name,
      action: actionName ?? permissions.join('+'),
      permission: permissions[0],
      allowed: false,
      reason: decision?.reason ?? 'missing_permission',
      viaDelegationId: decision?.viaDelegationId,
    });
  }, [denied, user, actionName, decision, permissions]);

  // Show nothing while loading to prevent flicker
  if (isLoading) {
    return null;
  }

  if (hasAccess) return <>{children}</>;

  const explanation =
    decision?.explanation ??
    `Your account is missing ${permissions.map((p) => `\`${p}\``).join(', ')}.`;

  if (!disableWhenDenied) {
    return <>{fallback}</>;
  }

  return (
    <span
      title={explanation}
      aria-label={explanation}
      className={DENIED_CLASS}
      data-rbac-denied="true"
    >
      {children}
    </span>
  );
}

/**
 * Role badge for the user profile / team list (issue #1244, "easy" step).
 * Renders nothing when there is no role to show.
 */
export function RoleBadge({ role }: { role?: keyof typeof TEAM_ROLE_LABELS }) {
  if (!role) return null;

  const tone =
    role === 'owner'
      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
      : role === 'operator'
        ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
        : 'bg-neutral-500/15 text-neutral-300 border-neutral-500/30';

  return (
    <span
      data-testid="role-badge"
      data-role={role}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {TEAM_ROLE_LABELS[role]}
    </span>
  );
}

/**
 * Hook for conditional rendering based on permissions.
 */
export function usePermissionGuard() {
  const { hasPermission, hasAnyPermission, hasAllPermissions, isLoading } = useAuth();

  return {
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    isLoading,
    PermissionGuard,
  };
}