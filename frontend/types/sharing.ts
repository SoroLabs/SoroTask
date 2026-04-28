// Sharing types for external task/project access

export type ShareScope = 'task' | 'project';

export type ShareVisibility = 'public' | 'private' | 'password_protected';

export type ShareStatus = 'active' | 'expired' | 'revoked';

export interface SharedAccess {
  id: string;
  shareToken: string;
  scope: ShareScope;
  resourceId: string;
  resourceName: string;
  visibility: ShareVisibility;
  status: ShareStatus;
  createdAt: string;
  expiresAt: string | null;
  createdBy: string;
  accessCount: number;
  lastAccessedAt: string | null;
  password?: string; // Only for password_protected visibility
}

export interface ShareLink {
  url: string;
  token: string;
  expiresAt: string | null;
}

export interface CreateShareRequest {
  scope: ShareScope;
  resourceId: string;
  visibility: ShareVisibility;
  expiresIn?: number; // Duration in seconds, undefined = never expires
  password?: string;
}

export interface UpdateShareRequest {
  visibility?: ShareVisibility;
  expiresIn?: number;
  password?: string;
}

export interface SharePreview {
  scope: ShareScope;
  resourceId: string;
  resourceName: string;
  resourceDescription?: string;
  sharedFields: string[];
  sensitiveFields: string[];
}

export interface AccessValidationResult {
  valid: boolean;
  reason?: 'expired' | 'revoked' | 'invalid_token' | 'password_required' | 'not_found';
  share?: SharedAccess;
}
