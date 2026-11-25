import {
  NETWORK_CONFIGS,
  STORAGE_KEY,
  type SorobanNetwork,
  type NetworkConfig,
} from "./types";

type Listener = (config: NetworkConfig) => void;

/**
 * Lightweight observable store for the active Soroban network.
 *
 * Persists the selection to localStorage and notifies subscribers on change.
 * Safe to construct in SSR — storage access is guarded behind typeof checks.
 */
export class SorobanEnvironmentStore {
  private current: SorobanNetwork;
  private listeners = new Set<Listener>();

  constructor() {
    this.current = this.loadPersistedNetwork();
  }

  getConfig(): NetworkConfig {
    return NETWORK_CONFIGS[this.current];
  }

  getNetwork(): SorobanNetwork {
    return this.current;
  }

  setNetwork(network: SorobanNetwork): void {
    if (network === this.current) return;
    this.current = network;
    this.persist(network);
    const config = NETWORK_CONFIGS[network];
    for (const l of this.listeners) l(config);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private loadPersistedNetwork(): SorobanNetwork {
    if (typeof localStorage === "undefined") return "testnet";
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "mainnet" || stored === "testnet") return stored;
    } catch {
      // storage blocked
    }
    return "testnet";
  }

  private persist(network: SorobanNetwork): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, network);
    } catch {
      // storage blocked — best-effort
    }
  }
}

let _store: SorobanEnvironmentStore | null = null;

export function getSorobanEnvironmentStore(): SorobanEnvironmentStore {
  if (!_store) _store = new SorobanEnvironmentStore();
  return _store;
}
