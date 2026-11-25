/**
 * WebAuthn Service
 *
 * Business logic wrapper around the native browser WebAuthn (Credentials Container) API.
 * Interfaces with platform authenticators (Secure Enclave / TPM / Windows Hello).
 */

export function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function base64urlToBuffer(base64url: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = atob(base64);
  const outputBuffer = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputBuffer[i] = rawData.charCodeAt(i);
  }
  return outputBuffer.buffer;
}

export function generateChallenge(): ArrayBuffer {
  const challenge = new Uint8Array(32);
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(challenge);
  }
  return challenge.buffer;
}

export interface SerializedRegistrationCredential {
  id: string;
  rawId: string;
  type: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
  };
}

export interface SerializedAuthenticationCredential {
  id: string;
  rawId: string;
  type: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
}

export class WebAuthnService {
  /**
   * Check if the browser supports the WebAuthn API
   */
  static isSupported(): boolean {
    return typeof window !== 'undefined' && !!window.PublicKeyCredential;
  }

  /**
   * Check if a platform authenticator (e.g. Apple Secure Enclave, Windows Hello) is available.
   */
  static async isPlatformAuthenticatorAvailable(): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Generates public key options to register a new platform credential.
   */
  static generateRegistrationOptions(userAddress: string, userName: string): PublicKeyCredentialCreationOptions {
    const challenge = generateChallenge();
    const userId = new TextEncoder().encode(userAddress);
    const rpId = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

    return {
      challenge,
      rp: {
        name: "SoroTask Secure Enclave Auth",
        id: rpId,
      },
      user: {
        id: userId,
        name: userAddress,
        displayName: userName || userAddress,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },   // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        requireResidentKey: false,
      },
      timeout: 60000,
      attestation: "none",
    };
  }

  /**
   * Triggers the biometric credential creation process using navigator.credentials.create
   */
  static async registerCredential(
    options: PublicKeyCredentialCreationOptions
  ): Promise<SerializedRegistrationCredential> {
    if (!this.isSupported()) {
      throw new Error("WebAuthn is not supported in this browser environment.");
    }

    const credential = (await navigator.credentials.create({
      publicKey: options,
    })) as PublicKeyCredential | null;

    if (!credential) {
      throw new Error("Failed to create credential: Browser returned null.");
    }

    const response = credential.response as AuthenticatorAttestationResponse;

    return {
      id: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: bufferToBase64url(response.clientDataJSON),
        attestationObject: bufferToBase64url(response.attestationObject),
        transports: typeof response.getTransports === 'function' ? response.getTransports() : [],
      },
    };
  }

  /**
   * Generates public key credential request options to authenticate using a registered key.
   */
  static generateAuthenticationOptions(allowCredentialsList?: string[]): PublicKeyCredentialRequestOptions {
    const challenge = generateChallenge();
    const rpId = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

    const allowCredentials = allowCredentialsList?.map(id => ({
      type: "public-key" as const,
      id: base64urlToBuffer(id),
      transports: ["internal" as const],
    })) || [];

    return {
      challenge,
      timeout: 60000,
      rpId,
      allowCredentials,
      userVerification: "required",
    };
  }

  /**
   * Triggers the authentication flow using navigator.credentials.get
   */
  static async authenticateCredential(
    options: PublicKeyCredentialRequestOptions
  ): Promise<SerializedAuthenticationCredential> {
    if (!this.isSupported()) {
      throw new Error("WebAuthn is not supported in this browser environment.");
    }

    const credential = (await navigator.credentials.get({
      publicKey: options,
    })) as PublicKeyCredential | null;

    if (!credential) {
      throw new Error("Failed to get credential: Browser returned null.");
    }

    const response = credential.response as AuthenticatorAssertionResponse;

    return {
      id: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: bufferToBase64url(response.clientDataJSON),
        authenticatorData: bufferToBase64url(response.authenticatorData),
        signature: bufferToBase64url(response.signature),
        userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null,
      },
    };
  }
}
