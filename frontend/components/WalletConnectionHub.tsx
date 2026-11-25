import React from 'react';
import { useStellarWallet } from '../context/StellarWalletContext';
import { WalletNetwork } from '@/context/StellarWalletContext';

export const WalletConnectionHub: React.FC = () => {
  const {
    address,
    walletId,
    network,
    isConnected,
    connectWallet,
    disconnectWallet,
    switchNetwork,
  } = useStellarWallet();

  const truncateAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <div className="flex items-center gap-4 p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
      {/* Network Selector */}
      <select
        value={network}
        onChange={(e) => switchNetwork(e.target.value as WalletNetwork)}
        className="px-3 py-1.5 text-sm font-medium border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option value={WalletNetwork.TESTNET}>Testnet</option>
        <option value={WalletNetwork.PUBLIC}>Mainnet</option>
      </select>

      {/* Wallet Action Button */}
      {isConnected && address ? (
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="block text-xs font-semibold capitalize text-muted-foreground">
              {walletId ?? 'Wallet'}
            </span>
            <span className="font-mono text-sm font-medium">
              {truncateAddress(address)}
            </span>
          </div>
          <button
            onClick={disconnectWallet}
            className="px-3 py-1.5 text-sm font-medium text-destructive border border-destructive/30 hover:bg-destructive/10 rounded-md transition-colors"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          onClick={connectWallet}
          className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 rounded-md shadow transition-colors"
        >
          Connect Wallet
        </button>
      )}
    </div>
  );
};