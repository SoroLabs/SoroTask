import { User, UserRole } from '@/types/auth';
import { AuthResult, IdentityResolutionResult } from './types';

export class IdentityManager {
  private userStore: Map<string, User> = new Map();

  /**
   * Normalizes an auth result into a unified User model.
   * In a real application, this would interface with a database.
   */
  async resolveIdentity(authResult: AuthResult): Promise<IdentityResolutionResult> {
    if (!authResult.success || !authResult.rawProfile) {
      return { success: false, error: 'Cannot resolve identity from failed auth result' };
    }

    try {
      let user: User;

      switch (authResult.providerId) {
        case 'github':
        case 'google':
        case 'oauth':
          user = this.normalizeOAuthProfile(authResult.rawProfile);
          break;
        case 'saml':
          user = this.normalizeSAMLProfile(authResult.rawProfile);
          break;
        case 'did':
          user = this.normalizeDIDProfile(authResult.rawProfile);
          break;
        default:
          if (authResult.rawProfile?.credentialId) {
            user = this.normalizePasskeyProfile(authResult.rawProfile);
          } else {
            throw new Error(`Unsupported provider type for identity resolution: ${authResult.providerId}`);
          }
      }

      // Mock DB operation: update or create user
      const existingUser = this.userStore.get(user.email || user.id);
      if (existingUser) {
        user = { ...existingUser, ...user };
      }
      
      // Ensure role and permissions are set
      user.role = user.role || 'user';
      user.permissions = user.permissions || ['tasks:read'];
      
      this.userStore.set(user.email || user.id, user);

      return { success: true, user };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  private normalizeOAuthProfile(profile: any): User {
    return {
      id: profile.sub || profile.id || `oauth_${Date.now()}`,
      address: '', // Requires later association
      role: 'user',
      permissions: ['tasks:read', 'tasks:create'],
      name: profile.name,
      email: profile.email
    };
  }

  private normalizeSAMLProfile(profile: any): User {
    return {
      id: profile.nameID,
      address: '',
      role: 'user', // SAML could map attributes to roles
      permissions: ['tasks:read', 'tasks:create'],
      name: profile.attributes?.displayName?.[0],
      email: profile.attributes?.email?.[0]
    };
  }

  private normalizeDIDProfile(profile: any): User {
    return {
      id: profile.id,
      address: profile.address,
      role: 'user',
      permissions: ['tasks:read', 'tasks:create', 'tasks:execute'],
      name: profile.id.substring(0, 16) + '...'
    };
  }

  private normalizePasskeyProfile(profile: any): User {
    return {
      id: `passkey:${profile.credentialId}`,
      address: profile.address ?? '',
      role: 'user',
      permissions: ['tasks:read', 'tasks:create'],
      name: `Passkey ${String(profile.credentialId).substring(0, 8)}`,
    };
  }
}
