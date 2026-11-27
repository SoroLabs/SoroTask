import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  verify,
} from "node:crypto";
import nodemailer from "nodemailer";
import webPush from "web-push";
import { StrKey } from "@stellar/stellar-sdk";
import Redis from "ioredis";
import { safeFetch } from "../../../../keeper/src/ssrfGuard.js";
import {
  defaultNotificationPreferences,
  notificationCategories,
  type ExternalNotificationChannel,
  type NotificationCategoryId,
  type NotificationChannel,
  type NotificationPreferences,
} from "../notification-preferences";

const KEY_PREFIX = "sorotask:notifications:";
const CHALLENGE_TTL_SECONDS = 300;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const SESSION_COOKIE = "sorotask_notification_session";
const NOTIFICATION_SIGN_MESSAGE_PREFIX = "Stellar Signed Message:\n";
const PUSH_ENDPOINT_HOSTS = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];

type StoredPreferences = Omit<NotificationPreferences, "externalEndpoints"> & {
  externalEndpoints: Record<
    ExternalNotificationChannel,
    { url: string; encryptedSecret: string }
  >;
};

type ExternalSecretStatus = Record<ExternalNotificationChannel, boolean>;

const runtime = globalThis as typeof globalThis & {
  notificationRedis?: Redis;
  notificationMailer?: nodemailer.Transporter;
};

export function getNotificationRedis(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required for notification storage");
  if (!runtime.notificationRedis) {
    runtime.notificationRedis = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
    runtime.notificationRedis.on("error", (error) => {
      console.error("Notification Redis connection failed", error.message);
    });
  }
  return runtime.notificationRedis;
}

function getEncryptionKey(): Buffer {
  const encoded = process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error("NOTIFICATION_SECRET_ENCRYPTION_KEY is required");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("NOTIFICATION_SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

function encryptSecret(secret: string): string {
  if (!secret) return "";
  const iv = randomBytes(12);
  const encrypted = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([encrypted.update(secret, "utf8"), encrypted.final()]);
  return `v1:${iv.toString("base64")}:${encrypted.getAuthTag().toString("base64")}:${ciphertext.toString("base64")}`;
}

function decryptSecret(value: string): string {
  if (!value) return "";
  const [version, ivValue, tagValue, ciphertextValue] = value.split(":");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Unsupported notification secret format");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivValue, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function createWalletChallenge(address: string, origin: string): string {
  decodeWalletAddress(address);
  const nonce = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  return [
    `${new URL(origin).host} wants you to sign in with your Stellar account:`,
    address,
    "",
    "Sign this message to link notification preferences to your wallet.",
    "",
    `URI: ${origin}`,
    "Version: 1",
    `Nonce: ${nonce}`,
    `Issued At: ${now}`,
  ].join("\n");
}

export async function storeWalletChallenge(address: string, challenge: string) {
  decodeWalletAddress(address);
  await getNotificationRedis().set(
    `${KEY_PREFIX}challenge:${address}`,
    challenge,
    "EX",
    CHALLENGE_TTL_SECONDS,
  );
}

function decodeWalletAddress(address: string): Buffer {
  try {
    return Buffer.from(StrKey.decodeEd25519PublicKey(address));
  } catch {
    throw new Error("A valid Stellar public key is required");
  }
}

export async function createWalletSession(
  address: string,
  challenge: string,
  signature: string,
): Promise<string> {
  const redis = getNotificationRedis();
  const key = `${KEY_PREFIX}challenge:${address}`;
  const expectedChallenge = await redis.getdel(key);
  if (!expectedChallenge || expectedChallenge !== challenge) {
    throw new Error("Wallet challenge expired or already used");
  }

  const publicKey = decodeWalletAddress(address);
  const signatureBytes = Buffer.from(signature, "base64");
  const signedMessage = createHash("sha256")
    .update(`${NOTIFICATION_SIGN_MESSAGE_PREFIX}${challenge}`)
    .digest();
  const publicKeyObject = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey]),
    format: "der",
    type: "spki",
  });
  if (
    signatureBytes.length !== 64 ||
    !verify(null, signedMessage, publicKeyObject, signatureBytes)
  ) {
    throw new Error("Wallet signature is invalid");
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await redis.set(
    `${KEY_PREFIX}session:${tokenHash}`,
    address,
    "EX",
    SESSION_TTL_SECONDS,
  );
  return token;
}

export function walletSessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/notifications; Max-Age=${SESSION_TTL_SECONDS}${secure ? "; Secure" : ""}`;
}

export async function getWalletAddress(request: Request): Promise<string | null> {
  const cookie = request.headers.get("cookie") ?? "";
  const token = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return getNotificationRedis().get(`${KEY_PREFIX}session:${tokenHash}`);
}

export async function revokeWalletSession(request: Request): Promise<void> {
  const cookie = request.headers.get("cookie") ?? "";
  const token = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token) return;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await getNotificationRedis().del(`${KEY_PREFIX}session:${tokenHash}`);
}

export function isSameOriginMutation(request: Request): boolean {
  const originValue = request.headers.get("origin");
  if (!originValue) return process.env.NODE_ENV !== "production";

  let origin: URL;
  try {
    origin = new URL(originValue);
  } catch {
    return false;
  }
  try {
    const expectedOrigin = new URL(
      process.env.NOTIFICATION_APP_ORIGIN || request.url,
    );
    return origin.origin === expectedOrigin.origin;
  } catch {
    return false;
  }
}

export function getPublicPushKey(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
}

function secretStatus(preferences: StoredPreferences): ExternalSecretStatus {
  return {
    webhook: Boolean(preferences.externalEndpoints.webhook.encryptedSecret),
    telegram: Boolean(preferences.externalEndpoints.telegram.encryptedSecret),
    discord: Boolean(preferences.externalEndpoints.discord.encryptedSecret),
  };
}

function sanitizePreferences(
  preferences: StoredPreferences,
): NotificationPreferences & { externalSecretsConfigured: ExternalSecretStatus } {
  return {
    channels: preferences.channels,
    categories: preferences.categories,
    categoryChannels: preferences.categoryChannels,
    externalEndpoints: {
      webhook: {
        url: preferences.externalEndpoints.webhook.url,
        secret: "",
        configured: Boolean(preferences.externalEndpoints.webhook.encryptedSecret),
      },
      telegram: {
        url: preferences.externalEndpoints.telegram.url,
        secret: "",
        configured: Boolean(preferences.externalEndpoints.telegram.encryptedSecret),
      },
      discord: {
        url: preferences.externalEndpoints.discord.url,
        secret: "",
        configured: Boolean(preferences.externalEndpoints.discord.encryptedSecret),
      },
    },
    emailAddress: preferences.emailAddress,
    updatedAt: preferences.updatedAt,
    externalSecretsConfigured: secretStatus(preferences),
  };
}

function validatePreferences(value: unknown): NotificationPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Notification preferences must be an object");
  }
  const input = value as Partial<NotificationPreferences>;
  const channels = input.channels;
  const categories = input.categories;
  if (!channels || !categories || !input.externalEndpoints) {
    throw new Error("Notification preferences are incomplete");
  }
  for (const [channel, enabled] of Object.entries(channels)) {
    if (!(channel in defaultNotificationPreferences.channels) || typeof enabled !== "boolean") {
      throw new Error("Invalid notification channel preference");
    }
  }
  for (const [category, enabled] of Object.entries(categories)) {
    if (
      !notificationCategories.some((definition) => definition.id === category) ||
      typeof enabled !== "boolean"
    ) {
      throw new Error("Invalid notification category preference");
    }
  }
  for (const categoryChannels of Object.values(input.categoryChannels ?? {})) {
    if (
      !Array.isArray(categoryChannels) ||
      categoryChannels.some(
        (channel) => !(channel in defaultNotificationPreferences.channels),
      )
    ) {
      throw new Error("Invalid per-category channel routing");
    }
  }
  const emailAddress = input.emailAddress ?? "";
  if (
    typeof emailAddress !== "string" ||
    (emailAddress !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress))
  ) {
    throw new Error("Enter a valid email address");
  }
  const externalEndpoints = {} as NotificationPreferences["externalEndpoints"];
  for (const channel of ["webhook", "telegram", "discord"] as const) {
    const endpoint = input.externalEndpoints[channel];
    if (!endpoint || typeof endpoint.url !== "string" || typeof endpoint.secret !== "string") {
      throw new Error(`Invalid ${channel} endpoint`);
    }
    externalEndpoints[channel] = { url: endpoint.url.trim(), secret: endpoint.secret };
  }
  return {
    ...defaultNotificationPreferences,
    ...input,
    channels: { ...defaultNotificationPreferences.channels, ...channels },
    categories: { ...defaultNotificationPreferences.categories, ...categories },
    categoryChannels: input.categoryChannels ?? {},
    externalEndpoints,
    emailAddress,
    updatedAt: new Date().toISOString(),
  };
}

export async function readPreferences(address: string) {
  const raw = await getNotificationRedis().get(`${KEY_PREFIX}preferences:${address}`);
  if (!raw) {
    const empty = validatePreferences(defaultNotificationPreferences);
    const stored = toStoredPreferences(empty);
    return sanitizePreferences(stored);
  }
  return sanitizePreferences(JSON.parse(raw) as StoredPreferences);
}

function toStoredPreferences(
  preferences: NotificationPreferences,
  previous?: StoredPreferences,
): StoredPreferences {
  const externalEndpoints = {} as StoredPreferences["externalEndpoints"];
  for (const channel of ["webhook", "telegram", "discord"] as const) {
    const endpoint = preferences.externalEndpoints[channel];
    externalEndpoints[channel] = {
      url: endpoint.url.trim(),
      encryptedSecret: endpoint.secret
        ? encryptSecret(endpoint.secret)
        : previous?.externalEndpoints[channel]?.encryptedSecret ?? "",
    };
  }
  return {
    ...preferences,
    externalEndpoints,
  };
}

export async function writePreferences(address: string, value: unknown) {
  const redis = getNotificationRedis();
  const preferences = validatePreferences(value);
  const previousRaw = await redis.get(`${KEY_PREFIX}preferences:${address}`);
  const previous = previousRaw ? (JSON.parse(previousRaw) as StoredPreferences) : undefined;
  const stored = toStoredPreferences(preferences, previous);
  await redis.set(
    `${KEY_PREFIX}preferences:${address}`,
    JSON.stringify(stored),
  );
  return sanitizePreferences(stored);
}

function isAllowedPushEndpoint(endpoint: string): boolean {
  let hostname: string;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    hostname = url.hostname.toLowerCase();
  } catch {
    return false;
  }
  return PUSH_ENDPOINT_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
}

export async function addPushSubscription(address: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A push subscription is required");
  }
  const subscription = value as PushSubscriptionJSON;
  if (
    typeof subscription.endpoint !== "string" ||
    !isAllowedPushEndpoint(subscription.endpoint) ||
    !subscription.keys?.auth ||
    !subscription.keys.p256dh
  ) {
    throw new Error("Invalid browser push subscription");
  }
  const digest = createHash("sha256").update(subscription.endpoint).digest("hex");
  await getNotificationRedis().hset(
    `${KEY_PREFIX}subscriptions:${address}`,
    digest,
    JSON.stringify(subscription),
  );
}

export async function removePushSubscription(address: string, endpoint: string) {
  if (!isAllowedPushEndpoint(endpoint)) throw new Error("Invalid push endpoint");
  const digest = createHash("sha256").update(endpoint).digest("hex");
  await getNotificationRedis().hdel(`${KEY_PREFIX}subscriptions:${address}`, digest);
}

function getMailer(): nodemailer.Transporter {
  if (runtime.notificationMailer) return runtime.notificationMailer;
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
    throw new Error("SMTP_HOST, SMTP_USER, and SMTP_PASSWORD are required for email delivery");
  }
  runtime.notificationMailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
  return runtime.notificationMailer;
}

function resolveTelegram(secret: string): { chatId: string; botToken: string } {
  const separator = secret.indexOf(":");
  if (separator <= 0 || separator === secret.length - 1) {
    throw new Error("Telegram secret must be in chat-id:bot-token format");
  }
  return {
    chatId: secret.slice(0, separator),
    botToken: secret.slice(separator + 1),
  };
}

async function deliverExternal(
  channel: ExternalNotificationChannel,
  endpoint: { url: string; encryptedSecret: string },
  payload: Record<string, unknown>,
) {
  const secret = decryptSecret(endpoint.encryptedSecret);
  let url = endpoint.url;
  let body: Record<string, unknown> = payload;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (channel === "telegram") {
    const { chatId, botToken } = resolveTelegram(secret);
    url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    body = { chat_id: chatId, text: payload.message };
  } else if (channel === "discord") {
    body = { content: payload.message };
  } else {
    if (!secret) throw new Error("A webhook signing secret is required");
    const timestamp = Date.now().toString();
    headers["X-SoroTask-Timestamp"] = timestamp;
    headers["X-SoroTask-Signature"] = createHmac("sha256", secret)
      .update(`${timestamp}.${JSON.stringify(payload)}`)
      .digest("hex");
  }

  if (!url) throw new Error(`${channel} endpoint is not configured`);
  const response = await safeFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${channel} delivery returned HTTP ${response.status}`);
}

export type NotificationDispatch = {
  recipient: string;
  category: NotificationCategoryId;
  title: string;
  message: string;
  url?: string;
};

export async function dispatchNotification(notification: NotificationDispatch) {
  const preferences = await readStoredPreferences(notification.recipient);
  if (!preferences.categories[notification.category]) return [];

  const override = preferences.categoryChannels[notification.category];
  const channels = (override ?? Object.keys(preferences.channels)) as NotificationChannel[];
  const active = channels.filter(
    (channel) =>
      preferences.channels[channel] &&
      (!isExternal(channel) ||
        Boolean(
          preferences.externalEndpoints[channel].url ||
            preferences.externalEndpoints[channel].encryptedSecret,
        )),
  );
  const payload = {
    id: randomBytes(16).toString("hex"),
    type: notification.category,
    title: notification.title,
    message: notification.message,
    url: notification.url ?? "/settings",
    timestamp: new Date().toISOString(),
  };
  const results = await Promise.all(
    active.map(async (channel) => {
      try {
        if (channel === "browser") {
          await deliverPush(notification.recipient, payload);
        } else if (channel === "inApp") {
          await storeInApp(notification.recipient, payload);
        } else if (channel === "email") {
          await deliverEmail(preferences, payload);
        } else if (isExternal(channel)) {
          await deliverExternal(channel, preferences.externalEndpoints[channel], payload);
        }
        return { channel, success: true };
      } catch (error) {
        console.error("Notification delivery failed", {
          category: notification.category,
          channel,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          channel,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  return results;
}

async function storeInApp(address: string, payload: Record<string, unknown>) {
  const key = `${KEY_PREFIX}feed:${address}`;
  const redis = getNotificationRedis();
  await redis.lpush(key, JSON.stringify(payload));
  await redis.ltrim(key, 0, 49);
  await redis.expire(key, 60 * 60 * 24 * 90);
}

export async function readInAppNotifications(address: string) {
  const entries = await getNotificationRedis().lrange(
    `${KEY_PREFIX}feed:${address}`,
    0,
    49,
  );
  return entries.map((entry) => JSON.parse(entry) as {
    id: string;
    type: NotificationCategoryId;
    title: string;
    message: string;
    url: string;
    timestamp: string;
  });
}

async function readStoredPreferences(address: string): Promise<StoredPreferences> {
  const raw = await getNotificationRedis().get(`${KEY_PREFIX}preferences:${address}`);
  if (!raw) return toStoredPreferences(validatePreferences(defaultNotificationPreferences));
  return JSON.parse(raw) as StoredPreferences;
}

function isExternal(
  channel: NotificationChannel,
): channel is ExternalNotificationChannel {
  return channel === "webhook" || channel === "telegram" || channel === "discord";
}

async function deliverPush(
  address: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("VAPID public key, private key, and subject are required for Web Push");
  }
  webPush.setVapidDetails(subject, publicKey, privateKey);
  const redis = getNotificationRedis();
  const key = `${KEY_PREFIX}subscriptions:${address}`;
  const subscriptions = await redis.hgetall(key);
  if (Object.keys(subscriptions).length === 0) {
    throw new Error("No browser push subscriptions are registered");
  }
  await Promise.all(
    Object.entries(subscriptions).map(async ([digest, value]) => {
      try {
        await webPush.sendNotification(
          JSON.parse(value) as webPush.PushSubscription,
          JSON.stringify(payload),
        );
      } catch (error) {
        const statusCode =
          typeof error === "object" && error !== null && "statusCode" in error
            ? Number(error.statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          await redis.hdel(key, digest);
          return;
        }
        throw error;
      }
    }),
  );
}

async function deliverEmail(
  preferences: StoredPreferences,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!preferences.emailAddress) {
    throw new Error("Set an email address in notification preferences");
  }
  const mailer = getMailer();
  await mailer.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to: preferences.emailAddress,
    subject: `[SoroTask] ${String(payload.title ?? "Notification")}`,
    text: `${String(payload.message ?? "")}\n\n${String(payload.url ?? "")}`,
  });
}

export async function sendChannelTest(
  address: string,
  channel: ExternalNotificationChannel,
  config: { url?: string; secret?: string },
) {
  const preferences = await readStoredPreferences(address);
  const endpoint = {
    url: config.url?.trim() || preferences.externalEndpoints[channel].url,
    encryptedSecret: config.secret
      ? encryptSecret(config.secret)
      : preferences.externalEndpoints[channel].encryptedSecret,
  };
  await deliverExternal(channel, endpoint, {
    id: randomBytes(16).toString("hex"),
    type: "test_ping",
    title: "SoroTask test ping",
    message: "SoroTask test ping — if you can read this, the channel is verified.",
    timestamp: new Date().toISOString(),
  });
}

export async function sendPushTest(address: string) {
  await deliverPush(address, {
    id: randomBytes(16).toString("hex"),
    type: "test_ping",
    title: "SoroTask test push",
    message: "Web Push is enabled for this browser.",
    url: "/settings",
    timestamp: new Date().toISOString(),
  });
}
