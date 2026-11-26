import type { SocialProvider } from "./keeper-identities";

export interface VerifiedProviderProfile {
  provider: SocialProvider;
  id: string;
  username: string;
  ownerAddress?: string;
}

export class IdentityError extends Error {
  constructor(public readonly code: string, public readonly status = 400) {
    super(code);
    this.name = "IdentityError";
  }
}

export interface IdentitySession {
  subject: string;
  github?: { id: string; username: string };
}

type ProviderOptions = { fetch: typeof fetch; neynarApiKey?: string };
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
export const isEvmAddress = (value: unknown): value is string => typeof value === "string" && addressPattern.test(value);
const usernamePattern = /^[a-zA-Z0-9_.-]{1,100}$/;

async function providerJson(fetcher: typeof fetch, url: string, options: RequestInit = {}): Promise<unknown> {
  try {
    const response = await fetcher(url, { ...options, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new IdentityError("provider_unavailable", 503);
    // Bound untrusted provider responses before parsing.
    if (Number(response.headers.get("content-length") ?? 0) > 65_536) throw new IdentityError("provider_unavailable", 503);
    const reader = response.body?.getReader();
    if (!reader) throw new IdentityError("provider_unavailable", 503);
    let text = "";
    let bytes = 0;
    const decoder = new TextDecoder();
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > 65_536) { await reader.cancel(); throw new IdentityError("provider_unavailable", 503); }
      text += decoder.decode(result.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch {
    throw new IdentityError("provider_unavailable", 503);
  }
}

/** Fixed provider endpoints: submitted identifiers can never choose a fetch URL. */
export async function resolveSocialProfile(provider: SocialProvider, identifier: string, session: IdentitySession, options: ProviderOptions): Promise<VerifiedProviderProfile> {
  if (provider === "github") {
    const profile = session.github;
    if (!profile || !/^\d{1,20}$/.test(profile.id) || !usernamePattern.test(profile.username)) {
      throw new IdentityError("github_sign_in_required", 401);
    }
    return { provider, id: profile.id, username: profile.username };
  }
  if (provider === "farcaster") {
    if (!/^[1-9]\d{0,14}$/.test(identifier)) throw new IdentityError("invalid_profile");
    if (!options.neynarApiKey) throw new IdentityError("provider_not_configured", 503);
    const data = await providerJson(options.fetch, `https://api.neynar.com/v2/farcaster/user/bulk?fids=${identifier}`, {
      headers: { accept: "application/json", api_key: options.neynarApiKey },
    }) as { users?: Array<{ fid?: unknown; username?: unknown; custody_address?: unknown }> };
    const user = Array.isArray(data?.users) ? data.users.find((entry) => entry && String(entry.fid) === identifier) : undefined;
    if (!user || typeof user.username !== "string" || !usernamePattern.test(user.username) || !isEvmAddress(user.custody_address)) {
      throw new IdentityError("profile_not_found", 404);
    }
    return { provider, id: identifier, username: user.username, ownerAddress: user.custody_address.toLowerCase() };
  }
  if (!isEvmAddress(identifier)) throw new IdentityError("invalid_profile");
  const data = await providerJson(options.fetch, "https://api.lens.xyz/graphql", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "query KeeperProfile($address: EvmAddress!) { account(request: { address: $address }) { address owner username { localName } } }", variables: { address: identifier.toLowerCase() } }),
  }) as { errors?: unknown; data?: { account?: { address?: unknown; owner?: unknown; username?: { localName?: unknown } } } };
  const account = data?.data?.account;
  if (data?.errors || !account || !isEvmAddress(account.address) || account.address.toLowerCase() !== identifier.toLowerCase()
    || !isEvmAddress(account.owner) || typeof account.username?.localName !== "string" || !usernamePattern.test(account.username.localName)) {
    throw new IdentityError("profile_not_found", 404);
  }
  return { provider, id: account.address.toLowerCase(), username: account.username.localName, ownerAddress: account.owner.toLowerCase() };
}
