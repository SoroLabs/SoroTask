"use client";

import { useSorobanEnvironment } from "@/src/lib/soroban/useSorobanEnvironment";
import type { SorobanNetwork } from "@/src/lib/soroban/types";

const LABELS: Record<SorobanNetwork, string> = {
  testnet: "Testnet",
  mainnet: "Mainnet",
};

/**
 * Toggle button that switches the active Soroban network.
 * Shows a warning badge when mainnet is selected.
 */
export function EnvironmentSwitcher() {
  const { network, setNetwork, isMainnet } = useSorobanEnvironment();

  function toggle() {
    setNetwork(isMainnet ? "testnet" : "mainnet");
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-label={`Switch to ${isMainnet ? "testnet" : "mainnet"}`}
        className={[
          "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
          isMainnet
            ? "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-200 dark:hover:bg-amber-800"
            : "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900 dark:text-emerald-200 dark:hover:bg-emerald-800",
        ].join(" ")}
      >
        <span
          className={[
            "inline-block h-2 w-2 rounded-full",
            isMainnet ? "bg-amber-500" : "bg-emerald-500",
          ].join(" ")}
          aria-hidden
        />
        {LABELS[network]}
        {isMainnet && (
          <span className="ml-1 rounded bg-amber-500 px-1 py-0.5 text-[10px] font-bold uppercase text-white">
            Live
          </span>
        )}
      </button>
    </div>
  );
}
