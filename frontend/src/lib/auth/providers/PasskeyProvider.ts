import { IAuthProvider, AuthProviderConfig, AuthCredentials, AuthResult } from '../types';

export interface PasskeyCredential {
  id: string;
  rawId: ArrayBuffer;
  response: {
    clientDataJSON: ArrayBuffer;
    authenticatorData?: ArrayBuffer;
    signature?: ArrayBuffer;
    attestationObject?: ArrayBuffer;
  };
  type: 'public-key';
}

export interface PasskeySessionToken {
  credentialId: string;
  stellarAddress: string;
  issuedAt: number;
  expiresAt: number;
}

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export class PasskeyProvider implements IAuthProvider {
  config: AuthProviderConfig;
  private rpId: string;
  private rpName: string;
  private sessionTtlMs: number;
  private credentialStore: Map<string, PasskeySessionToken> = new Map();

  constructor(
    id: string,
    name: string,
    rpId: string = typeof window !== 'undefined' ? window.location.hostname : 'localhost',
    rpName: string = 'SoroTask',
    sessionTtlMs: number = 24 * 60 * 60 * 1000,
  ) {
    this.config = { id, name, type: 'custom' };
    this.rpId = rpId;
    this.rpName = rpName;
    this.sessionTtlMs = sessionTtlMs;
  }

  async isWebAuthnAvailable(): Promise<boolean> {
    return (
      typeof window !== 'undefined' &&
      typeof window.PublicKeyCredential !== 'undefined' &&
      typeof window.navigator?.credentials?.create === 'function'
    );
  }

  async register(userId: string, stellarAddress: string): Promise<PasskeySessionToken> {
    if (!(await this.isWebAuthnAvailable())) {
      throw new Error('WebAuthn / Passkeys are not supported in this environment.');
    }

    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userIdBytes = new TextEncoder().encode(userId);

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { id: this.rpId, name: this.rpName },
        user: { id: userIdBytes, name: userId, displayName: userId },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
          authenticatorAttachment: 'platform',
        },
        timeout: 60000,
      },
    }) as PublicKeyCredential | null;

    if (!credential) {
      throw new Error('Registration cancelled or failed.');
    }

    const credentialId = base64url(credential.rawId);
    const token: PasskeySessionToken = {
      credentialId,
      stellarAddress,
      issuedAt: Date.now(),
      expiresAt: Date.now() + this.sessionTtlMs,
    };

    this.credentialStore.set(credentialId, token);
    return token;
  }

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    try {
      if (!(await this.isWebAuthnAvailable())) {
        throw new Error('WebAuthn / Passkeys are not supported.');
      }

      const challenge = credentials.challenge
        ? Uint8Array.from(atob(credentials.challenge as string), (c) => c.charCodeAt(0))
        : crypto.getRandomValues(new Uint8Array(32));

      const allowCredentials: PublicKeyCredentialDescriptor[] = credentials.credentialId
        ? [{ type: 'public-key', id: Uint8Array.from(atob(credentials.credentialId as string), (c) => c.charCodeAt(0)) }]
        : [];

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: this.rpId,
          userVerification: 'required',
          allowCredentials,
          timeout: 60000,
        },
      }) as PublicKeyCredential | null;

      if (!assertion) {
        throw new Error('Authentication cancelled or failed.');
      }

      const credentialId = base64url(assertion.rawId);

      const existing = this.credentialStore.get(credentialId);
      if (existing && Date.now() > existing.expiresAt) {
        this.credentialStore.delete(credentialId);
        throw new Error('Passkey session has expired. Please re-register.');
      }

      const stellarAddress = existing?.stellarAddress ?? credentials.stellarAddress as string ?? '';

      const token: PasskeySessionToken = {
        credentialId,
        stellarAddress,
        issuedAt: Date.now(),
        expiresAt: Date.now() + this.sessionTtlMs,
      };
      this.credentialStore.set(credentialId, token);

      return {
        success: true,
        providerId: this.config.id,
        token: JSON.stringify(token),
        rawProfile: {
          id: `passkey:${credentialId}`,
          address: stellarAddress,
          credentialId,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        providerId: this.config.id,
        error: error.message ?? String(error),
      };
    }
  }

  async validateToken(token: string): Promise<boolean> {
    try {
      const parsed: PasskeySessionToken = JSON.parse(token);
      const stored = this.credentialStore.get(parsed.credentialId);
      if (!stored) return false;
      return Date.now() < stored.expiresAt;
    } catch {
      return false;
    }
  }

  async logout(token: string): Promise<void> {
    try {
      const parsed: PasskeySessionToken = JSON.parse(token);
      this.credentialStore.delete(parsed.credentialId);
    } catch {
      // nothing to do
    }
  }
}
