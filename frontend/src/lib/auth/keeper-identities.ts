/** Public wire contract. Verification happens on the server, never from badges supplied by a client. */
export const SOCIAL_PROVIDERS = ["github", "farcaster", "lens"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export interface VerifiedSocialIdentity {
  provider: SocialProvider;
  providerId: string;
  username: string;
  profileUrl: string;
  walletAddress: string;
  verifiedAt: number;
  expiresAt: number;
}

export interface IdentityChallenge {
  action: "link" | "unlink";
  nonce: string;
  provider: SocialProvider;
  providerId: string;
  walletAddress: string;
  origin: string;
  networkPassphrase: string;
  issuedAt: number;
  expiresAt: number;
  message: string;
  ownerAddress?: string;
}

export function isSocialProvider(value: unknown): value is SocialProvider {
  return typeof value === "string" && SOCIAL_PROVIDERS.includes(value as SocialProvider);
}

export function socialProfileUrl(provider: SocialProvider, username: string): string {
  const host = { github: "https://github.com/", farcaster: "https://farcaster.xyz/", lens: "https://hey.xyz/u/" }[provider];
  return host + encodeURIComponent(username);
}

export function identityLinkMessage(challenge: Omit<IdentityChallenge, "message">): string {
  return [
    "SoroTask keeper social identity link v1",
    `Action: ${challenge.action}`,
    `Origin: ${challenge.origin}`,
    `Network: ${challenge.networkPassphrase}`,
    `Stellar account: ${challenge.walletAddress}`,
    `Provider: ${challenge.provider}`,
    `Provider account: ${challenge.providerId}`,
    `Social owner: ${challenge.ownerAddress ?? "authenticated GitHub OAuth session"}`,
    `Nonce: ${challenge.nonce}`,
    `Issued at: ${challenge.issuedAt}`,
    `Expires at: ${challenge.expiresAt}`,
    "Authorize this profile action only. No payment, transaction or signing authority change.",
  ].join("\n");
}

export function isIdentityChallenge(value: unknown, expected: { address: string; provider: SocialProvider; action: "link" | "unlink"; origin: string; network: string }, now = Date.now()): value is IdentityChallenge {
  if (!value || typeof value !== "object") return false;
  const c = value as IdentityChallenge;
  return (c.action === "link" || c.action === "unlink") && isSocialProvider(c.provider)
    && c.action === expected.action && c.provider === expected.provider && c.walletAddress === expected.address
    && c.origin === expected.origin && c.networkPassphrase === expected.network
    && typeof c.nonce === "string" && /^[0-9a-f]{64}$/.test(c.nonce)
    && typeof c.providerId === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(c.providerId)
    && Number.isSafeInteger(c.issuedAt) && c.issuedAt >= 0 && c.issuedAt <= now + 30_000
    && Number.isSafeInteger(c.expiresAt) && c.expiresAt > now && c.expiresAt > c.issuedAt && c.expiresAt - c.issuedAt <= 300_000
    && (c.ownerAddress === undefined || (typeof c.ownerAddress === "string" && /^0x[0-9a-f]{40}$/.test(c.ownerAddress)))
    && (c.action === "unlink" || (c.provider === "github" ? c.ownerAddress === undefined : c.ownerAddress !== undefined))
    && c.message === identityLinkMessage(c);
}

/** Validate responses before rendering links; service metrics cannot inject verified badges. */
export function isVerifiedSocialIdentity(value: unknown, walletAddress: string, now = Date.now()): value is VerifiedSocialIdentity {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return isSocialProvider(item.provider)
    && typeof item.providerId === "string" && item.providerId.length > 0 && item.providerId.length <= 100
    && typeof item.username === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(item.username)
    && item.walletAddress === walletAddress
    && item.profileUrl === socialProfileUrl(item.provider, item.username)
    && typeof item.verifiedAt === "number" && Number.isSafeInteger(item.verifiedAt) && item.verifiedAt >= 0 && item.verifiedAt <= now
    && typeof item.expiresAt === "number" && Number.isSafeInteger(item.expiresAt) && item.expiresAt > now
    && item.expiresAt > item.verifiedAt;
}
