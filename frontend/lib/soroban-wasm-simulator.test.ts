/**
 * soroban-wasm-simulator.test.ts - Tests for WASM Simulator
 */

import { SorobanWasmSimulator, useSorobanWasmSimulator } from './soroban-wasm-simulator';
import { TransactionBuilder, Account, xdr } from '@stellar/stellar-sdk';

// Mock the Stellar SDK
jest.mock('@stellar/stellar-sdk');

describe('SorobanWasmSimulator', () => {
  let simulator: SorobanWasmSimulator;
  let mockRpc: any;
  
  beforeEach(() => {
    mockRpc = {
      simulateTransaction: jest.fn(),
      getAccount: jest.fn(),
      getLatestLedger: jest.fn(),
    };
    
    simulator = new SorobanWasmSimulator({
      networkPassphrase: 'Test SDF Network ; September 2015',
      rpcUrl: 'https://test-rpc.stellar.org',
      enableCache: true,
      cacheSize: 10,
    });
    
    // Replace the internal RPC with mock
    (simulator as any).rpc = mockRpc;
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  describe('constructor', () => {
    it('should initialize with configuration', () => {
      expect(simulator).toBeInstanceOf(SorobanWasmSimulator);
    });
    
    it('should disable cache when configured', () => {
      const noCacheSim = new SorobanWasmSimulator({
        networkPassphrase: 'Test SDF Network ; September 2015',
        rpcUrl: 'https://test-rpc.stellar.org',
        enableCache: false,
      });
      
      expect(noCacheSim).toBeInstanceOf(SorobanWasmSimulator);
    });
  });
  
  describe('simulateContractCall', () => {
    it('should simulate contract call successfully', async () => {
      const mockAccount = new Account('GTEST', '1');
      const mockArgs = [xdr.ScVal.scvU32(xdr.Uint32.fromString('1'))];
      
      mockRpc.simulateTransaction.mockResolvedValue({
        results: [{ xdr: xdr.ScVal.scvU32(xdr.Uint32.fromString('42')) }],
        events: [],
        cost: { cpuInstructions: 1000, memoryBytes: 500 },
      });
      
      const result = await simulator.simulateContractCall(
        'C-TEST',
        'test_method',
        mockArgs,
        mockAccount
      );
      
      expect(result.success).toBe(true);
      expect(result.gasUsed).toBe(1000);
      expect(mockRpc.simulateTransaction).toHaveBeenCalled();
    });
    
    it('should handle simulation failure', async () => {
      const mockAccount = new Account('GTEST', '1');
      const mockArgs = [xdr.ScVal.scvU32(xdr.Uint32.fromString('1'))];
      
      mockRpc.simulateTransaction.mockResolvedValue({
        error: 'Simulation failed',
        events: [],
      });
      
      const result = await simulator.simulateContractCall(
        'C-TEST',
        'test_method',
        mockArgs,
        mockAccount
      );
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Simulation failed');
    });
    
    it('should use cache when enabled', async () => {
      const mockAccount = new Account('GTEST', '1');
      const mockArgs = [xdr.ScVal.scvU32(xdr.Uint32.fromString('1'))];
      
      mockRpc.simulateTransaction.mockResolvedValue({
        results: [{ xdr: xdr.ScVal.scvU32(xdr.Uint32.fromString('42')) }],
        events: [],
        cost: { cpuInstructions: 1000, memoryBytes: 500 },
      });
      
      // First call
      await simulator.simulateContractCall('C-TEST', 'test_method', mockArgs, mockAccount);
      // Second call should use cache
      await simulator.simulateContractCall('C-TEST', 'test_method', mockArgs, mockAccount);
      
      expect(mockRpc.simulateTransaction).toHaveBeenCalledTimes(1);
    });
  });
  
  describe('simulateTransaction', () => {
    it('should simulate transaction successfully', async () => {
      const mockTx = new TransactionBuilder(new Account('GTEST', '1'), {
        fee: '100',
        networkPassphrase: 'Test SDF Network ; September 2015',
      }).setTimeout(30).build();
      
      mockRpc.simulateTransaction.mockResolvedValue({
        results: [{ xdr: xdr.ScVal.scvU32(xdr.Uint32.fromString('42')) }],
        events: [],
        cost: { cpuInstructions: 1000, memoryBytes: 500 },
      });
      
      const result = await simulator.simulateTransaction(mockTx);
      
      expect(result.success).toBe(true);
      expect(result.gasUsed).toBe(1000);
    });
  });
  
  describe('estimateGas', () => {
    it('should estimate gas cost', async () => {
      const mockAccount = new Account('GTEST', '1');
      const mockArgs = [xdr.ScVal.scvU32(xdr.Uint32.fromString('1'))];
      
      mockRpc.simulateTransaction.mockResolvedValue({
        results: [{ xdr: xdr.ScVal.scvU32(xdr.Uint32.fromString('42')) }],
        events: [],
        cost: { cpuInstructions: 1000, memoryBytes: 500 },
      });
      
      const gas = await simulator.estimateGas('C-TEST', 'test_method', mockArgs, mockAccount);
      
      expect(gas).toBe(1100); // 100 base + 1000 resource
    });
    
    it('should throw on simulation failure', async () => {
      const mockAccount = new Account('GTEST', '1');
      const mockArgs = [xdr.ScVal.scvU32(xdr.Uint32.fromString('1'))];
      
      mockRpc.simulateTransaction.mockResolvedValue({
        error: 'Simulation failed',
        events: [],
      });
      
      await expect(
        simulator.estimateGas('C-TEST', 'test_method', mockArgs, mockAccount)
      ).rejects.toThrow('Gas estimation failed');
    });
  });
  
  describe('validateTransaction', () => {
    it('should validate successful transaction', async () => {
      const mockTx = new TransactionBuilder(new Account('GTEST', '1'), {
        fee: '100',
        networkPassphrase: 'Test SDF Network ; September 2015',
      }).setTimeout(30).build();
      
      mockRpc.simulateTransaction.mockResolvedValue({
        results: [{ xdr: xdr.ScVal.scvU32(xdr.Uint32.fromString('42')) }],
        events: [],
        cost: { cpuInstructions: 1000, memoryBytes: 500 },
      });
      
      const result = await simulator.validateTransaction(mockTx);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    
    it('should return errors for failed transaction', async () => {
      const mockTx = new TransactionBuilder(new Account('GTEST', '1'), {
        fee: '100',
        networkPassphrase: 'Test SDF Network ; September 2015',
      }).setTimeout(30).build();
      
      mockRpc.simulateTransaction.mockResolvedValue({
        error: 'Invalid transaction',
        events: [],
      });
      
      const result = await simulator.validateTransaction(mockTx);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid transaction');
    });
    
    it('should warn on high resource usage', async () => {
      const mockTx = new TransactionBuilder(new Account('GTEST', '1'), {
        fee: '100',
        networkPassphrase: 'Test SDF Network ; September 2015',
      }).setTimeout(30).build();
      
      mockRpc.simulateTransaction.mockResolvedValue({
        results: [{ xdr: xdr.ScVal.scvU32(xdr.Uint32.fromString('42')) }],
        events: [],
        cost: { cpuInstructions: 2000000, memoryBytes: 200000 },
      });
      
      const result = await simulator.validateTransaction(mockTx);
      
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(2);
    });
  });
  
  describe('getAccount', () => {
    it('should get account from RPC', async () => {
      mockRpc.getAccount.mockResolvedValue({
        sequenceNumber: '123456',
      });
      
      const account = await simulator.getAccount('GTEST');
      
      expect(account).toBeInstanceOf(Account);
      expect(mockRpc.getAccount).toHaveBeenCalledWith('GTEST');
    });
  });
  
  describe('getLedgerInfo', () => {
    it('should get latest ledger info', async () => {
      mockRpc.getLatestLedger.mockResolvedValue({
        sequence: 12345,
        timestamp: 1234567890,
      });
      
      const ledger = await simulator.getLedgerInfo();
      
      expect(ledger).toBeDefined();
      expect(mockRpc.getLatestLedger).toHaveBeenCalled();
    });
  });
  
  describe('cache management', () => {
    it('should clear cache', () => {
      simulator.clearCache();
      const stats = simulator.getCacheStats();
      
      expect(stats.size).toBe(0);
    });
    
    it('should return cache stats', () => {
      const stats = simulator.getCacheStats();
      
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('maxSize');
    });
  });
});

describe('useSorobanWasmSimulator', () => {
  it('should return simulator and methods', () => {
    const config = {
      networkPassphrase: 'Test SDF Network ; September 2015',
      rpcUrl: 'https://test-rpc.stellar.org',
    };
    
    const hook = useSorobanWasmSimulator(config);
    
    expect(hook).toHaveProperty('simulator');
    expect(hook).toHaveProperty('simulateContractCall');
    expect(hook).toHaveProperty('simulateTransaction');
    expect(hook).toHaveProperty('estimateGas');
    expect(hook).toHaveProperty('validateTransaction');
    expect(hook).toHaveProperty('getAccount');
    expect(hook).toHaveProperty('getLedgerInfo');
    expect(hook).toHaveProperty('clearCache');
    expect(hook).toHaveProperty('getCacheStats');
  });
});
