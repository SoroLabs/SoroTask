import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from 'react';

export const WalletNetwork = {
  TESTNET: 'TESTNET',
  PUBLIC: 'PUBLIC',
} as const;

export type WalletNetwork = typeof WalletNetwork[keyof typeof WalletNetwork];

export const ALLOW_ALL_MODULES = true;
export const FREIGHTER_ID = 'freighter';
export const ALBEDO_ID = 'albedo';
export const XBULL_ID = 'xbull';
export const LOBSTR_ID = 'lobstr';

export class StellarWalletsKit {
  constructor(public config: any) {}
}

interface WalletState {
  address: string | null;
  walletId: string | null;
  network: WalletNetwork;
  isConnected: boolean;
}

interface StellarWalletContextType extends WalletState {
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  switchNetwork: (network: WalletNetwork) => void;
  kit: StellarWalletsKit | null;
  /** True while a silent background reconnection attempt is in progress. */
  reconnecting: boolean;
  /** True when a persisted session was found but could not be silently restored. */
  sessionExpired: boolean;
  /** Dismiss the session-expired inline banner. */
  dismissSessionExpired: () => void;
}

// Use sessionStorage so the persisted session is scoped to the browser tab
// and is automatically cleared when the tab is closed (per issue #881).
const STORAGE_KEY = 'stellar_wallet_session';
const storage = typeof window !== 'undefined' ? window.sessionStorage : null;

const StellarWalletContext = createContext<StellarWalletContextType | undefined>(
  undefined,
);

export const StellarWalletProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [network, setNetwork] = useState<WalletNetwork>(WalletNetwork.TESTNET);
  const [walletState, setWalletState] = useState<WalletState>({
    address: null,
    walletId: null,
    network: WalletNetwork.TESTNET,
    isConnected: false,
  });
  const [kit, setKit] = useState<StellarWalletsKit | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Initialize StellarWalletsKit instance
  useEffect(() => {
    const walletKit = new StellarWalletsKit({
      network,
      selectedWalletId: FREIGHTER_ID,
      modules: ALLOW_ALL_MODULES,
    });

    setKit(walletKit);
  }, [network]);

  // Silent re-connection on app initialisation (issue #881).
  // Reads the persisted wallet type from sessionStorage and attempts a
  // background re-connection via the wallet's background API without showing
  // the modal. If the session is expired or the wallet rejects the silent
  // request, we surface an unobtrusive inline banner instead.
  useEffect(() => {
    if (!kit) return;

    const savedSession = storage?.getItem(STORAGE_KEY);
    if (!savedSession) return;

    let parsed: { address: string; walletId: string; savedNetwork?: WalletNetwork } | null =
      null;
    try {
      parsed = JSON.parse(savedSession);
    } catch {
      storage?.removeItem(STORAGE_KEY);
      return;
    }

    if (!parsed?.address || !parsed?.walletId) {
      storage?.removeItem(STORAGE_KEY);
      return;
    }

    const { address, walletId, savedNetwork } = parsed;

    setReconnecting(true);
    kit.setWallet(walletId);

    // Attempt to silently verify the address is still accessible.
    kit
      .getAddress()
      .then(({ address: freshAddress }) => {
        // Use the freshly resolved address; fall back to the cached one if
        // the wallet returns an empty string (some wallets behave this way
        // when the extension is locked but not expired).
        const resolvedAddress = freshAddress || address;
        setWalletState({
          address: resolvedAddress,
          walletId,
          network: savedNetwork || WalletNetwork.TESTNET,
          isConnected: true,
        });
        storage?.setItem(
          STORAGE_KEY,
          JSON.stringify({ address: resolvedAddress, walletId, savedNetwork }),
        );
      })
      .catch(() => {
        // Silent reconnection failed — the session is expired or the wallet
        // extension is unavailable. Show an inline banner instead of a modal.
        storage?.removeItem(STORAGE_KEY);
        setSessionExpired(true);
      })
      .finally(() => {
        setReconnecting(false);
      });
  }, [kit]);

  const connectWallet = useCallback(async () => {
    if (!kit) return;

    try {
      await kit.openModal({
        onWalletSelected: async (option) => {
          kit.setWallet(option.id);
          const { address } = await kit.getAddress();

          const newState = {
            address,
            walletId: option.id,
            network,
            isConnected: true,
          };

          setWalletState(newState);
          storage?.setItem(STORAGE_KEY, JSON.stringify(newState));
        },
      });
    } catch (error) {
      console.error('Error connecting to wallet:', error);
    }
  }, [kit, network]);

  const disconnectWallet = useCallback(async () => {
    if (kit) {
      await kit.disconnect();
    }
    setWalletState({
      address: null,
      walletId: null,
      network,
      isConnected: false,
    });
    storage?.removeItem(STORAGE_KEY);
  }, [kit, network]);

  const switchNetwork = useCallback(
    (newNetwork: WalletNetwork) => {
      setNetwork(newNetwork);
      setWalletState((prev) => {
        const updated = { ...prev, network: newNetwork };
        if (prev.isConnected) {
          storage?.setItem(STORAGE_KEY, JSON.stringify(updated));
        }
        return updated;
      });
    },
    [],
  );

  const dismissSessionExpired = useCallback(() => setSessionExpired(false), []);

  return (
    <StellarWalletContext.Provider
      value={{
        ...walletState,
        connectWallet,
        disconnectWallet,
        switchNetwork,
        kit,
        reconnecting,
        sessionExpired,
        dismissSessionExpired,
      }}
    >
      {children}
    </StellarWalletContext.Provider>
  );
};

export const useStellarWallet = () => {
  const context = useContext(StellarWalletContext);
  if (!context) {
    return {
      address: null,
      walletId: null,
      network: WalletNetwork.TESTNET,
      isConnected: false,
      connectWallet: async () => {},
      disconnectWallet: async () => {},
      switchNetwork: () => {},
      kit: null,
      reconnecting: false,
      sessionExpired: false,
      dismissSessionExpired: () => {},
    };
  }
  return context;
};