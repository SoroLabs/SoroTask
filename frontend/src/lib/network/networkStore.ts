import { create } from "zustand";
import { NetworkType, NetworkConfig, NETWORK_CONFIGS, NETWORK_STORAGE_KEY } from "./types";

export interface NetworkState {
  currentNetwork: NetworkType;
  config: NetworkConfig;
  activeRpcUrl: string;
  activeContractId: string;
  walletSynced: boolean;
  isSwitching: boolean;
  syncPromptRequired: boolean;
  
  // Actions
  switchNetwork: (targetNetwork: NetworkType, options?: { clearCaches?: boolean }) => Promise<void>;
  promptWalletNetworkSync: () => Promise<boolean>;
  setWalletSynced: (synced: boolean) => void;
  clearNetworkCaches: (network?: NetworkType) => void;
}

function getSavedNetwork(): NetworkType {
  if (typeof window === "undefined") return "testnet";
  try {
    const saved = localStorage.getItem(NETWORK_STORAGE_KEY) as NetworkType;
    if (saved && NETWORK_CONFIGS[saved]) {
      return saved;
    }
  } catch {
    // Ignore SSR or localStorage error
  }
  return "testnet";
}

export const useNetworkStore = create<NetworkState>((set, get) => {
  const initialNetwork = getSavedNetwork();
  const initialConfig = NETWORK_CONFIGS[initialNetwork];

  return {
    currentNetwork: initialNetwork,
    config: initialConfig,
    activeRpcUrl: initialConfig.rpcUrl,
    activeContractId: initialConfig.contractId,
    walletSynced: true,
    isSwitching: false,
    syncPromptRequired: false,

    switchNetwork: async (targetNetwork: NetworkType, options = { clearCaches: true }) => {
      const current = get().currentNetwork;
      if (current === targetNetwork && !get().syncPromptRequired) {
        return;
      }

      set({ isSwitching: true });

      const newConfig = NETWORK_CONFIGS[targetNetwork];

      // 1. Isolate and clear caches if requested
      if (options.clearCaches) {
        get().clearNetworkCaches(current);
      }

      // 2. Persist active network selection
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(NETWORK_STORAGE_KEY, targetNetwork);
        } catch {
          // LocalStorage fallback
        }
      }

      // 3. Update active RPC URL and Contract ID in state
      set({
        currentNetwork: targetNetwork,
        config: newConfig,
        activeRpcUrl: newConfig.rpcUrl,
        activeContractId: newConfig.contractId,
        isSwitching: false,
        walletSynced: false,
        syncPromptRequired: true,
      });

      // 4. Prompt wallet network sync
      await get().promptWalletNetworkSync();
    },

    promptWalletNetworkSync: async () => {
      const { config } = get();
      
      // Dispatch custom DOM event for connected wallet providers to listen to
      if (typeof window !== "undefined") {
        const event = new CustomEvent("sorotask:network_change_request", {
          detail: {
            network: config.network,
            networkPassphrase: config.networkPassphrase,
            rpcUrl: config.rpcUrl,
          },
        });
        window.dispatchEvent(event);
      }

      // Mark sync state
      set({ walletSynced: true, syncPromptRequired: false });
      return true;
    },

    setWalletSynced: (synced: boolean) => {
      set({ walletSynced: synced, syncPromptRequired: !synced });
    },

    clearNetworkCaches: (network?: NetworkType) => {
      if (typeof window === "undefined") return;

      const targetNet = network || get().currentNetwork;

      // Clear IndexedDB cache partition for specified network
      try {
        if ("indexedDB" in window) {
          const dbName = `sorotask_cache_${targetNet}`;
          window.indexedDB.deleteDatabase(dbName);
        }
      } catch (err) {
        console.warn("Failed to clear IndexedDB partition:", err);
      }

      // Clear network-scoped sessionStorage items
      try {
        Object.keys(sessionStorage).forEach((key) => {
          if (key.startsWith(`cache_${targetNet}_`)) {
            sessionStorage.removeItem(key);
          }
        });
      } catch {
        // Fallback
      }
    },
  };
});
