jest.mock("server-only", () => ({}), { virtual: true });

jest.mock("ioredis", () => {
  class MockRedis {
    strings = new Map<string, string>();
    lists = new Map<string, string[]>();
    hashes = new Map<string, Record<string, string>>();

    on() {
      return this;
    }

    async get(key: string) {
      return this.strings.get(key) ?? null;
    }

    async set(key: string, value: string) {
      this.strings.set(key, value);
      return "OK";
    }

    async lpush(key: string, value: string) {
      const entries = this.lists.get(key) ?? [];
      entries.unshift(value);
      this.lists.set(key, entries);
      return entries.length;
    }

    async ltrim(key: string, start: number, stop: number) {
      this.lists.set(key, (this.lists.get(key) ?? []).slice(start, stop + 1));
      return "OK";
    }

    async expire() {
      return 1;
    }

    async lrange(key: string, start: number, stop: number) {
      return (this.lists.get(key) ?? []).slice(start, stop + 1);
    }

    async hset(key: string, field: string, value: string) {
      const hash = this.hashes.get(key) ?? {};
      hash[field] = value;
      this.hashes.set(key, hash);
      return 1;
    }

    async hgetall(key: string) {
      return this.hashes.get(key) ?? {};
    }

    async hdel(key: string, field: string) {
      const hash = this.hashes.get(key) ?? {};
      delete hash[field];
      return 1;
    }

    async del(key: string) {
      this.strings.delete(key);
      this.lists.delete(key);
      this.hashes.delete(key);
      return 1;
    }
  }

  return { __esModule: true, default: MockRedis };
});

import {
  dispatchNotification,
  getNotificationRedis,
  isSameOriginMutation,
  readInAppNotifications,
  readPreferences,
  writePreferences,
} from "../notification-service";
import { defaultNotificationPreferences } from "../../notification-preferences";

const walletAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const secret = "webhook-signing-secret";

describe("server notification preferences and feed", () => {
  beforeAll(() => {
    process.env.REDIS_URL = "redis://notification-test";
    process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  beforeEach(async () => {
    const redis = getNotificationRedis() as unknown as {
      del(key: string): Promise<number>;
    };
    await redis.del(`sorotask:notifications:preferences:${walletAddress}`);
    await redis.del(`sorotask:notifications:feed:${walletAddress}`);
  });

  it("encrypts channel secrets and records enabled events in the wallet feed", async () => {
    const preferences = {
      ...defaultNotificationPreferences,
      channels: {
        ...defaultNotificationPreferences.channels,
        browser: false,
        email: false,
        webhook: false,
        telegram: false,
        discord: false,
      },
      categoryChannels: { taskFailed: ["inApp" as const] },
      externalEndpoints: {
        ...defaultNotificationPreferences.externalEndpoints,
        webhook: {
          url: "https://hooks.example.com/notification",
          secret,
        },
      },
    };
    const saved = await writePreferences(walletAddress, preferences);
    expect(saved.externalEndpoints.webhook.secret).toBe("");
    expect(saved.externalSecretsConfigured.webhook).toBe(true);

    const redis = getNotificationRedis() as unknown as {
      get(key: string): Promise<string | null>;
    };
    const stored = await redis.get(`sorotask:notifications:preferences:${walletAddress}`);
    expect(stored).not.toContain(secret);
    expect(await readPreferences(walletAddress)).toMatchObject({
      externalSecretsConfigured: { webhook: true },
    });

    await expect(
      dispatchNotification({
        recipient: walletAddress,
        category: "taskFailed",
        title: "Task failed",
        message: "Execution failed.",
      }),
    ).resolves.toEqual([{ channel: "inApp", success: true }]);
    await expect(readInAppNotifications(walletAddress)).resolves.toEqual([
      expect.objectContaining({
        type: "taskFailed",
        title: "Task failed",
        message: "Execution failed.",
      }),
    ]);
  });

  it("does not deliver categories disabled by the wallet", async () => {
    await writePreferences(walletAddress, {
      ...defaultNotificationPreferences,
      channels: {
        ...defaultNotificationPreferences.channels,
        browser: false,
        email: false,
        webhook: false,
        telegram: false,
        discord: false,
      },
      categories: {
        ...defaultNotificationPreferences.categories,
        taskFailed: false,
      },
    });

    await expect(
      dispatchNotification({
        recipient: walletAddress,
        category: "taskFailed",
        title: "Task failed",
        message: "Execution failed.",
      }),
    ).resolves.toEqual([]);
    await expect(readInAppNotifications(walletAddress)).resolves.toEqual([]);
  });

  it("rejects cross-origin preference mutations", () => {
    const request = new Request("https://app.example/api/notifications/preferences", {
      method: "PUT",
      headers: { origin: "https://attacker.example" },
    });

    expect(isSameOriginMutation(request)).toBe(false);
  });
});
