"use client";

import { useState, useEffect, useCallback } from "react";
import { WebAuthnService } from "@/src/lib/auth/webauthn";
import {
  PasskeyProvider,
  type EncryptedPasskeyCredential,
  type AuthorizationResult,
} from "@/src/lib/auth/PasskeyProvider";
import { captureSentryException } from "@/src/lib/errors";

const STORAGE_KEY = "sorotask_webauthn_credentials";

export interface EnrolledCredential {
  id: string;
  address: string;
  name: string;
  encrypted?: boolean;
}

export function useWebAuthn() {
  const [isSupported, setIsSupported] = useState(false);
  const [isPlatformAvailable, setIsPlatformAvailable] = useState(false);
  const [enrolledCredentials, setEnrolledCredentials] = useState<EnrolledCredential[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize and check compatibility
  useEffect(() => {
    const checkCompatibility = async () => {
      const supported = WebAuthnService.isSupported();
      setIsSupported(supported);

      if (supported) {
        const available = await WebAuthnService.isPlatformAuthenticatorAvailable();
        setIsPlatformAvailable(available);
      }

      // Load enrolled credentials from localStorage
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          setEnrolledCredentials(JSON.parse(stored));
        }
      } catch (err) {
        console.error("Failed to load WebAuthn credentials:", err);
      }
    };

    checkCompatibility();
  }, []);

  const translateError = (err: unknown): string => {
    if (typeof err === "string") {
      return err;
    }
    if (err instanceof DOMException) {
      switch (err.name) {
        case "NotAllowedError":
          return "Authentication cancelled or biometric verification rejected.";
        case "SecurityError":
          return "Origin or security verification failed. Please try again on a secure connection.";
        case "NotSupportedError":
          return "Biometric or platform authenticator is not supported on this device.";
        case "InvalidStateError":
          return "This device biometric key is already enrolled.";
        case "TimeoutError":
          return "Biometric verification timed out. Please try again.";
        default:
          return err.message || "An unexpected biometric error occurred.";
      }
    }
    return err instanceof Error ? err.message : "WebAuthn enrollment/authentication failed.";
  };

  const enrollDevice = useCallback(
    async (userAddress: string, userName: string) => {
      setIsLoading(true);
      setError(null);
      try {
        // Use PasskeyProvider for local encryption
        const encrypted = await PasskeyProvider.enrollBiometricPasskey(userAddress, userName);

        const newCred: EnrolledCredential = {
          id: encrypted.id,
          address: userAddress,
          name: userName,
          encrypted: true,
        };
        const updated = [...enrolledCredentials.filter((c) => c.id !== encrypted.id), newCred];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        setEnrolledCredentials(updated);

        setIsLoading(false);
        return encrypted;
      } catch (err) {
        const friendlyError = translateError(err);
        setError(friendlyError);
        setIsLoading(false);

        const finalError = err instanceof Error ? err : new Error(String(err));
        captureSentryException(finalError, {
          tags: { type: "webauthn_error", action: "enroll" },
          extra: { friendlyMessage: friendlyError, userAddress },
        });
        throw finalError;
      }
    },
    [enrolledCredentials]
  );

  const authenticateDevice = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (enrolledCredentials.length === 0) {
        throw new Error("No biometric key registered on this device yet.");
      }

      const credentialIds = enrolledCredentials.map((c) => c.id);
      const options = WebAuthnService.generateAuthenticationOptions(credentialIds);
      const credential = await WebAuthnService.authenticateCredential(options);

      const matched = enrolledCredentials.find((c) => c.id === credential.id);
      if (!matched) {
        throw new Error("Authenticated credential was not recognized on this device.");
      }

      setIsLoading(false);
      return { credential, userAddress: matched.address };
    } catch (err) {
      const friendlyError = translateError(err);
      setError(friendlyError);
      setIsLoading(false);

      const finalError = err instanceof Error ? err : new Error(String(err));
      captureSentryException(finalError, {
        tags: { type: "webauthn_error", action: "authenticate" },
        extra: { friendlyMessage: friendlyError },
      });
      throw finalError;
    }
  }, [enrolledCredentials]);

  const authorizeWithFallback = useCallback(
    async (
      operation: "create_task" | "emergency_pause" | "refill_gas",
      userAddress: string,
      payloadHash: string
    ): Promise<AuthorizationResult> => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await PasskeyProvider.authorizeOperation(operation, userAddress, payloadHash);
        setIsLoading(false);
        return result;
      } catch (err) {
        const friendlyError = translateError(err);
        setError(friendlyError);
        setIsLoading(false);
        throw err;
      }
    },
    []
  );

  return {
    isSupported,
    isPlatformAvailable,
    isFreighterAvailable: PasskeyProvider.isFreighterAvailable(),
    isEnrolled: enrolledCredentials.length > 0,
    enrolledCredentials,
    isLoading,
    error,
    enrollDevice,
    authenticateDevice,
    authorizeWithFallback,
    clearEnrolledCredentials: useCallback(() => {
      localStorage.removeItem(STORAGE_KEY);
      PasskeyProvider.clearCredentials();
      setEnrolledCredentials([]);
    }, []),
  };
}
