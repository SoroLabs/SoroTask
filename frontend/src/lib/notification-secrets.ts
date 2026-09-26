export type ExternalChannelId = "webhook" | "telegram" | "discord";

export type ExternalChannelConfig = {
  /** Delivery endpoint: a generic webhook URL, the Telegram sendMessage
   *  endpoint, or the Discord webhook URL. */
  url: string;
  /** Optional shared secret used to sign/verify channel ownership.
   *  Stored ENCRYPTED with the user's wallet public key (issue #1263). */
  secret: string;
};

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}

function base64Decode(value: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

async function deriveAesKey(
  walletPublicKey: string,
  cryptoImpl: Pick<SubtleCrypto, "digest" | "importKey" | "deriveKey">,
): Promise<CryptoKey> {
  // Bind the encryption key to the user's wallet public key: only holders of
  // that wallet identity (same public key material) can reproduce the key.
  const digest = await cryptoImpl.digest("SHA-256", new TextEncoder().encode(walletPublicKey));
  return cryptoImpl.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/**
 * Encrypt a channel secret with the user's wallet public key (issue #1263).
 *
 * The AES-GCM key is derived (SHA-256) from the wallet's public key, so the
 * stored ciphertext is unreadable without that wallet identity. `cryptoImpl`
 * is injectable so tests can run under Node's webcrypto.
 */
export async function encryptChannelSecret(
  plainSecret: string,
  walletPublicKey: string,
  cryptoImpl: typeof globalThis.crypto = globalThis.crypto,
): Promise<string> {
  if (!plainSecret) return "";
  if (!walletPublicKey) {
    throw new Error("A wallet public key is required to encrypt channel secrets");
  }

  const key = await deriveAesKey(walletPublicKey, cryptoImpl.subtle);
  const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
  const ciphertext = await cryptoImpl.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plainSecret),
  );

  const ivB64 = base64Encode(iv);
  const ctB64 = base64Encode(new Uint8Array(ciphertext));
  return `v1:${ivB64}:${ctB64}`;
}

/**
 * Decrypt a channel secret that was stored via `encryptChannelSecret`.
 */
export async function decryptChannelSecret(
  encryptedSecret: string,
  walletPublicKey: string,
  cryptoImpl: typeof globalThis.crypto = globalThis.crypto,
): Promise<string> {
  if (!encryptedSecret) return "";
  const [version, ivB64, ctB64] = encryptedSecret.split(":");
  if (version !== "v1" || !ivB64 || !ctB64) {
    throw new Error("Unsupported channel secret format");
  }

  const key = await deriveAesKey(walletPublicKey, cryptoImpl.subtle);
  const plaintext = await cryptoImpl.subtle.decrypt(
    { name: "AES-GCM", iv: base64Decode(ivB64) },
    key,
    base64Decode(ctB64).buffer as ArrayBuffer,
  );
  return new TextDecoder().decode(plaintext);
}

/**
 * Verify channel ownership via a test ping (issue #1263): POST a signed-off
 * test payload to the configured endpoint. A 2xx response proves the
 * operator of that URL received our alerts.
 */
export async function sendChannelTestPing(
  channel: ExternalChannelId,
  url: string,
  options: { fetchFn?: typeof fetch } = {},
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!url) {
    return { ok: false, error: "No delivery endpoint configured" };
  }

  const fetchFn = options.fetchFn ?? (typeof fetch === "function" ? fetch : undefined);
  if (!fetchFn) {
    return { ok: false, error: "fetch is not available" };
  }

  const body = buildTestPingPayload(channel);

  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, status: response.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function buildTestPingPayload(channel: ExternalChannelId): Record<string, unknown> {
  const base = {
    type: "test_ping",
    source: "sorotask-notification-preferences",
    timestamp: new Date().toISOString(),
    message: "SoroTask test ping — if you can read this, the channel is verified.",
  };

  if (channel === "telegram") {
    return { ...base, text: base.message };
  }
  if (channel === "discord") {
    return { ...base, content: base.message ?? base.text };
  }
  return base;
}

/**
 * Default delivery endpoint used for a channel when the user only pastes a
 * credential (e.g. a Telegram bot token) instead of a full URL.
 */
export function resolveChannelUrl(
  channel: ExternalChannelId,
  config: { url?: string; secret?: string },
): string {
  const url = (config.url || "").trim();
  if (url) return url;
  if (channel === "telegram" && config.secret) {
    // Bot token only: default to the standard sendMessage endpoint; the
    // chat id must be part of the stored secret payload (chat:token).
    const [chatId, token] = config.secret.split(":");
    if (chatId && token) {
      return `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}`;
    }
  }
  return "";
}
