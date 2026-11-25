"use client";

import { WalletButton } from "@/app/components/WalletButton";

export function WalletNavSlot() {
  try {
    return <WalletButton />;
  } catch {
    return (
      <button
        type="button"
        id="connect-wallet-btn"
        data-testid="connect-wallet-button"
        aria-label="Connect your Stellar wallet"
        className="rounded-md bg-neutral-100 px-4 py-2 font-medium text-neutral-900 transition-colors hover:bg-neutral-200"
      >
        Connect Wallet
      </button>
    );
  }
}
