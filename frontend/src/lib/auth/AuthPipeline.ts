import { IAuthProvider, AuthCredentials, AuthResult, AuthProviderConfig } from './types';
import { IdentityManager } from './IdentityManager';
import { User } from '@/types/auth';

interface AuthPipelineOptions {
  enableErrorTracking?: boolean;
}

export class AuthPipeline {
  private providers: Map<string, IAuthProvider> = new Map();
  private identityManager: IdentityManager;
  private options: AuthPipelineOptions;

  constructor(identityManager: IdentityManager, options: AuthPipelineOptions = { enableErrorTracking: true }) {
    this.identityManager = identityManager;
    this.options = options;
  }

  registerProvider(provider: IAuthProvider): void {
    if (this.providers.has(provider.config.id)) {
      throw new Error(`Provider with id ${provider.config.id} is already registered.`);
    }
    this.providers.set(provider.config.id, provider);
  }

  getProvider(id: string): IAuthProvider | undefined {
    return this.providers.get(id);
  }

  getRegisteredProviders(): AuthProviderConfig[] {
    return Array.from(this.providers.values()).map(p => p.config);
  }

  async authenticate(providerId: string, credentials: AuthCredentials): Promise<{ success: boolean; user?: User; error?: string }> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      const errorMsg = `Provider ${providerId} not found.`;
      this.trackError(errorMsg, 'pipeline');
      return { success: false, error: errorMsg };
    }

    try {
      // 1. Authenticate with provider
      const authResult = await provider.authenticate(credentials);
      
      if (!authResult.success) {
        this.trackError(authResult.error as string, providerId);
        // Implement Fallback if needed, e.g., retry or secondary auth
        return { success: false, error: authResult.error as string };
      }

      // 2. Resolve unified identity
      const identityResult = await this.identityManager.resolveIdentity(authResult);
      if (!identityResult.success) {
        this.trackError(identityResult.error as string, 'identity_resolution');
        return { success: false, error: identityResult.error };
      }

      return { success: true, user: identityResult.user };
    } catch (error: any) {
      this.trackError(error.message || String(error), providerId);
      return { success: false, error: error.message || String(error) };
    }
  }

  private trackError(error: string, context: string): void {
    if (this.options.enableErrorTracking) {
      // In a real app, this would send to Sentry, Datadog, etc.
      console.error(`[Auth Error - ${context}]`, error);
    }
  }
}
