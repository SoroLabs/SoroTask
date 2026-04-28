/**
 * Authentication Context
 * Manages user authentication state and permissions
 */

'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { User, AuthState, Permission } from '@/types/auth';

interface AuthContextType extends AuthState {
  login: (user: User) => void;
  logout: () => void;
  hasPermission: (permission: Permission) => boolean;
  hasAnyPermission: (permissions: Permission[]) => boolean;
  hasAllPermissions: (permissions: Permission[]) => boolean;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: React.ReactNode;
}

/**
 * Mock authentication service - replace with real API calls
 */
class AuthService {
  private static readonly STORAGE_KEY = 'sorotask_auth';

  static async authenticate(address: string): Promise<User> {
    // Mock authentication - replace with real wallet connection
    const mockUsers: Record<string, User> = {
      'admin_address': {
        id: '1',
        address: 'admin_address',
        role: 'admin',
        permissions: [
          'tasks:create', 'tasks:read', 'tasks:update', 'tasks:delete',
          'tasks:execute', 'tasks:pause', 'tasks:resume',
          'admin:users', 'admin:settings', 'admin:system'
        ],
        name: 'Admin User'
      },
      'user_address': {
        id: '2',
        address: 'user_address',
        role: 'user',
        permissions: [
          'tasks:create', 'tasks:read', 'tasks:update', 'tasks:delete',
          'tasks:execute', 'tasks:pause', 'tasks:resume'
        ],
        name: 'Regular User'
      },
      'viewer_address': {
        id: '3',
        address: 'viewer_address',
        role: 'viewer',
        permissions: ['tasks:read'],
        name: 'Viewer User'
      }
    };

    const user = mockUsers[address];
    if (!user) {
      throw new Error('User not found');
    }

    // Store in localStorage for persistence
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(user));
    return user;
  }

  static getStoredUser(): User | null {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  static clearStoredUser(): void {
    localStorage.removeItem(this.STORAGE_KEY);
  }

  static async validateSession(): Promise<User | null> {
    const storedUser = this.getStoredUser();
    if (!storedUser) return null;

    // In real implementation, validate with backend
    // For now, just return stored user
    return storedUser;
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,
  });

  // Initialize auth state on mount
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        setAuthState(prev => ({ ...prev, isLoading: true, error: null }));

        const user = await AuthService.validateSession();
        if (user) {
          setAuthState({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
        } else {
          setAuthState({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: null,
          });
        }
      } catch (error) {
        setAuthState({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Authentication failed',
        });
      }
    };

    initializeAuth();
  }, []);

  const login = useCallback(async (user: User) => {
    try {
      setAuthState(prev => ({ ...prev, isLoading: true, error: null }));

      // In real implementation, this would connect to wallet and authenticate
      const authenticatedUser = await AuthService.authenticate(user.address);

      setAuthState({
        user: authenticatedUser,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setAuthState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Login failed',
      }));
      throw error;
    }
  }, []);

  const logout = useCallback(() => {
    AuthService.clearStoredUser();
    setAuthState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  }, []);

  const hasPermission = useCallback((permission: Permission): boolean => {
    return authState.user?.permissions.includes(permission) ?? false;
  }, [authState.user]);

  const hasAnyPermission = useCallback((permissions: Permission[]): boolean => {
    if (!authState.user) return false;
    return permissions.some(permission => authState.user!.permissions.includes(permission));
  }, [authState.user]);

  const hasAllPermissions = useCallback((permissions: Permission[]): boolean => {
    if (!authState.user) return false;
    return permissions.every(permission => authState.user!.permissions.includes(permission));
  }, [authState.user]);

  const refreshUser = useCallback(async () => {
    if (!authState.user) return;

    try {
      setAuthState(prev => ({ ...prev, isLoading: true, error: null }));

      // In real implementation, fetch updated user data from backend
      const updatedUser = await AuthService.validateSession();

      if (updatedUser) {
        setAuthState(prev => ({
          ...prev,
          user: updatedUser,
          isLoading: false,
        }));
      } else {
        // Session expired
        logout();
      }
    } catch (error) {
      setAuthState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to refresh user',
      }));
    }
  }, [authState.user, logout]);

  const contextValue: AuthContextType = {
    ...authState,
    login,
    logout,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access authentication context
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}