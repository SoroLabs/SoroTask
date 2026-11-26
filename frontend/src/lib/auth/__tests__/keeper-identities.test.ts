/** @jest-environment node */
import { Keypair } from "@stellar/stellar-sdk";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { KeeperIdentityService } from "../KeeperIdentityService";
import { FileIdentityStore, type IdentityState, type IdentityStore } from "../identity-store";
import { IdentityError, resolveSocialProfile, type IdentitySession } from "../social-provider-verification";
import { identityLinkMessage, isIdentityChallenge, isVerifiedSocialIdentity, type IdentityChallenge } from "../keeper-identities";
import { verifySocialOwnerSignature, verifyStellarIdentitySignature } from "../identity-signatures";
import { readIdentityRequest } from "../identity-request";

class MemoryStore implements IdentityStore {
  state: IdentityState = { version: 1, challenges: [], links: [] };
  async transaction<T>(change: (state: IdentityState) => T) { return change(this.state); }
}

const NOW = 1_755_200_000_000;
const ORIGIN = "https://keeper.example";
const NETWORK = "Test SDF Future Network ; October 2022";
const SESSION: IdentitySession = { subject: "github:123", github: { id: "123", username: "synthetic-keeper" } };
const evmSecret = new Uint8Array(32).fill(7);
const evmPublic = secp256k1.getPublicKey(evmSecret, false);
const OWNER = "0x" + Buffer.from(keccak_256(evmPublic.subarray(1))).subarray(12).toString("hex");

function ownerSignature(message: string) {
  const payload = Buffer.from(message);
  const hash = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${payload.length}`), payload]));
  const signature = secp256k1.sign(hash, evmSecret);
  return "0x" + signature.toCompactHex() + (27 + signature.recovery).toString(16);
}

function setup() {
  const store = new MemoryStore();
  const wallet = Keypair.random();
  const fetcher = jest.fn(async (url: string | URL | Request, _options?: RequestInit) => new Response(JSON.stringify(
    String(url).startsWith("https://api.neynar.com")
      ? { users: [{ fid: 42, username: "synthetic-fid", custody_address: OWNER }] }
      : { data: { account: { address: "0x" + "1".repeat(40), owner: OWNER, username: { localName: "synthetic.lens" } } } },
  )));
  let now = NOW;
  const service = new KeeperIdentityService({ store, origin: ORIGIN, fetch: fetcher as typeof fetch, neynarApiKey: "synthetic-test-key", now: () => now });
  return { store, wallet, fetcher, service, advance: (duration: number) => { now += duration; } };
}

function signature(wallet: Keypair, challenge: IdentityChallenge) {
  return Buffer.from(wallet.signMessage(challenge.message)).toString("base64");
}

describe("verified keeper identity linking", () => {
  test("GitHub identity comes from authenticated OAuth profile and a valid wallet signature", async () => {
    const { service, wallet, fetcher } = setup();
    const challenge = await service.challenge({ provider: "github", identifier: "attacker-name", walletAddress: wallet.publicKey() }, SESSION);
    expect(challenge.providerId).toBe("123");
    const link = await service.complete({ nonce: challenge.nonce, walletSignature: signature(wallet, challenge) }, SESSION);
    expect(link).toMatchObject({ provider: "github", username: "synthetic-keeper", walletAddress: wallet.publicKey() });
    expect(fetcher).not.toHaveBeenCalled();
    expect((await service.list([wallet.publicKey()]))[wallet.publicKey()]).toEqual([link]);
    expect(isVerifiedSocialIdentity(link, wallet.publicKey(), NOW)).toBe(true);
  });

  test.each(["farcaster", "lens"] as const)("%s verifies provider ownership plus both wallet signatures", async (provider) => {
    const { service, wallet } = setup();
    const identifier = provider === "farcaster" ? "42" : "0x" + "1".repeat(40);
    const challenge = await service.challenge({ provider, identifier, walletAddress: wallet.publicKey() }, SESSION);
    const link = await service.complete({ nonce: challenge.nonce, walletSignature: signature(wallet, challenge), ownerSignature: ownerSignature(challenge.message) }, SESSION);
    expect(link?.provider).toBe(provider);
    expect(link?.walletAddress).toBe(wallet.publicKey());
  });

  test("a caller-supplied GitHub profile and mock auth cannot establish ownership", async () => {
    const { service, wallet } = setup();
    await expect(service.challenge({ provider: "github", identifier: "123", walletAddress: wallet.publicKey() }, { subject: "email:1" })).rejects.toMatchObject({ code: "github_sign_in_required" });
  });

  test("invalid wallet signatures consume the challenge without adding a badge", async () => {
    const { service, wallet } = setup();
    const challenge = await service.challenge({ provider: "github", identifier: "", walletAddress: wallet.publicKey() }, SESSION);
    await expect(service.complete({ nonce: challenge.nonce, walletSignature: signature(Keypair.random(), challenge) }, SESSION)).rejects.toMatchObject({ code: "invalid_wallet_signature" });
    await expect(service.complete({ nonce: challenge.nonce, walletSignature: signature(wallet, challenge) }, SESSION)).rejects.toMatchObject({ code: "invalid_challenge" });
    expect((await service.list([wallet.publicKey()]))[wallet.publicKey()]).toEqual([]);
  });

  test("wrong session cannot consume another user's challenge", async () => {
    const { service, wallet } = setup();
    const challenge = await service.challenge({ provider: "github", identifier: "", walletAddress: wallet.publicKey() }, SESSION);
    await expect(service.complete({ nonce: challenge.nonce, walletSignature: signature(wallet, challenge) }, { ...SESSION, subject: "github:other" })).rejects.toMatchObject({ code: "invalid_challenge" });
    expect(await service.complete({ nonce: challenge.nonce, walletSignature: signature(wallet, challenge) }, SESSION)).not.toBeNull();
  });

  test("expiration rejects the exact boundary and requires a new signing request", async () => {
    const { service, wallet, advance } = setup();
    const challenge = await service.challenge({ provider: "github", identifier: "", walletAddress: wallet.publicKey() }, SESSION);
    advance(300_000);
    await expect(service.complete({ nonce: challenge.nonce, walletSignature: signature(wallet, challenge) }, SESSION)).rejects.toMatchObject({ code: "challenge_expired" });
  });

  test("a signing request that expires during the provider recheck cannot create a badge", async () => {
    const { service, wallet, fetcher, advance } = setup();
    const challenge = await service.challenge({ provider: "farcaster", identifier: "42", walletAddress: wallet.publicKey() }, SESSION);
    fetcher.mockImplementationOnce(async () => {
      advance(300_000);
      return new Response(JSON.stringify({ users: [{ fid: 42, username: "synthetic-fid", custody_address: OWNER }] }));
    });
    await expect(service.complete({ nonce: challenge.nonce, walletSignature: signature(wallet, challenge), ownerSignature: ownerSignature(challenge.message) }, SESSION)).rejects.toMatchObject({ code: "challenge_expired" });
    expect((await service.list([wallet.publicKey()]))[wallet.publicKey()]).toEqual([]);
  });

  test("badge expiration and pending challenge limits use exact boundaries", async () => {
    const { service, wallet, advance } = setup();
    const challenge = await service.challenge({ provider: "github", identifier: "", walletAddress: wallet.publicKey() }, SESSION);
    await service.complete({ nonce: challenge.nonce, walletSignature: signature(wallet, challenge) }, SESSION);
    advance(30 * 24 * 60 * 60_000);
    expect((await service.list([wallet.publicKey()]))[wallet.publicKey()]).toEqual([]);
    for (let count = 0; count < 5; count++) await service.challenge({ provider: "github", identifier: "", walletAddress: wallet.publicKey() }, SESSION);
    await expect(service.challenge({ provider: "github", identifier: "", walletAddress: wallet.publicKey() }, SESSION)).rejects.toMatchObject({ code: "too_many_challenges", status: 429 });
    await expect(service.list(Array(101).fill(wallet.publicKey()))).rejects.toMatchObject({ code: "invalid_wallet" });
  });

  test("concurrent completion succeeds only once", async () => {
    const { service, wallet } = setup();
    const challenge = await service.challenge({ provider: "github", identifier: "", walletAddress: wallet.publicKey() }, SESSION);
    const result = await Promise.allSettled([1, 2].map(() => service.complete({ nonce: challenge.nonce, walletSignature: signature(wallet, challenge) }, SESSION)));
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  });

  test("wrong social owner signature is rejected even with the correct Stellar signature", async () => {
    const { service, wallet } = setup();
    const challenge = await service.challenge({ provider: "farcaster", identifier: "42", walletAddress: wallet.publicKey() }, SESSION);
    await expect(service.complete({ nonce: challenge.nonce, walletSignature: signature(wallet, challenge), ownerSignature: ownerSignature(challenge.message + "changed") }, SESSION)).rejects.toMatchObject({ code: "invalid_owner_signature" });
  });

  test("provider owner changes between challenge and completion are rejected", async () => {
    const { service, wallet, fetcher } = setup();
    const challenge = await service.challenge({ provider: "farcaster", identifier: "42", walletAddress: wallet.publicKey() }, SESSION);
    fetcher.mockImplementationOnce(async () => new Response(JSON.stringify({ users: [{ fid: 42, username: "synthetic-fid", custody_address: "0x" + "2".repeat(40) }] })));
    await expect(service.complete({ nonce: challenge.nonce, walletSignature: signature(wallet, challenge), ownerSignature: ownerSignature(challenge.message) }, SESSION)).rejects.toMatchObject({ code: "profile_owner_changed" });
  });

  test("an active social identity cannot be taken over by a second keeper wallet", async () => {
    const { service, wallet } = setup();
    for (const pair of [wallet, Keypair.random()]) {
      const challenge = await service.challenge({ provider: "github", identifier: "", walletAddress: pair.publicKey() }, SESSION);
      const completion = service.complete({ nonce: challenge.nonce, walletSignature: signature(pair, challenge) }, SESSION);
      if (pair === wallet) await completion;
      else await expect(completion).rejects.toMatchObject({ code: "profile_already_linked" });
    }
  });

  test("unlink requires keeper ownership and removes the verified badge", async () => {
    const { service, wallet } = setup();
    const challenge = await service.challenge({ provider: "github", identifier: "", walletAddress: wallet.publicKey() }, SESSION);
    await service.complete({ nonce: challenge.nonce, walletSignature: signature(wallet, challenge) }, SESSION);
    const unlink = await service.challenge({ action: "unlink", provider: "github", identifier: "", walletAddress: wallet.publicKey() }, SESSION);
    expect(unlink.message).toContain("Action: unlink");
    await service.complete({ nonce: unlink.nonce, walletSignature: signature(wallet, unlink) }, SESSION);
    expect((await service.list([wallet.publicKey()]))[wallet.publicKey()]).toEqual([]);
  });

  test("provider failures do not echo API keys, identifiers or network responses", async () => {
    const { fetcher } = setup();
    fetcher.mockRejectedValueOnce(new Error("private-provider-failure"));
    await expect(resolveSocialProfile("farcaster", "42", SESSION, { fetch: fetcher as typeof fetch, neynarApiKey: "private-key-canary" })).rejects.toEqual(new IdentityError("provider_unavailable", 503));
    await expect(resolveSocialProfile("farcaster", "https://attacker.example", SESSION, { fetch: fetcher as typeof fetch, neynarApiKey: "private-key-canary" })).rejects.toMatchObject({ code: "invalid_profile" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("stored identities survive restart; concurrent workers serialize changes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "keeper-identity-test-"));
    try {
      const first = new FileIdentityStore(directory);
      const second = new FileIdentityStore(directory);
      await Promise.all([first, second].map((store, index) => store.transaction((state) => { state.links.push({ provider: "github", providerId: String(index), username: "fixture", profileUrl: "https://github.com/fixture", walletAddress: Keypair.random().publicKey(), verifiedAt: NOW, expiresAt: NOW + 10_000 }); })));
      expect(await new FileIdentityStore(directory).transaction((state) => state.links.length)).toBe(2);
      expect((await stat(path.join(directory, "identities.json"))).mode & 0o777).toBe(0o600);
      expect(await readFile(path.join(directory, "identities.json"), "utf8")).not.toContain("signature");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("corrupt storage is rejected without overwriting it or publishing badges", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "keeper-identity-invalid-"));
    try {
      const file = path.join(directory, "identities.json");
      const corrupt = JSON.stringify({ version: 1, challenges: [], links: [null] });
      await writeFile(file, corrupt);
      await expect(new FileIdentityStore(directory).transaction((state) => state.links)).rejects.toMatchObject({ code: "storage_invalid" });
      expect(await readFile(file, "utf8")).toBe(corrupt);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("provider redirects, oversized and malformed responses fail closed", async () => {
    const { fetcher } = setup();
    fetcher.mockResolvedValueOnce(new Response("x".repeat(65_537)));
    await expect(resolveSocialProfile("farcaster", "42", SESSION, { fetch: fetcher as typeof fetch, neynarApiKey: "synthetic-key" })).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store" });
    fetcher.mockResolvedValueOnce(new Response("invalid json"));
    await expect(resolveSocialProfile("lens", "0x" + "1".repeat(40), SESSION, { fetch: fetcher as typeof fetch })).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  test("missing provider configuration and malformed social accounts never verify", async () => {
    const { fetcher } = setup();
    await expect(resolveSocialProfile("farcaster", "42", SESSION, { fetch: fetcher as typeof fetch })).rejects.toMatchObject({ code: "provider_not_configured" });
    await expect(resolveSocialProfile("lens", "not-an-address", SESSION, { fetch: fetcher as typeof fetch })).rejects.toMatchObject({ code: "invalid_profile" });
    for (const data of [{}, { users: [null] }, { users: [{ fid: 42, username: "unexpected/name", custody_address: OWNER }] }]) {
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify(data)));
      await expect(resolveSocialProfile("farcaster", "42", SESSION, { fetch: fetcher as typeof fetch, neynarApiKey: "synthetic-key" })).rejects.toMatchObject({ code: "profile_not_found" });
    }
    for (const data of [{ errors: [{ message: "private-error" }] }, { data: { account: { address: "0x" + "2".repeat(40), owner: OWNER, username: { localName: "fixture" } } } }]) {
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify(data)));
      await expect(resolveSocialProfile("lens", "0x" + "1".repeat(40), SESSION, { fetch: fetcher as typeof fetch })).rejects.toMatchObject({ code: "profile_not_found" });
    }
    for (const response of [new Response("", { status: 503 }), new Response(null), new Response("{}", { headers: { "content-length": "65537" } })]) {
      fetcher.mockResolvedValueOnce(response);
      await expect(resolveSocialProfile("lens", "0x" + "1".repeat(40), SESSION, { fetch: fetcher as typeof fetch })).rejects.toMatchObject({ code: "provider_unavailable" });
    }
  });

  test("unavailable unlink targets and malformed completion requests do not mutate identities", async () => {
    const { service, wallet } = setup();
    await expect(service.challenge({ action: "unlink", provider: "github", identifier: "", walletAddress: wallet.publicKey() }, SESSION)).rejects.toMatchObject({ code: "identity_not_linked" });
    await expect(service.challenge({ provider: "github", identifier: "", walletAddress: "invalid" }, SESSION)).rejects.toMatchObject({ code: "invalid_wallet" });
    await expect(service.complete({ nonce: "bad", walletSignature: "bad" }, SESSION)).rejects.toMatchObject({ code: "invalid_challenge" });
    const challenge = await service.challenge({ provider: "farcaster", identifier: "42", walletAddress: wallet.publicKey() }, SESSION);
    await expect(service.complete({ nonce: challenge.nonce, walletSignature: signature(wallet, challenge) }, SESSION)).rejects.toMatchObject({ code: "invalid_owner_signature" });
  });

  test("a crashed writer lock stays fail-closed and oversized state is preserved", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "keeper-identity-lock-"));
    try {
      const lock = path.join(directory, "identity.lock");
      await writeFile(lock, "synthetic-crash");
      await expect(new FileIdentityStore(directory).transaction((state) => state.links)).rejects.toMatchObject({ code: "storage_busy" });
      expect(await readFile(lock, "utf8")).toBe("synthetic-crash");
      await rm(lock);
      const file = path.join(directory, "identities.json");
      await writeFile(file, " ".repeat(4 * 1024 * 1024 + 1));
      await expect(new FileIdentityStore(directory).transaction((state) => state.links)).rejects.toMatchObject({ code: "storage_invalid" });
      expect((await stat(file)).size).toBe(4 * 1024 * 1024 + 1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("JSON requests enforce byte limits without trusting Content-Length", async () => {
    const request = (body: string) => new Request(ORIGIN, { method: "POST", body });
    expect(await readIdentityRequest(request('{"operation":"challenge"}'))).toEqual({ operation: "challenge" });
    for (const text of ["[]", "null", "{", "bad"]) await expect(readIdentityRequest(request(text))).rejects.toMatchObject({ code: "invalid_request" });
    await expect(readIdentityRequest(request(JSON.stringify({ payload: "界".repeat(3_000) })))).rejects.toMatchObject({ code: "request_too_large", status: 413 });
    expect(await readIdentityRequest(request(" ".repeat(8_190) + "{}"))).toEqual({});
    await expect(readIdentityRequest(request(" ".repeat(8_191) + "{}"))).rejects.toMatchObject({ code: "request_too_large" });
  });

  test("client signing request validates canonical message, origin and wallet binding", async () => {
    const { service, wallet } = setup();
    const challenge = await service.challenge({ provider: "github", identifier: "", walletAddress: wallet.publicKey() }, SESSION);
    const expected = { address: wallet.publicKey(), provider: "github" as const, action: "link" as const, origin: ORIGIN, network: NETWORK };
    expect(isIdentityChallenge(challenge, expected, NOW)).toBe(true);
    expect(isIdentityChallenge({ ...challenge, message: "Sign an unrelated request" }, expected, NOW)).toBe(false);
    expect(isIdentityChallenge(challenge, { ...expected, origin: "https://other.example" }, NOW)).toBe(false);
    expect(identityLinkMessage(challenge)).toBe(challenge.message);
  });

  test("signature verifiers reject malformed values and altered messages", () => {
    const wallet = Keypair.random();
    const message = "Synthetic signing challenge";
    expect(verifyStellarIdentitySignature(wallet.publicKey(), message, Buffer.from(wallet.signMessage(message)).toString("base64"))).toBe(true);
    expect(verifyStellarIdentitySignature(wallet.publicKey(), message + "x", Buffer.from(wallet.signMessage(message)).toString("base64"))).toBe(false);
    expect(verifyStellarIdentitySignature(wallet.publicKey(), message, Buffer.from(wallet.sign(Buffer.from(message))).toString("base64"))).toBe(false);
    expect(verifyStellarIdentitySignature("not-a-wallet", message, "bad")).toBe(false);
    expect(verifySocialOwnerSignature(OWNER, message, ownerSignature(message))).toBe(true);
    expect(verifySocialOwnerSignature(OWNER, message, "0xdeadbeef")).toBe(false);
    const valid = ownerSignature(message);
    expect(verifySocialOwnerSignature(OWNER, message, valid.slice(0, -2) + "ff")).toBe(false);
    const parsed = secp256k1.Signature.fromCompact(valid.slice(2, 130));
    const highS = new secp256k1.Signature(parsed.r, secp256k1.CURVE.n - parsed.s);
    expect(verifySocialOwnerSignature(OWNER, message, "0x" + highS.toCompactHex() + valid.slice(-2))).toBe(false);
    expect(verifyStellarIdentitySignature(wallet.publicKey(), message, "A".repeat(86))).toBe(false);
  });

  test("Stellar verification accepts the published SEP-53 ASCII test vector", () => {
    expect(verifyStellarIdentitySignature("GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L", "Hello, World!", "fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==")).toBe(true);
  });
});
