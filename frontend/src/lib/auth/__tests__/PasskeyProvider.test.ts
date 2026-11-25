import { PasskeyProvider } from "@/src/lib/auth/providers/PasskeyProvider";

const STELLAR_ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRS";

function makeRawId(): ArrayBuffer {
  const bytes = new Uint8Array([109, 111, 99, 107, 45, 99, 114, 101, 100]);
  return bytes.buffer;
}

function makeCredential(rawId?: ArrayBuffer) {
  return {
    rawId: rawId ?? makeRawId(),
    response: {
      clientDataJSON: new ArrayBuffer(0),
      authenticatorData: new ArrayBuffer(0),
      signature: new ArrayBuffer(0),
    },
    type: "public-key",
  } as unknown as PublicKeyCredential;
}

describe("PasskeyProvider", () => {
  let provider: PasskeyProvider;

  beforeEach(() => {
    provider = new PasskeyProvider("passkey", "Passkey", "localhost", "SoroTask", 3600_000);
    jest.clearAllMocks();
  });

  describe("isWebAuthnAvailable", () => {
    it("returns false when window is undefined", async () => {
      jest.spyOn(provider, "isWebAuthnAvailable").mockImplementationOnce(async () => typeof window === "undefined" ? false : false);
      expect(await provider.isWebAuthnAvailable()).toBe(false);
    });

    it("returns false when PublicKeyCredential is absent", async () => {
      const orig = (global as any).PublicKeyCredential;
      delete (global as any).PublicKeyCredential;
      expect(await provider.isWebAuthnAvailable()).toBe(false);
      (global as any).PublicKeyCredential = orig;
    });
  });

  describe("authenticate", () => {
    it("returns failure when WebAuthn is unavailable", async () => {
      jest.spyOn(provider, "isWebAuthnAvailable").mockResolvedValue(false);
      const result = await provider.authenticate({});
      expect(result.success).toBe(false);
      expect(result.error).toContain("not supported");
    });

    it("returns failure when navigator.credentials.get returns null", async () => {
      jest.spyOn(provider, "isWebAuthnAvailable").mockResolvedValue(true);
      Object.defineProperty(global.navigator, "credentials", {
        value: { get: jest.fn().mockResolvedValue(null), create: jest.fn() },
        configurable: true,
      });

      const result = await provider.authenticate({});
      expect(result.success).toBe(false);
    });

    it("returns failure when navigator.credentials.get throws", async () => {
      jest.spyOn(provider, "isWebAuthnAvailable").mockResolvedValue(true);
      Object.defineProperty(global.navigator, "credentials", {
        value: { get: jest.fn().mockRejectedValue(new Error("User cancelled")), create: jest.fn() },
        configurable: true,
      });

      const result = await provider.authenticate({});
      expect(result.success).toBe(false);
      expect(result.error).toContain("User cancelled");
    });

    it("returns success with credential and builds session token", async () => {
      jest.spyOn(provider, "isWebAuthnAvailable").mockResolvedValue(true);
      Object.defineProperty(global.navigator, "credentials", {
        value: { get: jest.fn().mockResolvedValue(makeCredential()), create: jest.fn() },
        configurable: true,
      });

      const result = await provider.authenticate({ stellarAddress: STELLAR_ADDRESS });
      expect(result.success).toBe(true);
      expect(result.providerId).toBe("passkey");
      expect(result.token).toBeTruthy();

      const parsed = JSON.parse(result.token!);
      expect(parsed.stellarAddress).toBe(STELLAR_ADDRESS);
      expect(parsed.credentialId).toBeTruthy();
    });

    it("rawProfile contains address and credentialId", async () => {
      jest.spyOn(provider, "isWebAuthnAvailable").mockResolvedValue(true);
      Object.defineProperty(global.navigator, "credentials", {
        value: { get: jest.fn().mockResolvedValue(makeCredential()), create: jest.fn() },
        configurable: true,
      });

      const result = await provider.authenticate({ stellarAddress: STELLAR_ADDRESS });
      expect(result.rawProfile?.address).toBe(STELLAR_ADDRESS);
      expect(result.rawProfile?.credentialId).toBeTruthy();
    });
  });

  describe("validateToken", () => {
    it("returns false for malformed token", async () => {
      expect(await provider.validateToken("not-json")).toBe(false);
    });

    it("returns false for token with unknown credentialId", async () => {
      const token = JSON.stringify({ credentialId: "unknown", stellarAddress: "", issuedAt: 0, expiresAt: Date.now() + 9999 });
      expect(await provider.validateToken(token)).toBe(false);
    });

    it("returns true for a valid active session token", async () => {
      jest.spyOn(provider, "isWebAuthnAvailable").mockResolvedValue(true);
      Object.defineProperty(global.navigator, "credentials", {
        value: { get: jest.fn().mockResolvedValue(makeCredential()), create: jest.fn() },
        configurable: true,
      });

      const authResult = await provider.authenticate({ stellarAddress: STELLAR_ADDRESS });
      expect(authResult.success).toBe(true);
      expect(await provider.validateToken(authResult.token!)).toBe(true);
    });
  });

  describe("logout", () => {
    it("removes session so validateToken returns false", async () => {
      jest.spyOn(provider, "isWebAuthnAvailable").mockResolvedValue(true);
      Object.defineProperty(global.navigator, "credentials", {
        value: { get: jest.fn().mockResolvedValue(makeCredential()), create: jest.fn() },
        configurable: true,
      });

      const authResult = await provider.authenticate({ stellarAddress: STELLAR_ADDRESS });
      expect(authResult.success).toBe(true);

      await provider.logout(authResult.token!);
      expect(await provider.validateToken(authResult.token!)).toBe(false);
    });

    it("does not throw on invalid token", async () => {
      await expect(provider.logout("bad-json")).resolves.toBeUndefined();
    });
  });
});
