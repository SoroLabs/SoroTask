"use client";
import { memo, useEffect, useState } from "react";
import { isVerifiedSocialIdentity, type VerifiedSocialIdentity } from "@/src/lib/auth/keeper-identities";

const LABELS = { github: "GitHub", farcaster: "Farcaster", lens: "Lens" };

export const KeeperSocialBadges = memo(function KeeperSocialBadges({ address, identities = [] }: { address: string; identities?: VerifiedSocialIdentity[] }) {
  const [clock, setClock] = useState(0);
  const verified = identities.filter((identity) => isVerifiedSocialIdentity(identity, address));
  const nextExpiry = verified.length ? Math.min(...verified.map((identity) => identity.expiresAt)) : null;
  useEffect(() => {
    if (nextExpiry === null) return;
    const timer = window.setTimeout(() => setClock((value) => value + 1), Math.max(1, Math.min(nextExpiry - Date.now(), 2_147_483_647)));
    return () => window.clearTimeout(timer);
  }, [nextExpiry, clock]);
  if (!verified.length) return null;
  return (
    <ul aria-label="Verified social profiles" className="mt-2 flex flex-wrap gap-2">
      {verified.map((identity) => (
        <li key={`${identity.provider}:${identity.providerId}`}>
          <a href={identity.profileUrl} target="_blank" rel="noopener noreferrer"
            aria-label={`${LABELS[identity.provider]} ${identity.username}, ownership verified, opens in a new tab`}
            title={`Account ownership verified ${new Date(identity.verifiedAt).toLocaleDateString()}. This is not an endorsement.`}
            className="inline-flex rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300">
            ✓ {LABELS[identity.provider]}: {identity.username}
          </a>
        </li>
      ))}
    </ul>
  );
});
