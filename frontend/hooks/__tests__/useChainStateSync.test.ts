/**
 * useChainStateSync.test.ts - Tests for Chain State Sync Hook
 */

import { renderHook, act } from '@testing-library/react';
import { useChainStateSync, useTransactionMonitor, useReorgDetector } from '../useChainStateSync';

// Mock Stellar SDK
jest.mock('@stellar/stellar-sdk', () => ({
  SorobanRpc: {
    Server: jest.fn(),
    Api: {
      GetTransactionStatus: {
        SUCCESS: 'SUCCESS',
        FAILED: 'FAILED',
        NOT_FOUND: 'NOT_FOUND',
      },
    },
  },
}));

describe('useChainStateSync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with default state', () => {
      const { result } = renderHook(() =>
        useChainStateSync({
          rpcUrl: 'https://test-rpc.stellar.org',
          networkPassphrase: 'Test SDF Network ; September 2015',
        })
      );

      expect(result.current.state.ledgerSequence).toBe(0);
      expect(result.current.state.isSyncing).toBe(false);
      expect(result.current.isHealthy).toBe(true);
    });

    it('should accept custom configuration', () => {
      const { result } = renderHook(() =>
        useChainStateSync({
          rpcUrl: 'https://test-rpc.stellar.org',
          networkPassphrase: 'Test SDF Network ; September 2015',
          syncInterval: 10000,
          reorgThreshold: 20,
        })
      );

      expect(result.current).toBeDefined();
    });
  });

  describe('sync', () => {
    it('should sync successfully', async () => {
      const mockRpc = {
        getLatestLedger: jest.fn().mockResolvedValue({
          sequence: 12345,
          timestamp: 1234567890,
        }),
      };

      (require('@stellar/stellar-sdk').SorobanRpc.Server as jest.Mock).mockImplementation(() => mockRpc);

      const { result } = renderHook(() =>
        useChainStateSync({
          rpcUrl: 'https://test-rpc.stellar.org',
          networkPassphrase: 'Test SDF Network ; September 2015',
        })
      );

      await act(async () => {
        await result.current.sync();
      });

      expect(result.current.state.ledgerSequence).toBe(12345);
      expect(result.current.state.isSyncing).toBe(false);
    });

    it('should handle sync errors', async () => {
      const mockRpc = {
        getLatestLedger: jest.fn().mockRejectedValue(new Error('RPC error')),
      };

      (require('@stellar/stellar-sdk').SorobanRpc.Server as jest.Mock).mockImplementation(() => mockRpc);

      const { result } = renderHook(() =>
        useChainStateSync({
          rpcUrl: 'https://test-rpc.stellar.org',
          networkPassphrase: 'Test SDF Network ; September 2015',
        })
      );

      await act(async () => {
        await result.current.sync();
      });

      expect(result.current.error).toBe('RPC error');
      expect(result.current.isHealthy).toBe(false);
    });
  });

  describe('transaction management', () => {
    it('should add transaction', () => {
      const { result } = renderHook(() =>
        useChainStateSync({
          rpcUrl: 'https://test-rpc.stellar.org',
          networkPassphrase: 'Test SDF Network ; September 2015',
        })
      );

      act(() => {
        result.current.addTransaction('tx123');
      });

      expect(result.current.transactions.has('tx123')).toBe(true);
      expect(result.current.transactions.get('tx123')?.status).toBe('pending');
    });

    it('should remove transaction', () => {
      const { result } = renderHook(() =>
        useChainStateSync({
          rpcUrl: 'https://test-rpc.stellar.org',
          networkPassphrase: 'Test SDF Network ; September 2015',
        })
      );

      act(() => {
        result.current.addTransaction('tx123');
      });

      act(() => {
        result.current.removeTransaction('tx123');
      });

      expect(result.current.transactions.has('tx123')).toBe(false);
    });

    it('should get transaction state', () => {
      const { result } = renderHook(() =>
        useChainStateSync({
          rpcUrl: 'https://test-rpc.stellar.org',
          networkPassphrase: 'Test SDF Network ; September 2015',
        })
      );

      act(() => {
        result.current.addTransaction('tx123');
      });

      const tx = result.current.getTransaction('tx123');

      expect(tx).toBeDefined();
      expect(tx?.hash).toBe('tx123');
    });
  });

  describe('forceSync', () => {
    it('should force immediate sync', async () => {
      const mockRpc = {
        getLatestLedger: jest.fn().mockResolvedValue({
          sequence: 12345,
          timestamp: 1234567890,
        }),
      };

      (require('@stellar/stellar-sdk').SorobanRpc.Server as jest.Mock).mockImplementation(() => mockRpc);

      const { result } = renderHook(() =>
        useChainStateSync({
          rpcUrl: 'https://test-rpc.stellar.org',
          networkPassphrase: 'Test SDF Network ; September 2015',
        })
      );

      await act(async () => {
        await result.current.forceSync();
      });

      expect(result.current.state.ledgerSequence).toBe(12345);
    });
  });
});

describe('useTransactionMonitor', () => {
  it('should monitor transaction state', () => {
    const mockChainSync = {
      getTransaction: jest.fn().mockReturnValue({
        hash: 'tx123',
        status: 'pending',
      }),
    };

    const { result } = renderHook(() =>
      useTransactionMonitor('tx123', mockChainSync as any)
    );

    expect(result.current).toBeDefined();
    expect(result.current?.hash).toBe('tx123');
  });
});

describe('useReorgDetector', () => {
  it('should detect reorg', () => {
    const mockChainSync = {
      state: {
        reorgDepth: 15,
        isSyncing: true,
      },
    };

    const { result } = renderHook(() =>
      useReorgDetector(mockChainSync as any)
    );

    expect(result.current.hasReorg).toBe(true);
    expect(result.current.reorgDepth).toBe(15);
    expect(result.current.isRecovering).toBe(true);
  });

  it('should not detect reorg when depth is zero', () => {
    const mockChainSync = {
      state: {
        reorgDepth: 0,
        isSyncing: false,
      },
    };

    const { result } = renderHook(() =>
      useReorgDetector(mockChainSync as any)
    );

    expect(result.current.hasReorg).toBe(false);
    expect(result.current.isRecovering).toBe(false);
  });
});
