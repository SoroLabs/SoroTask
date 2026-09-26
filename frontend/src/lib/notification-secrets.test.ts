import { webcrypto } from "node:crypto";

import {
  decryptChannelSecret,
  encryptChannelSecret,
  resolveChannelUrl,
  sendChannelTestPing,
} from "./notification-secrets";

const WALLET_PUBLIC_KEY =
  "GA7QYNF7SowQc3DwBWzZucrEBZk37ygUBdUaJmNfWQ8sCuSUuF4VcUF6";

describe("channel secret encryption (issue #1263)", () => {
  it("round-trips a secret encrypted with the wallet public key", async () => {
    const encrypted = await encryptChannelSecret(
      "whsec_test_123",
      WALLET_PUBLIC_KEY,
      webcrypto as unknown as typeof globalThis.crypto,
    );

    expect(encrypted).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

    const decrypted = await decryptChannelSecret(
      encrypted,
      WALLET_PUBLIC_KEY,
      webcrypto as unknown as typeof globalThis.crypto,
    );
    expect(decrypted).toBe("whsec_test_123");
  });

  it("does not decrypt under a different wallet public key", async () => {
    const encrypted = await encryptChannelSecret(
      "whsec_test_123",
      WALLET_PUBLIC_KEY,
      webcrypto as unknown as typeof globalThis.crypto,
    );

    await expect(
      decryptChannelSecret(
        encrypted,
        "GA5XIGA5C7FBPTVQ3CWHKNC7D2ZBHB24G3KUJG5WZ6S4EYWSSBFVL45T",
        webcrypto as unknown as typeof globalThis.crypto,
      ),
    ).rejects.toThrow();
  });

  it("stores an empty secret as an empty string", async () => {
    const encrypted = await encryptChannelSecret(
      "",
      WALLET_PUBLIC_KEY,
      webcrypto as unknown as typeof globalThis.crypto,
    );
    expect(encrypted).toBe("");
  });

  it("requires a wallet public key", async () => {
    await expect(
      encryptChannelSecret(
        "whsec_test_123",
        "",
        webcrypto as unknown as typeof globalThis.crypto,
      ),
    ).rejects.toThrow("wallet public key");
  });
});

describe("channel test ping (issue #1263)", () => {
  it("POSTs a test payload and reports success on 2xx", async () => {
    const fetchFn = jest.fn(async () => ({ ok: true, status: 204 }));

    const result = await sendChannelTestPing(
      "webhook",
      "https://hooks.example.com/abc",
      { fetchFn: fetchFn as unknown as typeof fetch },
    );

    expect(result).toEqual({ ok: true, status: 204 });
    const [, init] = fetchFn.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).type).toBe("test_ping");
  });

  it("reports non-2xx and network failures as verification failures", async () => {
    const failing = jest.fn(async () => ({ ok: false, status: 404 }));
    const bad = await sendChannelTestPing("discord", "https://x.example", {
      fetchFn: failing as unknown as typeof fetch,
    });
    expect(bad).toEqual({ ok: false, status: 404 });

    const throwing = jest.fn(async () => {
      throw new Error("CORS blocked");
    });
    const blocked = await sendChannelTestPing("webhook", "https://x.example", {
      fetchFn: throwing as unknown as typeof fetch,
    });
    expect(bad).toEqual({ ok: false, error: "CORS blocked" });
  });

  it("fails fast without an endpoint", async () => {
    const result = await sendChannelTestPing("telegram", "", { fetchFn: jest.fn() });
    expect(result).toEqual({ ok: false, error: "No delivery endpoint configured" });
  });
});

describe("resolveChannelUrl", () => {
  it("uses the configured URL when present", () => {
    expect(resolveChannelUrl("webhook", { url: "https://a/b", secret: "" })).toBe(
      "https://a/b",
    );
  });

  it("builds the Telegram sendMessage URL from a chat:token secret", () => {
    expect(
      resolveChannelUrl("telegram", { url: "", secret: "12345:BOT_TOKEN" }),
    ).toBe(
      "https://api.telegram.org/botBOT_TOKEN/sendMessage?chat_id=12345",
    );
  });

  it("returns empty when nothing is configured", () => {
    expect(resolveChannelUrl("discord", { url: "", secret: "" })).toBe("");
  });
});
