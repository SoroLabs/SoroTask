/**
 * useWebAuthn Integration Tests
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useWebAuthn } from '@/hooks/useWebAuthn';
import { WebAuthnService } from '@/src/lib/auth/webauthn';
import { captureSentryException } from '@/src/lib/errors/tracking';

// Mock WebAuthnService
jest.mock('@/src/lib/auth/webauthn', () => ({
  WebAuthnService: {
    isSupported: jest.fn(),
    isPlatformAuthenticatorAvailable: jest.fn(),
    generateRegistrationOptions: jest.fn(),
    registerCredential: jest.fn(),
    generateAuthenticationOptions: jest.fn(),
    authenticateCredential: jest.fn(),
  },
}));

// Mock Sentry exception tracking
jest.mock('@/src/lib/errors/tracking', () => ({
  captureSentryException: jest.fn(),
}));

jest.mock('@/src/lib/errors', () => ({
  captureSentryException: jest.fn((...args: any[]) => {
    require('@/src/lib/errors/tracking').captureSentryException(...args);
  }),
}));

describe('useWebAuthn hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it('should initialize with compatibility states', async () => {
    (WebAuthnService.isSupported as jest.Mock).mockReturnValue(true);
    (WebAuthnService.isPlatformAuthenticatorAvailable as jest.Mock).mockResolvedValue(true);

    const { result } = renderHook(() => useWebAuthn());

    await waitFor(() => {
      expect(result.current.isSupported).toBe(true);
      expect(result.current.isPlatformAvailable).toBe(true);
    });

    expect(result.current.isEnrolled).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle successful credential enrollment', async () => {
    (WebAuthnService.isSupported as jest.Mock).mockReturnValue(true);
    (WebAuthnService.isPlatformAuthenticatorAvailable as jest.Mock).mockResolvedValue(true);
    (WebAuthnService.generateRegistrationOptions as jest.Mock).mockReturnValue({});
    (WebAuthnService.registerCredential as jest.Mock).mockResolvedValue({
      id: 'mock_cred_id_xyz',
      rawId: 'mock_raw_id',
      type: 'public-key',
      response: { clientDataJSON: 'xyz', attestationObject: 'abc' },
    });

    const { result } = renderHook(() => useWebAuthn());

    await act(async () => {
      await result.current.enrollDevice('addr123', 'John Doe');
    });

    expect(result.current.isEnrolled).toBe(true);
    expect(result.current.enrolledCredentials).toHaveLength(1);
    expect(result.current.enrolledCredentials[0]).toEqual({
      id: 'mock_cred_id_xyz',
      address: 'addr123',
      name: 'John Doe',
    });
    expect(result.current.error).toBeNull();
  });

  it('should handle registration/enrollment errors and report to Sentry', async () => {
    (WebAuthnService.isSupported as jest.Mock).mockReturnValue(true);
    (WebAuthnService.registerCredential as jest.Mock).mockRejectedValue(
      new DOMException('User cancelled', 'NotAllowedError')
    );

    const { result } = renderHook(() => useWebAuthn());

    await act(async () => {
      try {
        await result.current.enrollDevice('addr123', 'John Doe');
      } catch (e) {
        // Expected
      }
    });

    expect(result.current.error).toBe('Authentication cancelled or biometric verification rejected.');
    expect(captureSentryException).toHaveBeenCalled();
  });

  it('should translate SecurityError correctly', async () => {
    (WebAuthnService.isSupported as jest.Mock).mockReturnValue(true);
    (WebAuthnService.registerCredential as jest.Mock).mockRejectedValue(
      new DOMException('Origin mismatch', 'SecurityError')
    );
    const { result } = renderHook(() => useWebAuthn());
    await act(async () => {
      try { await result.current.enrollDevice('addr', 'name'); } catch (e) {}
    });
    expect(result.current.error).toContain('Origin or security verification failed');
  });

  it('should translate NotSupportedError correctly', async () => {
    (WebAuthnService.isSupported as jest.Mock).mockReturnValue(true);
    (WebAuthnService.registerCredential as jest.Mock).mockRejectedValue(
      new DOMException('Biometrics missing', 'NotSupportedError')
    );
    const { result } = renderHook(() => useWebAuthn());
    await act(async () => {
      try { await result.current.enrollDevice('addr', 'name'); } catch (e) {}
    });
    expect(result.current.error).toContain('not supported on this device');
  });

  it('should translate InvalidStateError correctly', async () => {
    (WebAuthnService.isSupported as jest.Mock).mockReturnValue(true);
    (WebAuthnService.registerCredential as jest.Mock).mockRejectedValue(
      new DOMException('Key already enrolled', 'InvalidStateError')
    );
    const { result } = renderHook(() => useWebAuthn());
    await act(async () => {
      try { await result.current.enrollDevice('addr', 'name'); } catch (e) {}
    });
    expect(result.current.error).toContain('already enrolled');
  });

  it('should translate TimeoutError correctly', async () => {
    (WebAuthnService.isSupported as jest.Mock).mockReturnValue(true);
    (WebAuthnService.registerCredential as jest.Mock).mockRejectedValue(
      new DOMException('Timed out', 'TimeoutError')
    );
    const { result } = renderHook(() => useWebAuthn());
    await act(async () => {
      try { await result.current.enrollDevice('addr', 'name'); } catch (e) {}
    });
    expect(result.current.error).toContain('timed out');
  });

  it('should translate generic DOMException correctly', async () => {
    (WebAuthnService.isSupported as jest.Mock).mockReturnValue(true);
    (WebAuthnService.registerCredential as jest.Mock).mockRejectedValue(
      new DOMException('Custom DOM Error', 'UnknownError')
    );
    const { result } = renderHook(() => useWebAuthn());
    await act(async () => {
      try { await result.current.enrollDevice('addr', 'name'); } catch (e) {}
    });
    expect(result.current.error).toBe('Custom DOM Error');
  });

  it('should translate generic Error correctly', async () => {
    (WebAuthnService.isSupported as jest.Mock).mockReturnValue(true);
    (WebAuthnService.registerCredential as jest.Mock).mockRejectedValue(
      new Error('Standard system error')
    );
    const { result } = renderHook(() => useWebAuthn());
    await act(async () => {
      try { await result.current.enrollDevice('addr', 'name'); } catch (e) {}
    });
    expect(result.current.error).toBe('Standard system error');
  });

  it('should translate non-Error throws correctly', async () => {
    (WebAuthnService.isSupported as jest.Mock).mockReturnValue(true);
    (WebAuthnService.registerCredential as jest.Mock).mockRejectedValue(
      'Unexpected string error'
    );
    const { result } = renderHook(() => useWebAuthn());
    await act(async () => {
      try { await result.current.enrollDevice('addr', 'name'); } catch (e) {}
    });
    expect(result.current.error).toBe('Unexpected string error');
  });

  it('should handle successful authentication', async () => {
    (WebAuthnService.isSupported as jest.Mock).mockReturnValue(true);
    (WebAuthnService.generateAuthenticationOptions as jest.Mock).mockReturnValue({});
    (WebAuthnService.authenticateCredential as jest.Mock).mockResolvedValue({
      id: 'mock_cred_id_xyz',
      rawId: 'mock_raw_id',
      type: 'public-key',
      response: { clientDataJSON: 'xyz' },
    });

    // Populate localStorage directly for pre-enrolled key
    window.localStorage.setItem(
      'sorotask_webauthn_credentials',
      JSON.stringify([{ id: 'mock_cred_id_xyz', address: 'addr123', name: 'John Doe' }])
    );

    const { result } = renderHook(() => useWebAuthn());

    // Wait for hook to load credentials on mount
    await waitFor(() => {
      expect(result.current.isEnrolled).toBe(true);
    });

    let authResult: any;
    await act(async () => {
      authResult = await result.current.authenticateDevice();
    });

    expect(authResult.userAddress).toBe('addr123');
    expect(authResult.credential.id).toBe('mock_cred_id_xyz');
    expect(result.current.error).toBeNull();
  });

  it('should reject authentication if no credentials are enrolled', async () => {
    const { result } = renderHook(() => useWebAuthn());

    await act(async () => {
      try {
        await result.current.authenticateDevice();
      } catch (e) {
        // Expected
      }
    });

    expect(result.current.error).toBe('No biometric key registered on this device yet.');
  });

  it('should handle localStorage parse error on initialization gracefully', async () => {
    window.localStorage.setItem('sorotask_webauthn_credentials', 'invalid {json}');
    (WebAuthnService.isSupported as jest.Mock).mockReturnValue(true);
    const { result } = renderHook(() => useWebAuthn());
    await waitFor(() => {
      expect(result.current.enrolledCredentials).toEqual([]);
    });
  });

  it('should clear enrolled credentials', async () => {
    window.localStorage.setItem(
      'sorotask_webauthn_credentials',
      JSON.stringify([{ id: 'mock_cred_id_xyz', address: 'addr123', name: 'John Doe' }])
    );
    const { result } = renderHook(() => useWebAuthn());
    await waitFor(() => {
      expect(result.current.isEnrolled).toBe(true);
    });
    act(() => {
      result.current.clearEnrolledCredentials();
    });
    expect(result.current.isEnrolled).toBe(false);
    expect(result.current.enrolledCredentials).toEqual([]);
  });

  it('should fail authentication if matched credential address is not found in local enrolled list', async () => {
    (WebAuthnService.isSupported as jest.Mock).mockReturnValue(true);
    (WebAuthnService.generateAuthenticationOptions as jest.Mock).mockReturnValue({});
    (WebAuthnService.authenticateCredential as jest.Mock).mockResolvedValue({
      id: 'unregistered_id_xyz',
      rawId: 'mock_raw_id',
      type: 'public-key',
      response: { clientDataJSON: 'xyz' },
    });
    window.localStorage.setItem(
      'sorotask_webauthn_credentials',
      JSON.stringify([{ id: 'mock_cred_id_xyz', address: 'addr123', name: 'John Doe' }])
    );
    const { result } = renderHook(() => useWebAuthn());
    await waitFor(() => {
      expect(result.current.isEnrolled).toBe(true);
    });
    await act(async () => {
      try { await result.current.authenticateDevice(); } catch (e) {}
    });
    expect(result.current.error).toBe('Authenticated credential was not recognized on this device.');
  });
});
