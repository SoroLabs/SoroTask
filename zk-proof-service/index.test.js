const { ZKProofService } = require('./index');

describe('ZKProofService', () => {
  let service;

  beforeEach(() => {
    service = new ZKProofService(2);
  });

  afterEach(() => {
    service.shutdown();
  });

  test('should initialize correctly', () => {
    expect(service.isReady).toBe(false);
    service.initialize();
    expect(service.isReady).toBe(true);
    expect(service.workers.length).toBe(2);
  });

  test('should throw error if generating proof before initialization', async () => {
    await expect(service.generateProof({}, {})).rejects.toThrow('Service not initialized');
  });

  test('should throw error on invalid input data', async () => {
    service.initialize();
    await expect(service.generateProof(null, {})).rejects.toThrow('Invalid input data');
    await expect(service.generateProof({}, null)).rejects.toThrow('Invalid input data');
  });

  test('should generate ZK proof successfully', async () => {
    service.initialize();
    const taskCondition = { type: 'privacy-preserving' };
    const clientData = { clientId: 'light-client-1' };
    
    const proof = await service.generateProof(taskCondition, clientData);
    
    expect(proof).toHaveProperty('proofId');
    expect(proof.status).toBe('success');
    expect(proof).toHaveProperty('pi_a');
    expect(proof).toHaveProperty('pi_b');
    expect(proof).toHaveProperty('pi_c');
    expect(proof).toHaveProperty('publicSignals');
  });

  test('should shutdown correctly', () => {
    service.initialize();
    expect(service.isReady).toBe(true);
    service.shutdown();
    expect(service.isReady).toBe(false);
    expect(service.workers.length).toBe(0);
  });
});
