"use client";

import { useCallback, useEffect, useState } from "react";
import { getSorobanEnvironmentStore } from "./EnvironmentStore";
import type { NetworkConfig, SorobanNetwork } from "./types";

interface UseSorobanEnvironmentResult {
  network: SorobanNetwork;
  config: NetworkConfig;
  setNetwork: (network: SorobanNetwork) => void;
  isMainnet: boolean;
}

/**
 * Reads and updates the active Soroban network from the singleton environment
 * store, keeping the component in sync when the store changes.
 */
export function useSorobanEnvironment(): UseSorobanEnvironmentResult {
  const store = getSorobanEnvironmentStore();
  const [config, setConfig] = useState<NetworkConfig>(() => store.getConfig());

  useEffect(() => {
    const unsubscribe = store.subscribe(setConfig);
    // Sync in case the store changed between render and effect
    setConfig(store.getConfig());
    return unsubscribe;
  }, []); // store is a stable singleton

  const setNetwork = useCallback(
    (network: SorobanNetwork) => store.setNetwork(network),
    [] // store is stable
  );

  return {
    network: config.network,
    config,
    setNetwork,
    isMainnet: config.network === "mainnet",
  };
}
