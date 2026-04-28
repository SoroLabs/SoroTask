import { renderHook, act, waitFor } from '@testing-library/react';
import { useSharing } from '@/hooks/useSharing';
import type { CreateShareRequest, SharedAccess } from '@/types/sharing';

describe('useSharing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Initial state', () => {
    it('should have empty shares initially', () => {
      const { result } = renderHook(() => useSharing());
      expect(result.current.shares).toEqual([]);
    });

    it('should not be loading initially', () => {
      const { result } = renderHook(() => useSharing());
      expect(result.current.isLoading).toBe(false);
    });

    it('should have no error initially', () => {
      const { result } = renderHook(() => useSharing());
      expect(result.current.error).toBeNull();
    });
  });

  describe('createShare', () => {
    it('should create a new share', async () => {
      const { result } = renderHook(() => useSharing());
      
      const request: CreateShareRequest = {
        scope: 'task',
        resourceId: 'task-123',
        visibility: 'public',
      };
      
      let share: SharedAccess | undefined;
      await act(async () => {
        share = await result.current.createShare(request);
      });
      
      expect(share).toMatchObject({
        scope: 'task',
        resourceId: 'task-123',
        visibility: 'public',
        status: 'active',
      });
      expect(share!.shareToken).toHaveLength(32);
    });

    it('should add new share to shares list', async () => {
      const { result } = renderHook(() => useSharing());
      
      const request: CreateShareRequest = {
        scope: 'task',
        resourceId: 'task-123',
        visibility: 'public',
      };
      
      await act(async () => {
        await result.current.createShare(request);
      });
      
      expect(result.current.shares).toHaveLength(1);
    });

    it('should set expiration date when expiresIn is provided', async () => {
      const { result } = renderHook(() => useSharing());
      
      const request: CreateShareRequest = {
        scope: 'task',
        resourceId: 'task-123',
        visibility: 'public',
        expiresIn: 3600, // 1 hour
      };
      
      let share: SharedAccess | undefined;
      await act(async () => {
        share = await result.current.createShare(request);
      });
      
      expect(share!.expiresAt).not.toBeNull();
    });

    it('should store password for password_protected visibility', async () => {
      const { result } = renderHook(() => useSharing());
      
      const request: CreateShareRequest = {
        scope: 'task',
        resourceId: 'task-123',
        visibility: 'password_protected',
        password: 'testpassword',
      };
      
      let share: SharedAccess | undefined;
      await act(async () => {
        share = await result.current.createShare(request);
      });
      
      expect(share!.password).toBe('testpassword');
    });
  });

  describe('revokeShare', () => {
    it('should revoke an existing share', async () => {
      const { result } = renderHook(() => useSharing());
      
      // Create a share first
      await act(async () => {
        await result.current.createShare({
          scope: 'task',
          resourceId: 'task-123',
          visibility: 'public',
        });
      });
      
      const shareId = result.current.shares[0].id;
      
      await act(async () => {
        await result.current.revokeShare(shareId);
      });
      
      expect(result.current.shares[0].status).toBe('revoked');
    });
  });

  describe('getSharesForResource', () => {
    it('should return shares for specific resource', async () => {
      const { result } = renderHook(() => useSharing());
      
      await act(async () => {
        await result.current.createShare({
          scope: 'task',
          resourceId: 'task-123',
          visibility: 'public',
        });
        await result.current.createShare({
          scope: 'task',
          resourceId: 'task-456',
          visibility: 'public',
        });
      });
      
      const shares = result.current.getSharesForResource('task', 'task-123');
      expect(shares).toHaveLength(1);
      expect(shares[0].resourceId).toBe('task-123');
    });

    it('should return empty array for non-existent resource', () => {
      const { result } = renderHook(() => useSharing());
      const shares = result.current.getSharesForResource('task', 'non-existent');
      expect(shares).toEqual([]);
    });
  });

  describe('validateAccess', () => {
    it('should return not_found for invalid token', async () => {
      const { result } = renderHook(() => useSharing());
      
      const validation = await result.current.validateAccess('invalid-token');
      
      expect(validation).toEqual({ valid: false, reason: 'not_found' });
    });

    it('should return valid for existing share', async () => {
      const { result } = renderHook(() => useSharing());
      
      let share: SharedAccess | undefined;
      await act(async () => {
        share = await result.current.createShare({
          scope: 'task',
          resourceId: 'task-123',
          visibility: 'public',
        });
      });
      
      const validation = await result.current.validateAccess(share!.shareToken);
      
      expect(validation.valid).toBe(true);
      expect(validation.share).toBeDefined();
    });

    it('should return revoked for revoked share', async () => {
      const { result } = renderHook(() => useSharing());
      
      let share: SharedAccess | undefined;
      await act(async () => {
        share = await result.current.createShare({
          scope: 'task',
          resourceId: 'task-123',
          visibility: 'public',
        });
        await result.current.revokeShare(share!.id);
      });
      
      const validation = await result.current.validateAccess(share!.shareToken);
      
      expect(validation).toMatchObject({ valid: false, reason: 'revoked' });
    });

    it('should return password_required for password protected share', async () => {
      const { result } = renderHook(() => useSharing());
      
      let share: SharedAccess | undefined;
      await act(async () => {
        share = await result.current.createShare({
          scope: 'task',
          resourceId: 'task-123',
          visibility: 'password_protected',
          password: 'testpassword',
        });
      });
      
      const validation = await result.current.validateAccess(share!.shareToken);
      
      expect(validation).toMatchObject({ valid: false, reason: 'password_required' });
    });

    it('should validate password correctly', async () => {
      const { result } = renderHook(() => useSharing());
      
      let share: SharedAccess | undefined;
      await act(async () => {
        share = await result.current.createShare({
          scope: 'task',
          resourceId: 'task-123',
          visibility: 'password_protected',
          password: 'testpassword',
        });
      });
      
      // Wrong password
      const wrongValidation = await result.current.validateAccess(share!.shareToken, 'wrongpassword');
      expect(wrongValidation).toMatchObject({ valid: false, reason: 'invalid_token' });
      
      // Correct password
      const correctValidation = await result.current.validateAccess(share!.shareToken, 'testpassword');
      expect(correctValidation.valid).toBe(true);
    });

    it('should increment access count on valid access', async () => {
      const { result } = renderHook(() => useSharing());
      
      let share: SharedAccess | undefined;
      await act(async () => {
        share = await result.current.createShare({
          scope: 'task',
          resourceId: 'task-123',
          visibility: 'public',
        });
      });
      
      expect(result.current.shares[0].accessCount).toBe(0);
      
      await act(async () => {
        await result.current.validateAccess(share!.shareToken);
      });
      
      expect(result.current.shares[0].accessCount).toBe(1);
    });
  });

  describe('getSharePreview', () => {
    it('should return preview for task', async () => {
      const { result } = renderHook(() => useSharing());
      
      const preview = await result.current.getSharePreview('task', 'task-123');
      
      expect(preview.scope).toBe('task');
      expect(preview.resourceId).toBe('task-123');
      expect(preview.sharedFields).toContain('Task ID');
    });

    it('should return preview for project', async () => {
      const { result } = renderHook(() => useSharing());
      
      const preview = await result.current.getSharePreview('project', 'project-123');
      
      expect(preview.scope).toBe('project');
      expect(preview.sharedFields).toContain('Project Name');
    });
  });
});
