const parser = require('../parser');
const registry = require('../registry');
const errorHandler = require('../errorHandler');
const Monitor = require('../monitor');
const abiRegistryService = require('../index');

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
  });
});
