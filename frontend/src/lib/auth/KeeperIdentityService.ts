import { randomBytes } from "node:crypto";
import { identityLinkMessage, socialProfileUrl, type IdentityChallenge, type SocialProvider, type VerifiedSocialIdentity } from "./keeper-identities";
import type { IdentityStore, StoredChallenge } from "./identity-store";
import { IdentityError, resolveSocialProfile, type IdentitySession, type VerifiedProviderProfile } from "./social-provider-verification";
import { isStellarIdentityAddress, verifySocialOwnerSignature, verifyStellarIdentitySignature } from "./identity-signatures";

const CHALLENGE_LIFETIME = 5 * 60_000;
export const IDENTITY_LIFETIME = 30 * 24 * 60 * 60_000;

export interface KeeperIdentityOptions {
  store: IdentityStore;
  origin: string;
  networkPassphrase?: string;
  fetch?: typeof fetch;
  neynarApiKey?: string;
  now?: () => number;
}

/** Separate from legacy auth normalization: mocked AuthResult objects never verify a badge. */
export class KeeperIdentityService {
  private readonly now: () => number;
  private readonly network: string;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: KeeperIdentityOptions) {
    this.now = options.now ?? Date.now;
    this.network = options.networkPassphrase ?? "Test SDF Future Network ; October 2022";
    this.fetcher = options.fetch ?? fetch;
  }

  private profile(provider: SocialProvider, identifier: string, session: IdentitySession): Promise<VerifiedProviderProfile> {
    return resolveSocialProfile(provider, identifier, session, { fetch: this.fetcher, neynarApiKey: this.options.neynarApiKey });
  }

  async challenge(input: { provider: SocialProvider; identifier: string; walletAddress: string; action?: "link" | "unlink" }, session: IdentitySession): Promise<IdentityChallenge> {
    if (!isStellarIdentityAddress(input.walletAddress)) throw new IdentityError("invalid_wallet");
    const action = input.action ?? "link";
    const profile: VerifiedProviderProfile = action === "link" ? await this.profile(input.provider, input.identifier, session) : await this.options.store.transaction((state) => {
      const found = state.links.find((link) => link.provider === input.provider && link.walletAddress === input.walletAddress);
      if (!found) throw new IdentityError("identity_not_linked", 404);
      return { provider: found.provider, id: found.providerId, username: found.username };
    });
    const now = this.now();
    const unsigned: Omit<IdentityChallenge, "message"> = {
      action, nonce: randomBytes(32).toString("hex"), provider: profile.provider, providerId: profile.id,
      walletAddress: input.walletAddress, origin: this.options.origin, networkPassphrase: this.network,
      issuedAt: now, expiresAt: now + CHALLENGE_LIFETIME,
      ...(profile.ownerAddress ? { ownerAddress: profile.ownerAddress } : {}),
    };
    const challenge = { ...unsigned, message: identityLinkMessage(unsigned) };
    await this.options.store.transaction((state) => {
      if (this.now() >= challenge.expiresAt) throw new IdentityError("challenge_expired");
      state.challenges = state.challenges.filter((item) => item.expiresAt > now);
      if (state.challenges.filter((item) => item.subject === session.subject).length >= 5 || state.challenges.length >= 2_000) {
        throw new IdentityError("too_many_challenges", 429);
      }
      state.challenges.push({ ...challenge, subject: session.subject, username: profile.username });
    });
    return challenge;
  }

  async complete(input: { nonce: string; walletSignature: string; ownerSignature?: string }, session: IdentitySession): Promise<VerifiedSocialIdentity | null> {
    if (!/^[0-9a-f]{64}$/.test(input.nonce)) throw new IdentityError("invalid_challenge");
    const now = this.now();
    // Remove before any asynchronous provider check: concurrent completion/replay cannot win twice.
    const challenge: StoredChallenge = await this.options.store.transaction((state) => {
      const index = state.challenges.findIndex((item) => item.nonce === input.nonce && item.subject === session.subject);
      if (index < 0) throw new IdentityError("invalid_challenge");
      const item = state.challenges[index];
      state.challenges.splice(index, 1);
      return item;
    });
    if (now >= challenge.expiresAt || challenge.origin !== this.options.origin || challenge.networkPassphrase !== this.network) {
      throw new IdentityError("challenge_expired");
    }
    if (!verifyStellarIdentitySignature(challenge.walletAddress, challenge.message, input.walletSignature)) {
      throw new IdentityError("invalid_wallet_signature");
    }
    if (challenge.action === "unlink") {
      await this.options.store.transaction((state) => {
        if (this.now() >= challenge.expiresAt) throw new IdentityError("challenge_expired");
        state.links = state.links.filter((link) => !(link.walletAddress === challenge.walletAddress && link.provider === challenge.provider && link.providerId === challenge.providerId));
      });
      return null;
    }
    const profile = await this.profile(challenge.provider, challenge.providerId, session);
    if (profile.id !== challenge.providerId || profile.ownerAddress !== challenge.ownerAddress) throw new IdentityError("profile_owner_changed");
    if (profile.ownerAddress && !verifySocialOwnerSignature(profile.ownerAddress, challenge.message, input.ownerSignature ?? "")) {
      throw new IdentityError("invalid_owner_signature");
    }
    const verifiedAt = this.now();
    if (verifiedAt >= challenge.expiresAt) throw new IdentityError("challenge_expired");
    const link: VerifiedSocialIdentity = {
      provider: profile.provider, providerId: profile.id, username: profile.username,
      profileUrl: socialProfileUrl(profile.provider, profile.username), walletAddress: challenge.walletAddress,
      verifiedAt, expiresAt: verifiedAt + IDENTITY_LIFETIME,
    };
    await this.options.store.transaction((state) => {
      if (this.now() >= challenge.expiresAt) throw new IdentityError("challenge_expired");
      state.links = state.links.filter((item) => item.expiresAt > verifiedAt);
      const owner = state.links.find((item) => item.provider === link.provider && item.providerId === link.providerId);
      if (owner && owner.walletAddress !== link.walletAddress) throw new IdentityError("profile_already_linked", 409);
      state.links = state.links.filter((item) => !(item.provider === link.provider && item.walletAddress === link.walletAddress));
      if (state.links.length >= 5_000) throw new IdentityError("storage_capacity", 503);
      state.links.push(link);
    });
    return link;
  }

  async list(addresses: string[]): Promise<Record<string, VerifiedSocialIdentity[]>> {
    if (addresses.length > 100 || addresses.some((address) => !isStellarIdentityAddress(address))) throw new IdentityError("invalid_wallet");
    const requested = new Set(addresses);
    const now = this.now();
    return this.options.store.transaction((state) => {
      const result: Record<string, VerifiedSocialIdentity[]> = {};
      for (const address of requested) result[address] = [];
      for (const link of state.links) {
        if (requested.has(link.walletAddress) && link.expiresAt > now) result[link.walletAddress].push({ ...link });
      }
      return result;
    });
  }
}
