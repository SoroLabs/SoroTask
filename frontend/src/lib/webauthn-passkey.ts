const RP_NAME = 'SoroTask';
const RP_ID = process.env.NEXT_PUBLIC_RP_ID || 'localhost';
const CHALLENGE_TIMEOUT = 60000;

interface PasskeyCredential {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  userId: string;
  createdAt: Date;
}

interface CreateCredentialOptions {
  userId: string;
  username: string;
  displayName: string;
}

interface AuthenticationOptions {
  credentialId?: string;
  userId?: string;
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export class WebAuthnPasskeyService {
  private credentialStore: Map<string, PasskeyCredential> = new Map();

  async isWebAuthnSupported(): Promise<boolean> {
    return !!(
      window.PublicKeyCredential &&
      typeof window.PublicKeyCredential === 'function'
    );
  }

  async isPlatformAuthenticatorAvailable(): Promise<boolean> {
    try {
      if (!window.PublicKeyCredential) return false;
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  async createCredential(options: CreateCredentialOptions): Promise<PasskeyCredential> {
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const createOptions: CredentialCreationOptions = {
      publicKey: {
        challenge,
        rp: {
          id: RP_ID,
          name: RP_NAME,
        },
        user: {
          id: new TextEncoder().encode(options.userId),
          name: options.username,
          displayName: options.displayName,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: CHALLENGE_TIMEOUT,
        attestation: 'none',
      },
    };

    const credential = await navigator.credentials.create(createOptions) as PublicKeyCredential;

    if (!credential) {
      throw new Error('Failed to create credential');
    }

    const response = credential.response as AuthenticatorAttestationResponse;
    const attestationObject = new Uint8Array(response.attestationObject);
    const clientDataJSON = new Uint8Array(response.clientDataJSON);

    const passkeyCredential: PasskeyCredential = {
      id: credential.id,
      publicKey: new Uint8Array(attestationObject),
      counter: 0,
      userId: options.userId,
      createdAt: new Date(),
    };

    this.credentialStore.set(credential.id, passkeyCredential);

    return passkeyCredential;
  }

  async authenticate(options: AuthenticationOptions = {}): Promise<{
    credentialId: string;
    authenticatorData: Uint8Array;
    clientDataJSON: Uint8Array;
    signature: Uint8Array;
  }> {
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const allowCredentials = options.credentialId
      ? [{
          type: 'public-key' as const,
          id: base64ToBuffer(options.credentialId),
          transports: ['internal'] as const,
        }]
      : undefined;

    const getOptions: CredentialRequestOptions = {
      publicKey: {
        challenge,
        rpId: RP_ID,
        allowCredentials,
        userVerification: 'required',
        timeout: CHALLENGE_TIMEOUT,
      },
    };

    const assertion = await navigator.credentials.get(getOptions) as PublicKeyCredential;

    if (!assertion) {
      throw new Error('Authentication failed');
    }

    const response = assertion.response as AuthenticatorAssertionResponse;

    return {
      credentialId: assertion.id,
      authenticatorData: new Uint8Array(response.authenticatorData),
      clientDataJSON: new Uint8Array(response.clientDataJSON),
      signature: new Uint8Array(response.signature),
    };
  }

  async registerPasskey(userId: string, username: string): Promise<PasskeyCredential> {
    const credential = await this.createCredential({
      userId,
      username,
      displayName: username,
    });

    return credential;
  }

  async verifyAssertion(
    credentialId: string,
    authenticatorData: Uint8Array,
    clientDataJSON: Uint8Array,
    signature: Uint8Array,
  ): Promise<boolean> {
    const credential = this.credentialStore.get(credentialId);
    if (!credential) {
      return false;
    }

    const counterValid = this.verifyCounter(credential.counter, authenticatorData);
    if (!counterValid) {
      return false;
    }

    credential.counter = this.extractCounter(authenticatorData);

    return true;
  }

  private verifyCounter(storedCounter: number, authenticatorData: Uint8Array): boolean {
    const currentCounter = this.extractCounter(authenticatorData);
    return currentCounter > storedCounter;
  }

  private extractCounter(authenticatorData: Uint8Array): number {
    const dataView = new DataView(authenticatorData.buffer);
    return dataView.getUint32(authenticatorData.length - 4, false);
  }

  getCredential(credentialId: string): PasskeyCredential | undefined {
    return this.credentialStore.get(credentialId);
  }

  listCredentials(): PasskeyCredential[] {
    return Array.from(this.credentialStore.values());
  }

  deleteCredential(credentialId: string): boolean {
    return this.credentialStore.delete(credentialId);
  }

  async deriveStellarAccountKey(credential: PasskeyCredential): Promise<string> {
    const keyData = credential.publicKey.slice(0, 32);
    let hash = 0;
    for (let i = 0; i < keyData.length; i++) {
      hash = ((hash << 5) - hash + keyData[i]) | 0;
    }
    const accountIndex = Math.abs(hash) % 1000;
    return `G${accountIndex.toString().padStart(55, '0')}`;
  }
}

export const webauthnService = new WebAuthnPasskeyService();
