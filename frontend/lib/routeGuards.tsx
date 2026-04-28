/**
 * Route Protection Utilities
 * Guards for Next.js routes and navigation
 */

'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import type { Permission } from '@/types/auth';

interface RouteGuardProps {
  children: React.ReactNode;
  requiredPermissions: Permission[];
  redirectTo?: string;
  requireAll?: boolean;
  fallback?: React.ReactNode;
}

/**
 * Route Guard Component
 * Protects entire pages/routes based on permissions
 */
export function RouteGuard({
  children,
  requiredPermissions,
  redirectTo = '/unauthorized',
  requireAll = true,
  fallback,
}: RouteGuardProps) {
  const { hasAllPermissions, hasAnyPermission, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    const hasAccess = requireAll
      ? hasAllPermissions(requiredPermissions)
      : hasAnyPermission(requiredPermissions);

    if (!hasAccess) {
      router.push(redirectTo);
    }
  }, [
    isAuthenticated,
    isLoading,
    requiredPermissions,
    requireAll,
    hasAllPermissions,
    hasAnyPermission,
    router,
    redirectTo,
  ]);

  // Show loading state or fallback while checking permissions
  if (isLoading) {
    return fallback || (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return fallback || null;
  }

  const hasAccess = requireAll
    ? hasAllPermissions(requiredPermissions)
    : hasAnyPermission(requiredPermissions);

  if (!hasAccess) {
    return fallback || null;
  }

  return <>{children}</>;
}

/**
 * Higher-Order Component for protecting pages
 */
export function withRouteGuard<P extends object>(
  Component: React.ComponentType<P>,
  requiredPermissions: Permission[],
  options?: {
    redirectTo?: string;
    requireAll?: boolean;
    fallback?: React.ReactNode;
  }
) {
  const WrappedComponent = (props: P) => (
    <RouteGuard
      requiredPermissions={requiredPermissions}
      redirectTo={options?.redirectTo}
      requireAll={options?.requireAll}
      fallback={options?.fallback}
    >
      <Component {...props} />
    </RouteGuard>
  );

  WrappedComponent.displayName = `withRouteGuard(${Component.displayName || Component.name})`;

  return WrappedComponent;
}

/**
 * Hook for programmatic navigation with permission checks
 */
export function useGuardedNavigation() {
  const { hasAllPermissions, hasAnyPermission } = useAuth();
  const router = useRouter();

  const navigateIfAllowed = (
    path: string,
    requiredPermissions: Permission[],
    options?: {
      requireAll?: boolean;
      fallbackPath?: string;
    }
  ) => {
    const { requireAll = true, fallbackPath } = options || {};

    const hasAccess = requireAll
      ? hasAllPermissions(requiredPermissions)
      : hasAnyPermission(requiredPermissions);

    if (hasAccess) {
      router.push(path);
    } else if (fallbackPath) {
      router.push(fallbackPath);
    }
  };

  return { navigateIfAllowed };
}