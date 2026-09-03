const parser = require('../parser');
const { gzipSync } = require('zlib');
const registry = require('../registry');
const errorHandler = require('../errorHandler');
const Monitor = require('../monitor');
const abiRegistryService = require('../index');
const { AbiCache } = require('../abiCache');

describe('ABIRegistryService', () => {
  beforeEach(() => {
    registry.clear();
    errorHandler.clearErrors();
    jest.clearAllMocks();
    
    // Silence console during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('ErrorHandler', () => {
    it('should log and store errors correctly', () => {
      errorHandler.logError('TestContext', new Error('Test error message'));
      const errors = errorHandler.getRecentErrors();
      expect(errors.length).toBe(1);
      expect(errors[0].context).toBe('TestContext');
      expect(errors[0].message).toBe('Test error message');
    });
    
    it('should handle string errors', () => {
      errorHandler.logError('TestContext', 'String error message');
      const errors = errorHandler.getRecentErrors();
      expect(errors.length).toBe(1);
      expect(errors[0].message).toBe('String error message');
    });
  });

  describe('Parser', () => {
    it('should extract ABI successfully from valid data', () => {
      const rawData = {
        bytecode: '0x1234',
        mockFunctions: [{ name: 'testFunc' }]
      };
      const abi = parser.extractABI(rawData);
      expect(abi).not.toBeNull();
      expect(abi.functions[0].name).toBe('testFunc');
      expect(abi.version).toBe('1.0.0');
    });

    it('should return null and log error if bytecode is missing', () => {
      const rawData = { mockFunctions: [] };
      const abi = parser.extractABI(rawData);
      expect(abi).toBeNull();
      expect(errorHandler.getRecentErrors().length).toBe(1);
    });

    it('should handle simulated parsing errors', () => {
      const rawData = { bytecode: '0x1234', simulatedError: true };
      const abi = parser.extractABI(rawData);
      expect(abi).toBeNull();
      expect(errorHandler.getRecentErrors()[0].message).toBe('Simulated parsing error');
    });

    it('should parse raw and compressed WASM payloads', async () => {
      const wasm = Buffer.concat([Buffer.from([0x00, 0x61, 0x73, 0x6d]), Buffer.from([1, 0, 0, 0])]);

      await expect(parser.extractABI({ bytecode: wasm })).resolves.toMatchObject({ version: '1.0.0' });
      await expect(parser.extractABI({ bytecode: gzipSync(wasm) })).resolves.toMatchObject({ version: '1.0.0' });
    });

    it('should reject invalid WASM magic bytes', async () => {
      const result = await parser.extractABI({ bytecode: gzipSync(Buffer.from('not wasm')) });

      expect(result).toBeNull();
      expect(errorHandler.getRecentErrors()[0].message).toBe('Invalid WASM magic bytes');
    });

    it('should reject oversized compressed and uncompressed payloads', async () => {
      const oversizedCompressed = Buffer.alloc(parser.MAX_COMPRESSED_SIZE + 1);
      const oversizedWasm = Buffer.concat([
        Buffer.from([0x00, 0x61, 0x73, 0x6d]),
        Buffer.alloc(parser.MAX_UNCOMPRESSED_SIZE + 1 - 4)
      ]);

      await expect(parser.extractABI({ bytecode: oversizedCompressed })).resolves.toBeNull();
      expect(errorHandler.getRecentErrors()[0].message).toBe('Compressed bytecode exceeds 2097152 bytes');

      await expect(parser.extractABI({ bytecode: gzipSync(oversizedWasm) })).resolves.toBeNull();
      expect(errorHandler.getRecentErrors()[1].message).toBe('Uncompressed bytecode exceeds 10485760 bytes');
    });

    it('should return a structured 422 response for corrupted sections', async () => {
      const corruptedWasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 0, 5, 1, 2]);
      const response = await parser.extractABIResponse({ bytecode: corruptedWasm });

      expect(response).toEqual({
        status: 422,
        body: { error: { code: 'SECTION_OUT_OF_BOUNDS', message: 'WASM section exceeds bytecode bounds', status: 422 } }
      });
    });

    it('should not throw for 1,000 mutated WASM samples', async () => {
      const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);

      for (let sample = 0; sample < 1000; sample += 1) {
        const mutated = Buffer.from(wasm);
        mutated[sample % mutated.length] ^= (sample % 255) + 1;
        await expect(parser.extractABI({ bytecode: mutated })).resolves.not.toBeInstanceOf(Error);
      }
    });
  });

  describe('Registry', () => {
    it('should add and retrieve ABIs', () => {
      registry.addABI('C123', { functions: [] });
      expect(registry.getABI('C123')).not.toBeNull();
    });

    it('should not add invalid ABIs', () => {
      const result = registry.addABI(null, null);
      expect(result).toBe(false);
      expect(errorHandler.getRecentErrors().length).toBe(1);
    });

    it('should catch errors when adding ABI fails', () => {
      // Force an error by passing an object that throws on being added, though Map.set rarely throws
      // We will spy on map to throw
      jest.spyOn(registry.abis, 'set').mockImplementationOnce(() => {
        throw new Error('Map error');
      });
      const result = registry.addABI('C123', {});
      expect(result).toBe(false);
      expect(errorHandler.getRecentErrors()[0].message).toBe('Map error');
    });

    it('should search by function name', () => {
      registry.addABI('C123', { functions: [{ name: 'mint' }] });
      registry.addABI('C456', { functions: [{ name: 'burn' }] });
      
      const results = registry.searchByFunctionName('mint');
      expect(results).toContain('C123');
      expect(results).not.toContain('C456');
    });

    it('should get all registered ABIs', () => {
      registry.addABI('C123', { functions: [] });
      const all = registry.getAll();
      expect(all['C123']).toBeDefined();
    });
  });

  describe('ABI cache', () => {
    it('uses an LRU memory cache with a 1,000-entry limit', async () => {
      const cache = new AbiCache({ maxEntries: 2 });
      await cache.set('C1', 'H1', { version: '1' });
      await cache.set('C2', 'H2', { version: '2' });
      expect(cache.get('C1', 'H1')).toEqual({ version: '1' });
      await cache.set('C3', 'H3', { version: '3' });
      expect(cache.get('C2', 'H2')).toBeNull();
      expect(cache.get('C1', 'H1')).toEqual({ version: '1' });
    });

    it('hydrates the memory tier from Redis and invalidates upgrades', async () => {
      const redis = { get: jest.fn().mockResolvedValue('{"version":"1"}'), set: jest.fn(), del: jest.fn(), keys: jest.fn().mockResolvedValue([]), publish: jest.fn() };
      const cache = new AbiCache({ redisClient: redis });
      await expect(cache.getPersistent('C1', 'H1')).resolves.toEqual({ version: '1' });
      await cache.handleIndexerEvent({ event_name: 'ContractUpgraded', contract_id: 'C1', data: { old_hash: 'H1' } });
      expect(redis.del).toHaveBeenCalledWith('abi:C1:H1');
      expect(redis.publish).toHaveBeenCalledWith('abi:invalidate', expect.any(String));
    });

    it('invalidates every ABI version when an upgrade omits the old hash', async () => {
      const cache = new AbiCache();
      await cache.set('C1', 'H1', { version: '1' });
      await cache.set('C1', 'H2', { version: '2' });
      await cache.handleIndexerEvent({ event_name: 'ContractUpgraded', contract_id: 'C1' });

      expect(cache.get('C1', 'H1')).toBeNull();
      expect(cache.get('C1', 'H2')).toBeNull();
    });
  });

  describe('Monitor', () => {
    let monitor;
    beforeEach(() => {
      monitor = new Monitor(parser, registry);
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should start and stop monitoring', () => {
      monitor.start();
      expect(monitor.isMonitoring).toBe(true);
      expect(monitor.intervalId).not.toBeNull();

      // Test double start does nothing
      const oldId = monitor.intervalId;
      monitor.start();
      expect(monitor.intervalId).toBe(oldId);

      monitor.stop();
      expect(monitor.isMonitoring).toBe(false);
      expect(monitor.intervalId).toBeNull();
    });

    it('should poll and add fetched deployments to registry', async () => {
      jest.spyOn(monitor, 'fetchMockDeployments').mockReturnValue([
        { address: 'C999', data: { bytecode: '0xabc', mockFunctions: [{name: 'swap'}] } }
      ]);

      await monitor.poll();

      expect(registry.getABI('C999')).not.toBeNull();
    });

    it('should handle polling errors gracefully', async () => {
      jest.spyOn(monitor, 'fetchMockDeployments').mockImplementation(() => {
        throw new Error('Network failure');
      });

      await monitor.poll();

      expect(errorHandler.getRecentErrors()[0].message).toBe('Network failure');
    });
  });

  describe('ABIRegistryService (Index)', () => {
    it('should export necessary components and start/stop', () => {
      jest.spyOn(abiRegistryService.monitor, 'start').mockImplementation(() => {});
      jest.spyOn(abiRegistryService.monitor, 'stop').mockImplementation(() => {});

      abiRegistryService.start();
      expect(abiRegistryService.monitor.start).toHaveBeenCalled();

      abiRegistryService.stop();
      expect(abiRegistryService.monitor.stop).toHaveBeenCalled();

      expect(abiRegistryService.getRegistry()).toBe(registry);
      expect(abiRegistryService.getErrorHandler()).toBe(errorHandler);
    });

    it('should decode canonical error codes correctly', () => {
      const decoded100 = abiRegistryService.decodeErrorCode(100);
      expect(decoded100.name).toBe('Unauthorized');
      expect(decoded100.category).toBe('Auth');

      const decoded300 = abiRegistryService.decodeErrorCode(300);
      expect(decoded300.name).toBe('ReentrantCall');
      expect(decoded300.category).toBe('Execution');

      const decoded507 = abiRegistryService.decodeErrorCode(507);
      expect(decoded507.name).toBe('InvalidSlippage');
      expect(decoded507.category).toBe('Treasury');

      const decodedUnknown = abiRegistryService.decodeErrorCode(9999);
      expect(decodedUnknown.name).toBe('UnknownError');
    });
  });
});
