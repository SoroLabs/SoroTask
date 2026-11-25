/**
 * WebAuthnService Unit Tests
 */

if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

import {
  bufferToBase64url,
  base64urlToBuffer,
  generateChallenge,
  WebAuthnService,
} from '@/src/lib/auth/webauthn';

describe('WebAuthn encoding/decoding utilities', () => {
  it('should convert array buffer to base64url and back', () => {
    const originalText = 'Hello WebAuthn Secure Enclave!';
    const encoder = new TextEncoder();
    const originalBuffer = encoder.encode(originalText).buffer;

    const base64url = bufferToBase64url(originalBuffer);
    expect(typeof base64url).toBe('string');
    expect(base64url).not.toContain('+');
    expect(base64url).not.toContain('/');
    expect(base64url).not.toContain('=');

    const decodedBuffer = base64urlToBuffer(base64url);
    const decoder = new TextDecoder();
    const decodedText = decoder.decode(decodedBuffer);

    expect(decodedText).toBe(originalText);
  });

  it('should generate a 32-byte challenge', () => {
    const getRandomValuesMock = jest.fn((arr: Uint8Array) => {
      arr.fill(7);
      return arr;
    });

    const originalGetRandomValues = window.crypto.getRandomValues;
    window.crypto.getRandomValues = getRandomValuesMock as any;

    const challenge = generateChallenge();
    expect(challenge.byteLength).toBe(32);
    expect(getRandomValuesMock).toHaveBeenCalled();

    // Restore
    window.crypto.getRandomValues = originalGetRandomValues;
  });
});

describe('WebAuthnService methods', () => {
  let originalPublicKeyCredential: any;

  beforeEach(() => {
    originalPublicKeyCredential = (global as any).PublicKeyCredential;
  });

  afterEach(() => {
    (global as any).PublicKeyCredential = originalPublicKeyCredential;
    jest.restoreAllMocks();
  });

  it('isSupported should return true when PublicKeyCredential is defined', () => {
    (global as any).PublicKeyCredential = jest.fn();
    expect(WebAuthnService.isSupported()).toBe(true);
  });

  it('isSupported should return false when PublicKeyCredential is undefined', () => {
    (global as any).PublicKeyCredential = undefined;
    expect(WebAuthnService.isSupported()).toBe(false);
  });

  it('isPlatformAuthenticatorAvailable should return true if available', async () => {
    const mockAvailable = jest.fn().mockResolvedValue(true);
    (global as any).PublicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: mockAvailable,
    };

    const result = await WebAuthnService.isPlatformAuthenticatorAvailable();
    expect(result).toBe(true);
    expect(mockAvailable).toHaveBeenCalled();
  });

  it('isPlatformAuthenticatorAvailable should return false if fails or throws', async () => {
    const mockAvailable = jest.fn().mockRejectedValue(new Error('Device error'));
    (global as any).PublicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: mockAvailable,
    };

    const result = await WebAuthnService.isPlatformAuthenticatorAvailable();
    expect(result).toBe(false);
  });

  it('generateRegistrationOptions should return expected parameters', () => {
    const options = WebAuthnService.generateRegistrationOptions('user_addr_123', 'User Name');

    expect(options.rp.name).toBe('SoroTask Secure Enclave Auth');
    expect(options.user.name).toBe('user_addr_123');
    expect(options.user.displayName).toBe('User Name');
    expect(options.authenticatorSelection?.authenticatorAttachment).toBe('platform');
    expect(options.authenticatorSelection?.userVerification).toBe('required');
  });

  it('generateAuthenticationOptions should return correct formats', () => {
    const validBase64UrlCredentialId = bufferToBase64url(new Uint8Array([1, 2, 3, 4]).buffer);
    const credentials = [validBase64UrlCredentialId];
    const options = WebAuthnService.generateAuthenticationOptions(credentials);

    expect(options.userVerification).toBe('required');
    expect(options.allowCredentials).toHaveLength(1);
  });

  it('registerCredential should call navigator.credentials.create and format result', async () => {
    const mockCred = {
      id: 'new_cred_id_123',
      rawId: new Uint8Array([1, 2, 3]).buffer,
      type: 'public-key',
      response: {
        clientDataJSON: new Uint8Array([4, 5, 6]).buffer,
        attestationObject: new Uint8Array([7, 8, 9]).buffer,
        getTransports: () => ['internal'],
      },
    };

    const createMock = jest.fn().mockResolvedValue(mockCred);
    Object.defineProperty(global.navigator, 'credentials', {
      value: {
        create: createMock,
      },
      writable: true,
      configurable: true,
    });

    (global as any).PublicKeyCredential = jest.fn();

    const options = WebAuthnService.generateRegistrationOptions('addr', 'name');
    const result = await WebAuthnService.registerCredential(options);

    expect(createMock).toHaveBeenCalledWith({ publicKey: options });
    expect(result.id).toBe('new_cred_id_123');
    expect(result.rawId).toBe(bufferToBase64url(mockCred.rawId));
    expect(result.response.transports).toEqual(['internal']);
  });

  it('registerCredential should throw if unsupported', async () => {
    (global as any).PublicKeyCredential = undefined;
    const options = WebAuthnService.generateRegistrationOptions('addr', 'name');
    await expect(WebAuthnService.registerCredential(options)).rejects.toThrow("WebAuthn is not supported");
  });

  it('registerCredential should throw if null credential is returned', async () => {
    (global as any).PublicKeyCredential = jest.fn();
    Object.defineProperty(global.navigator, 'credentials', {
      value: { create: jest.fn().mockResolvedValue(null) },
      writable: true,
      configurable: true,
    });
    const options = WebAuthnService.generateRegistrationOptions('addr', 'name');
    await expect(WebAuthnService.registerCredential(options)).rejects.toThrow("Browser returned null");
  });

  it('authenticateCredential should call navigator.credentials.get and format result', async () => {
    const mockCred = {
      id: 'matched_cred_id',
      rawId: new Uint8Array([10, 11]).buffer,
      type: 'public-key',
      response: {
        clientDataJSON: new Uint8Array([12, 13]).buffer,
        authenticatorData: new Uint8Array([14, 15]).buffer,
        signature: new Uint8Array([16, 17]).buffer,
        userHandle: new Uint8Array([18]).buffer,
      },
    };

    const getMock = jest.fn().mockResolvedValue(mockCred);
    Object.defineProperty(global.navigator, 'credentials', {
      value: {
        get: getMock,
      },
      writable: true,
      configurable: true,
    });

    (global as any).PublicKeyCredential = jest.fn();

    const options = WebAuthnService.generateAuthenticationOptions([bufferToBase64url(mockCred.rawId)]);
    const result = await WebAuthnService.authenticateCredential(options);

    expect(getMock).toHaveBeenCalledWith({ publicKey: options });
    expect(result.id).toBe('matched_cred_id');
    expect(result.response.userHandle).toBe(bufferToBase64url(mockCred.response.userHandle));
  });

  it('authenticateCredential should throw if unsupported', async () => {
    (global as any).PublicKeyCredential = undefined;
    const options = WebAuthnService.generateAuthenticationOptions([]);
    await expect(WebAuthnService.authenticateCredential(options)).rejects.toThrow("WebAuthn is not supported");
  });

  it('authenticateCredential should throw if null is returned', async () => {
    (global as any).PublicKeyCredential = jest.fn();
    Object.defineProperty(global.navigator, 'credentials', {
      value: { get: jest.fn().mockResolvedValue(null) },
      writable: true,
      configurable: true,
    });
    const options = WebAuthnService.generateAuthenticationOptions([]);
    await expect(WebAuthnService.authenticateCredential(options)).rejects.toThrow("Browser returned null");
  });
});
