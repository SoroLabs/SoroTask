/**
 * Permission Guard Component
 * Conditionally renders children based on user permissions
 */

'use client';

import React from 'react';
import { useAuth } from '@/context/AuthContext';
import type { Permission } from '@/types/auth';

interface PermissionGuardProps {
  children: React.ReactNode;
  permissions: Permission[];
  fallback?: React.ReactNode;
  requireAll?: boolean; // true = AND (user must have ALL permissions), false = OR (user must have ANY permission)
}

/**
 * Renders children only if user has required permissions
 */
export default function PermissionGuard({
  children,
  permissions,
  fallback = null,
  requireAll = true,
}: PermissionGuardProps) {
  const { hasAllPermissions, hasAnyPermission, isLoading } = useAuth();

  // Show nothing while loading to prevent flicker
  if (isLoading) {
    return null;
  }

  const hasAccess = requireAll
    ? hasAllPermissions(permissions)
    : hasAnyPermission(permissions);

  return hasAccess ? <>{children}</> : <>{fallback}</>;
}

/**
 * Hook for conditional rendering based on permissions
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