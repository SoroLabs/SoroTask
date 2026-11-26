/** @jest-environment node */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { auth } from "../[...nextauth]/route";
import { GET, POST } from "./route";

jest.mock("../[...nextauth]/route", () => ({ auth: jest.fn() }));

const ORIGIN = "https://keeper.example";
const wallet = Keypair.random();
const caller = { user: { id: "123", provider: "github", providerAccountId: "123", keeperGithub: { id: "123", username: "synthetic-keeper" } } };
const mockAuth = auth as jest.Mock;
const post = (body: unknown, origin = ORIGIN) => new Request(`${ORIGIN}/api/auth/keeper-identities`, {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("keeper identity API boundary", () => {
  const initialEnvironment = { ...process.env };
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "keeper-identity-route-"));
    process.env.AUTH_URL = ORIGIN;
    process.env.KEEPER_IDENTITY_STATE_DIR = directory;
    mockAuth.mockReset().mockResolvedValue(caller);
  });
  afterEach(async () => {
    process.env = { ...initialEnvironment };
    await rm(directory, { recursive: true, force: true });
  });

  test("authenticated OAuth plus a real SEP-53 proof creates and lists a badge", async () => {
    const response = await POST(post({ operation: "challenge", action: "link", provider: "github", identifier: "", walletAddress: wallet.publicKey() }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { challenge } = await response.json();
    const complete = await POST(post({ operation: "complete", nonce: challenge.nonce, walletSignature: Buffer.from(wallet.signMessage(challenge.message)).toString("base64") }));
    expect(complete.status).toBe(200);
    const listed = await GET(new Request(`${ORIGIN}/api/auth/keeper-identities?address=${wallet.publicKey()}`));
    expect((await listed.json()).identities[wallet.publicKey()]).toMatchObject([{ provider: "github", username: "synthetic-keeper" }]);
    expect((await POST(post({ operation: "complete", nonce: challenge.nonce, walletSignature: "replay" }))).status).toBe(400);
  });

  test("unauthenticated and posted GitHub profiles cannot establish ownership", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const unauthenticated = await GET(new Request(`${ORIGIN}/api/auth/keeper-identities`));
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toEqual({ error: { code: "sign_in_required" } });
    mockAuth.mockResolvedValueOnce({ user: { id: "1", provider: "email" } });
    const untrusted = await POST(post({ operation: "challenge", action: "link", provider: "github", identifier: "123", walletAddress: wallet.publicKey(), github: caller.user.keeperGithub }));
    expect(untrusted.status).toBe(401);
    expect(await untrusted.json()).toEqual({ error: { code: "github_sign_in_required" } });
  });

  test("wrong origin, invalid content and oversize bodies return bounded error codes", async () => {
    const foreign = await POST(post({}, "https://foreign.example"));
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: { code: "origin_mismatch" } });
    for (const request of [
      new Request(ORIGIN, { method: "POST", headers: { origin: ORIGIN, "content-type": "text/plain" }, body: "{}" }),
      new Request(ORIGIN, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{" }),
      post({ operation: "challenge", provider: "unknown" }),
    ]) expect((await POST(request)).status).toBe(400);
    const large = await POST(post({ privateCanary: "synthetic-private-data", payload: "x".repeat(9_000) }));
    expect(large.status).toBe(413);
    expect(await large.json()).toEqual({ error: { code: "request_too_large" } });
  });

  test("missing canonical configuration and invalid wallets fail without private details", async () => {
    const invalid = await GET(new Request(`${ORIGIN}/api/auth/keeper-identities?address=private-wallet-canary`));
    expect(await invalid.json()).toEqual({ error: { code: "invalid_wallet" } });
    delete process.env.AUTH_URL;
    delete process.env.NEXTAUTH_URL;
    const unavailable = await POST(post({}));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: { code: "identity_not_configured" } });
  });

  test("unknown operations and malformed signature inputs return stable errors", async () => {
    for (const body of [{ operation: "unexpected" }, { operation: "complete", nonce: 123, walletSignature: "bad" },
      { operation: "complete", nonce: "a".repeat(64), walletSignature: "x".repeat(101) },
      { operation: "complete", nonce: "a".repeat(64), walletSignature: "bad", ownerSignature: 123 }]) {
      const result = await POST(post(body));
      expect(result.status).toBe(400);
      expect(await result.json()).toEqual({ error: { code: "invalid_request" } });
    }
    process.env.AUTH_URL = "invalid-url";
    expect((await GET(new Request(ORIGIN))).status).toBe(503);
  });

  test.each(["ftp://localhost:3000", "https://user:password@keeper.example", "http://keeper.example"])("unsafe canonical origin %s cannot configure linking", async (origin) => {
    process.env.AUTH_URL = origin;
    const result = await GET(new Request(`${ORIGIN}/api/auth/keeper-identities`));
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: { code: "identity_not_configured" } });
  });
});
