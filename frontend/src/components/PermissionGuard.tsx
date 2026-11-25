"use client";

import React from "react";
import { UserRole, ActionType, hasPermission } from "../lib/rbac/permissions";

export interface PermissionGuardProps {
  userRole: UserRole;
  requiredAction: ActionType;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function PermissionGuard({ userRole, requiredAction, children, fallback }: PermissionGuardProps) {
  const isAllowed = hasPermission(userRole, requiredAction);

  if (!isAllowed) {
    if (fallback) return <>{fallback}</>;
    return (
      <span className="relative inline-block cursor-not-allowed group">
        <span className="pointer-events-none opacity-50">{children}</span>
        <span className="absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-300 shadow-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-slate-700">
          Requires elevated role ({requiredAction.replace('_', ' ')})
        </span>
      </span>
    );
  }

  return <>{children}</>;
}
