const { ZKProofService } = require('./index');
const {
  hashTaskCondition,
  serializeProof,
  isValidZkProof,
  checkConstraint,
  generateECIESKeyPair,
  encryptWitnessECIES,
  decryptWitnessECIES,
  zeroizeBuffer,
} = require('./lib/helpers');

describe('ZKProofService', () => {
  test('uses isolated prover workers with the production resource limits', () => {
    const service = new ZKProofService(1);

    expect(service.workerMemoryMb).toBe(4096);
    expect(service.workerTimeoutMs).toBe(60000);
  });

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
    expect(service.getWorkerPoolStatus()).toEqual({
      totalWorkers: 2,
      idleWorkers: 2,
      activeWorkers: 0,
    });
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
    const taskCondition = { type: 'privacy-preserving', params: {} };
    const clientData = { witness: { clientId: 'light-client-1' } };

    const proof = await service.generateProof(taskCondition, clientData);

    expect(proof).toHaveProperty('proofId');
    expect(proof.status).toBe('success');
    expect(proof).toHaveProperty('pi_a');
    expect(proof).toHaveProperty('pi_b');
    expect(proof).toHaveProperty('pi_c');
    expect(proof).toHaveProperty('publicSignals');
    expect(service.getWorkerPoolStatus().idleWorkers).toBe(2);
  });

  test('should verify a valid proof', async () => {
    service.initialize();
    const taskCondition = { type: 'liquidity-threshold', params: { minLiquidity: 10000 } };
    const proof = await service.generateProof(taskCondition, { witness: { actualLiquidity: 20000 } });
    const result = await service.verifyProof({
      taskCondition,
      proof,
      circuitId: 'liquidity-threshold-v1',
    });

    expect(result.valid).toBe(true);
    expect(result.conditionHash).toBe(hashTaskCondition(taskCondition));
    expect(result.verificationDetails.publicSignalsMatch).toBe(true);
  });

  test('should reject proof with mismatched condition hash', async () => {
    service.initialize();
    const taskCondition = { type: 'liquidity-threshold', params: { minLiquidity: 10000 } };
    const proof = await service.generateProof(taskCondition, { witness: { actualLiquidity: 20000 } });
    const result = await service.verifyProof({
      taskCondition,
      proof,
      conditionHash: '0xdeadbeef',
      circuitId: 'liquidity-threshold-v1',
    });

    expect(result.valid).toBe(false);
    expect(result.verificationDetails.conditionHashMatch).toBe(false);
  });

  test('should shutdown correctly', () => {
    service.initialize();
    expect(service.isReady).toBe(true);
    service.shutdown();
    expect(service.isReady).toBe(false);
    expect(service.workers.length).toBe(0);
  });
});

describe('helpers', () => {
  test('hashTaskCondition returns stable hex hash', () => {
    const condition = { type: 'liquidity-threshold', params: { minLiquidity: 10000 } };
    expect(hashTaskCondition(condition)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashTaskCondition(condition)).toBe(hashTaskCondition(condition));
  });

  test('serializeProof returns hex payload', () => {
    const proof = {
      pi_a: ['0x1', '0x2'],
      pi_b: [['0x3', '0x4'], ['0x5', '0x6']],
      pi_c: ['0x7', '0x8'],
      publicSignals: ['0x9'],
    };
    expect(serializeProof(proof)).toMatch(/^0x[0-9a-f]+$/);
  });

  test('isValidZkProof validates structure', () => {
    expect(isValidZkProof({
      pi_a: ['0x1', '0x2'],
      pi_b: [['0x3', '0x4'], ['0x5', '0x6']],
      pi_c: ['0x7', '0x8'],
      publicSignals: ['0x9'],
    })).toBe(true);
    expect(isValidZkProof({ pi_a: ['bad'] })).toBe(false);
  });

  test('checkConstraint detects unsatisfied liquidity threshold', () => {
    const result = checkConstraint(
      { type: 'liquidity-threshold', params: { minLiquidity: 10000 } },
      { witness: { actualLiquidity: 5000 } },
      'liquidity-threshold-v1',
    );
    expect(result.ok).toBe(false);
  });

  test('ECIES secp256k1 key generation, encryption, and decryption', () => {
    const keyPair = generateECIESKeyPair();
    expect(keyPair).toHaveProperty('publicKey');
    expect(keyPair).toHaveProperty('privateKey');

    const witnessObj = { secretValue: 987654321, owner: 'GB12345' };
    const encrypted = encryptWitnessECIES(witnessObj, keyPair.publicKey);

    expect(encrypted).toHaveProperty('ephemeralPublicKey');
    expect(encrypted).toHaveProperty('iv');
    expect(encrypted).toHaveProperty('ciphertext');
    expect(encrypted).toHaveProperty('tag');

    const decrypted = decryptWitnessECIES(encrypted, keyPair.privateKey);
    expect(decrypted.witness).toEqual(witnessObj);
  });

  test('zeroizeBuffer scrubs memory buffer to zeros', () => {
    const buf = Buffer.from('secret-witness-payload-data');
    expect(buf.toString()).toBe('secret-witness-payload-data');
    zeroizeBuffer(buf);
    expect(buf.every((byte) => byte === 0)).toBe(true);
  });
});
