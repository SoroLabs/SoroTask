'use client';

import { useState, useCallback, useEffect } from 'react';
import type { SharedAccess, CreateShareRequest, UpdateShareRequest, SharePreview, AccessValidationResult } from '@/types/sharing';

// Mock data for development - would be replaced with actual API calls
const mockShares: SharedAccess[] = [];

interface UseSharingReturn {
  shares: SharedAccess[];
  isLoading: boolean;
  error: string | null;
  createShare: (request: CreateShareRequest) => Promise<SharedAccess>;
  updateShare: (shareId: string, request: UpdateShareRequest) => Promise<SharedAccess>;
  revokeShare: (shareId: string) => Promise<void>;
  getSharesForResource: (scope: 'task' | 'project', resourceId: string) => SharedAccess[];
  getSharePreview: (scope: 'task' | 'project', resourceId: string) => Promise<SharePreview>;
  validateAccess: (token: string, password?: string) => Promise<AccessValidationResult>;
  refreshShares: () => Promise<void>;
}

export function useSharing(): UseSharingReturn {
  const [shares, setShares] = useState<SharedAccess[]>(mockShares);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateToken = () => {
    return Array.from({ length: 32 }, () => 
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 62)]
    ).join('');
  };

  const createShare = useCallback(async (request: CreateShareRequest): Promise<SharedAccess> => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500));
      
      const newShare: SharedAccess = {
        id: `share-${Date.now()}`,
        shareToken: generateToken(),
        scope: request.scope,
        resourceId: request.resourceId,
        resourceName: request.resourceId, // Would be fetched from API
        visibility: request.visibility,
        status: 'active',
        createdAt: new Date().toISOString(),
        expiresAt: request.expiresIn ? new Date(Date.now() + request.expiresIn * 1000).toISOString() : null,
        createdBy: 'current-user', // Would be from auth context
        accessCount: 0,
        lastAccessedAt: null,
        password: request.password,
      };
      
      setShares((prev) => [...prev, newShare]);
      return newShare;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to create share';
      setError(errorMsg);
      throw new Error(errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateShare = useCallback(async (shareId: string, request: UpdateShareRequest): Promise<SharedAccess> => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 300));
      
      let updatedShare: SharedAccess | null = null;
      
      setShares((prev) => 
        prev.map((share) => {
          if (share.id === shareId) {
            updatedShare = {
              ...share,
              visibility: request.visibility ?? share.visibility,
              expiresAt: request.expiresIn 
                ? new Date(Date.now() + request.expiresIn * 1000).toISOString() 
                : share.expiresAt,
              password: request.password ?? share.password,
            };
            return updatedShare;
          }
          return share;
        })
      );
      
      if (!updatedShare) {
        throw new Error('Share not found');
      }
      
      return updatedShare;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update share';
      setError(errorMsg);
      throw new Error(errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const revokeShare = useCallback(async (shareId: string): Promise<void> => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 300));
      
      setShares((prev) => 
        prev.map((share) => 
          share.id === shareId 
            ? { ...share, status: 'revoked' as const }
            : share
        )
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to revoke share';
      setError(errorMsg);
      throw new Error(errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getSharesForResource = useCallback((scope: 'task' | 'project', resourceId: string): SharedAccess[] => {
    return shares.filter(
      (share) => share.scope === scope && share.resourceId === resourceId
    );
  }, [shares]);

  const getSharePreview = useCallback(async (scope: 'task' | 'project', resourceId: string): Promise<SharePreview> => {
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 200));
    
    // Mock preview data - would be fetched from API
    const preview: SharePreview = {
      scope,
      resourceId,
      resourceName: resourceId,
      sharedFields: scope === 'task' 
        ? ['Task ID', 'Target Contract', 'Function Name', 'Interval', 'Status', 'Last Run']
        : ['Project Name', 'Description', 'Task Count', 'Created Date'],
      sensitiveFields: scope === 'task'
        ? ['Gas Balance', 'Owner Address', 'Private Functions']
        : ['Owner Address', 'Private Tasks'],
    };
    
    return preview;
  }, []);

  const validateAccess = useCallback(async (token: string, password?: string): Promise<AccessValidationResult> => {
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 300));
    
    const share = shares.find((s) => s.shareToken === token);
    
    if (!share) {
      return { valid: false, reason: 'not_found' };
    }
    
    if (share.status === 'revoked') {
      return { valid: false, reason: 'revoked', share };
    }
    
    if (share.status === 'expired' || (share.expiresAt && new Date(share.expiresAt) < new Date())) {
      return { valid: false, reason: 'expired', share };
    }
    
    if (share.visibility === 'password_protected') {
      if (!password) {
        return { valid: false, reason: 'password_required', share };
      }
      if (password !== share.password) {
        return { valid: false, reason: 'invalid_token', share };
      }
    }
    
    // Update access count
    setShares((prev) =>
      prev.map((s) =>
        s.id === share.id
          ? {
              ...s,
              accessCount: s.accessCount + 1,
              lastAccessedAt: new Date().toISOString(),
            }
          : s
      )
    );
    
    return { valid: true, share };
  }, [shares]);

  const refreshShares = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 300));
      // In real implementation, this would fetch from API
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to refresh shares';
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    shares,
    isLoading,
    error,
    createShare,
    updateShare,
    revokeShare,
    getSharesForResource,
    getSharePreview,
    validateAccess,
    refreshShares,
  };
}
