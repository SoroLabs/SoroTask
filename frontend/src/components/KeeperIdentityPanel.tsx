"use client";
import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { isIdentityChallenge, isSocialProvider, isVerifiedSocialIdentity, type SocialProvider, type VerifiedSocialIdentity } from "@/src/lib/auth/keeper-identities";
import { signKeeperIdentity, signSocialOwner } from "@/src/lib/auth/identity-wallet";

const ENDPOINT = "/api/auth/keeper-identities";
const ERROR_MESSAGES: Record<string, string> = {
  github_sign_in_required: "Sign in with GitHub before linking your GitHub profile.",
  provider_not_configured: "This provider is not available yet. Try another provider.",
  identity_not_configured: "Identity linking is not available yet.",
  provider_unavailable: "The social provider is unavailable. Try again later.",
  profile_not_found: "The social profile could not be found.",
  invalid_profile: "Enter a valid Farcaster FID or Lens account address.",
  invalid_wallet: "A valid Stellar keeper account is required.",
  challenge_expired: "The signing request expired. Start a new request.",
  invalid_challenge: "The signing request was already used or is invalid. Start again.",
  invalid_wallet_signature: "The Stellar wallet signature did not match this request.",
  invalid_owner_signature: "The social owner signature did not match this profile.",
  profile_owner_changed: "The social profile owner changed. Start again.",
  profile_already_linked: "This profile is linked to another keeper. Unlink it there first.",
  too_many_challenges: "Too many pending requests. Wait five minutes before trying again.",
  sign_in_required: "Sign in to link a keeper identity.",
  storage_busy: "Identity storage is busy. Try again shortly.",
  storage_unavailable: "Identity storage is unavailable. Try again later.",
  storage_invalid: "Identity linking is temporarily unavailable. Contact the service operator.",
  storage_capacity: "Identity linking is temporarily full. Contact the service operator.",
  identity_not_linked: "This profile is already unlinked. Refresh the page.",
};

async function requestJson(body: Record<string, unknown>) {
  const response = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(ERROR_MESSAGES[data?.error?.code] ?? "Identity verification failed. Please try again.");
  return data;
}

export function KeeperIdentityPanel({ address, identities, onChanged }: { address?: string; identities: VerifiedSocialIdentity[]; onChanged(): void }) {
  const [provider, setProvider] = useState<SocialProvider>("github");
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [github, setGithub] = useState<{ id: string; username: string } | null>(null);
  const [available, setAvailable] = useState({ github: true, farcaster: false, lens: false });
  const wallet = useRef(address);
  const active = useRef(true);
  const submitting = useRef(false);
  wallet.current = address;

  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    fetch(ENDPOINT, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json();
      if (controller.signal.aborted) return;
      const profile = data.github;
      setGithub(profile && typeof profile.id === "string" && /^\d{1,20}$/.test(profile.id)
        && typeof profile.username === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(profile.username) ? profile : null);
      if (data.providers) setAvailable({ github: data.providers.github === true, farcaster: data.providers.farcaster === true, lens: data.providers.lens === true });
    }).catch(() => undefined);
    return () => { active.current = false; controller.abort(); };
  }, []);

  const complete = async (action: "link" | "unlink", selected: SocialProvider) => {
    if (!address || submitting.current) return;
    const expected = address;
    const ensureCurrentWallet = () => {
      if (!active.current || wallet.current !== expected) throw new Error("Wallet account changed. Start again.");
    };
    submitting.current = true;
    setBusy(true); setError(null); setNotice(null);
    try {
      const data = await requestJson({ operation: "challenge", provider: selected, identifier, walletAddress: address, action });
      const challenge: unknown = data.challenge;
      if (!isIdentityChallenge(challenge, { address: expected, provider: selected, action, origin: window.location.origin, network: "Test SDF Future Network ; October 2022" })) {
        throw new Error("The identity signing request is invalid. Start again.");
      }
      if (action === "link" && (selected === "github" ? challenge.providerId !== github?.id
        : challenge.providerId !== identifier.toLowerCase())) throw new Error("The signing request does not match the selected profile. Start again.");
      ensureCurrentWallet();
      setNotice(challenge.ownerAddress ? "Confirm the social owner signature, then the Stellar keeper signature." : "Confirm the profile link request in Freighter.");
      const ownerSignature = await signSocialOwner(challenge);
      ensureCurrentWallet();
      if (Date.now() >= challenge.expiresAt) throw new Error("The signing request expired. Start a new request.");
      const walletSignature = await signKeeperIdentity(challenge);
      ensureCurrentWallet();
      const completed = await requestJson({ operation: "complete", nonce: challenge.nonce, walletSignature, ownerSignature });
      ensureCurrentWallet();
      if (action === "link" ? !isVerifiedSocialIdentity(completed.identity, expected)
        || completed.identity.provider !== selected || completed.identity.providerId !== challenge.providerId
        : completed.identity !== null) throw new Error("The identity service returned an invalid verification result. Refresh and try again.");
      setNotice(action === "link" ? "Profile ownership verified and linked." : "Profile unlinked.");
      onChanged();
    } catch (cause) {
      if (active.current) {
        setError(cause instanceof Error ? cause.message : "Identity verification failed.");
        setNotice(null);
      }
    } finally { submitting.current = false; if (active.current) setBusy(false); }
  };

  return (
    <section aria-labelledby="keeper-identity-heading" className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
      <h2 id="keeper-identity-heading" className="text-lg font-semibold">Link a verified social profile</h2>
      <p className="mt-2 text-sm text-neutral-400">Prove ownership of your social profile and keeper wallet. Signing does not send funds or change wallet permissions.</p>
      {!address && <p className="mt-3 text-sm">Connect your Stellar keeper wallet to begin.</p>}
      <form onSubmit={(event) => { event.preventDefault(); void complete("link", provider); }} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm" htmlFor="keeper-social-provider">Social provider
          <select id="keeper-social-provider" value={provider} disabled={busy || !address}
            onChange={(event) => { if (isSocialProvider(event.target.value)) { setProvider(event.target.value); setIdentifier(""); setError(null); } }}
            className="rounded border border-neutral-600 bg-neutral-950 px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-300">
            <option value="github">GitHub</option><option value="farcaster">Farcaster</option><option value="lens">Lens</option>
          </select>
        </label>
        {provider !== "github" && <label className="grid gap-1 text-sm" htmlFor="keeper-social-id">
          {provider === "farcaster" ? "Farcaster FID" : "Lens account address"}
          <input id="keeper-social-id" value={identifier} onChange={(event) => setIdentifier(event.target.value.trim())} required maxLength={100} disabled={busy || !address}
            aria-describedby="social-owner-help" className="rounded border border-neutral-600 bg-neutral-950 px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-300" />
        </label>}
        {provider === "github" && !github && <button type="button" disabled={busy || !available.github} onClick={() => void signIn("github", { callbackUrl: "/keepers" })}
          className="rounded border border-neutral-600 px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-300">Sign in with GitHub</button>}
        <button type="submit" disabled={busy || !address || !available[provider] || (provider === "github" && !github)}
          className="rounded bg-blue-600 px-4 py-2 font-medium disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300">
          {busy ? "Verifying…" : "Verify and link"}
        </button>
      </form>
      {provider === "github" && github && <p className="mt-3 text-sm">Signed in as GitHub {github.username}.</p>}
      {provider !== "github" && <p id="social-owner-help" className="mt-3 text-sm text-neutral-400">Use the Ethereum wallet that owns the {provider === "farcaster" ? "Farcaster custody account" : "Lens profile"}, followed by Freighter for the Stellar keeper account.</p>}
      {!available[provider] && <p className="mt-3 text-sm">This provider is currently unavailable.</p>}
      <p role="status" aria-live="polite" className="mt-3 text-sm text-emerald-300">{notice}</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      {identities.filter((item) => address && isVerifiedSocialIdentity(item, address)).map((item) => <button key={item.provider} type="button" disabled={busy} onClick={() => void complete("unlink", item.provider)}
        className="mr-3 mt-3 rounded border border-neutral-600 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-blue-300">Unlink {item.provider}</button>)}
    </section>
  );
}
