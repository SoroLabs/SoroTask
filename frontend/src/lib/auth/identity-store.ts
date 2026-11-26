import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isIdentityChallenge, isVerifiedSocialIdentity, type IdentityChallenge, type VerifiedSocialIdentity } from "./keeper-identities";
import { IdentityError } from "./social-provider-verification";

export interface StoredChallenge extends IdentityChallenge { subject: string; username: string }
export interface IdentityState {
  version: 1;
  challenges: StoredChallenge[];
  links: VerifiedSocialIdentity[];
}
export interface IdentityStore {
  transaction<T>(update: (state: IdentityState) => T): Promise<T>;
}

function validState(value: unknown): value is IdentityState {
  if (!value || typeof value !== "object") return false;
  const state = value as IdentityState;
  return state.version === 1 && Array.isArray(state.challenges) && Array.isArray(state.links)
    && state.challenges.length <= 2_000 && state.links.length <= 5_000
    && state.challenges.every((item) => item && typeof item.subject === "string" && item.subject.length > 0 && item.subject.length <= 256
      && typeof item.username === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(item.username)
      && typeof item.origin === "string" && typeof item.networkPassphrase === "string"
      && typeof item.walletAddress === "string" && /^G[A-Z2-7]{55}$/.test(item.walletAddress)
      && isIdentityChallenge(item, { address: item.walletAddress, provider: item.provider, action: item.action, origin: item.origin, network: item.networkPassphrase }, item.issuedAt))
    && state.links.every((item) => item && typeof item.walletAddress === "string" && /^G[A-Z2-7]{55}$/.test(item.walletAddress)
      && isVerifiedSocialIdentity(item, item.walletAddress, item.verifiedAt));
}

/** Local deployment storage, shared across workers; writes serialize and rename atomically. */
export class FileIdentityStore implements IdentityStore {
  constructor(private readonly directory: string) {}

  async transaction<T>(update: (state: IdentityState) => T): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lockPath = path.join(this.directory, "identity.lock");
    let lock;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { lock = await open(lockPath, "wx", 0o600); break; }
      catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw new IdentityError("storage_unavailable", 503);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (!lock) throw new IdentityError("storage_busy", 503);
    const file = path.join(this.directory, "identities.json");
    let temporary: string | undefined;
    try {
      let state: IdentityState = { version: 1, challenges: [], links: [] };
      try {
        const input = await open(file, "r");
        let bytes: Buffer;
        try {
          if ((await input.stat()).size > 4 * 1024 * 1024) throw new IdentityError("storage_invalid", 503);
          bytes = await input.readFile();
        } finally { await input.close(); }
        if (bytes.byteLength > 4 * 1024 * 1024) throw new IdentityError("storage_invalid", 503);
        state = JSON.parse(bytes.toString("utf8")) as IdentityState;
        if (!validState(state)) throw new IdentityError("storage_invalid", 503);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw new IdentityError("storage_invalid", 503);
      }
      const result = update(state);
      const serialized = JSON.stringify(state);
      if (!validState(state) || Buffer.byteLength(serialized) > 4 * 1024 * 1024) throw new IdentityError("storage_capacity", 503);
      temporary = path.join(this.directory, `identities.${randomUUID()}.tmp`);
      const output = await open(temporary, "wx", 0o600);
      try { await output.writeFile(serialized); await output.sync(); }
      finally { await output.close(); }
      await rename(temporary, file);
      temporary = undefined;
      return result;
    } finally {
      if (temporary) await rm(temporary, { force: true });
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }
}
