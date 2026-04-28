/**
 * User authentication and authorization types
 */

export type UserRole = 'admin' | 'user' | 'viewer';

export type Permission =
  | 'tasks:create'
  | 'tasks:read'
  | 'tasks:update'
  | 'tasks:delete'
  | 'tasks:execute'
  | 'tasks:pause'
  | 'tasks:resume'
  | 'admin:users'
  | 'admin:settings'
  | 'admin:system';

export interface User {
  id: string;
  address: string; // Stellar address
  role: UserRole;
  permissions: Permission[];
  name?: string;
  email?: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

/**
 * Route protection configuration
 */
export interface RouteGuard {
  path: string;
  requiredPermissions: Permission[];
  redirectTo?: string;
  fallbackComponent?: React.ComponentType;
}

/**
 * Component permission requirements
 */
export interface PermissionGuardProps {
  children: React.ReactNode;
  permissions: Permission[];
  fallback?: React.ReactNode;
  requireAll?: boolean; // true = AND, false = OR
}