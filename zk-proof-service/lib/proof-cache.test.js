const { ProofCache, createProofCacheKey } = require('./proof-cache');

describe('ProofCache', () => {
  test('in-memory cache works as expected', async () => {
    const cache = new ProofCache();
    const key = 'test-key';
    const proof = { pi_a: '0x1', pi_b: '0x2' };

    await cache.set(key, proof);
    const cachedProof = await cache.get(key);
    expect(cachedProof).toEqual(proof);
  });

  test('cache key generation is deterministic', () => {
    const circuitId = 'c1';
    const publicInputs = { a: 1 };
    const witness = { b: 2 };
    
    const key1 = createProofCacheKey(circuitId, publicInputs, witness);
    const key2 = createProofCacheKey(circuitId, publicInputs, witness);
    
    expect(key1).toBe(key2);
  });
});
