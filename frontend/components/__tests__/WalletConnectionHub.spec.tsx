import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WalletConnectionHub } from '../WalletConnectionHub';
import { useStellarWallet } from '../../context/StellarWalletContext';
import { WalletNetwork } from '@/context/StellarWalletContext';

jest.mock('../../context/StellarWalletContext');

describe('WalletConnectionHub', () => {
  const mockConnectWallet = jest.fn();
  const mockDisconnectWallet = jest.fn();
  const mockSwitchNetwork = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders Connect Wallet button when disconnected', () => {
    (useStellarWallet as jest.Mock).mockReturnValue({
      address: null,
      walletId: null,
      network: WalletNetwork.TESTNET,
      isConnected: false,
      connectWallet: mockConnectWallet,
      disconnectWallet: mockDisconnectWallet,
      switchNetwork: mockSwitchNetwork,
    });

    render(<WalletConnectionHub />);

    const connectBtn = screen.getByRole('button', { name: /connect wallet/i });
    expect(connectBtn).toBeInTheDocument();

    fireEvent.click(connectBtn);
    expect(mockConnectWallet).toHaveBeenCalledTimes(1);
  });

  it('renders truncated address and Disconnect button when connected', () => {
    (useStellarWallet as jest.Mock).mockReturnValue({
      address: 'GBRPYHIL2CI3FNQ4BXLFMNDLF2C3KCJPO',
      walletId: 'freighter',
      network: WalletNetwork.TESTNET,
      isConnected: true,
      connectWallet: mockConnectWallet,
      disconnectWallet: mockDisconnectWallet,
      switchNetwork: mockSwitchNetwork,
    });

    render(<WalletConnectionHub />);

    expect(screen.getByText('freighter')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });
});