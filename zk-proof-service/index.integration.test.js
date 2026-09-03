const { ZKProofService } = require('./index');

describe('ZKProofService Cache Integration', () => {
  test('uses cache on redundant requests', async () => {
    const mockCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(),
      close: jest.fn().mockResolvedValue(),
    };
    const service = new ZKProofService(2, { proofCache: mockCache });
    service.initialize();

    const taskCondition = { type: 'test' };
    const clientData = { witness: { a: 1 } };

    // First request: miss
    await service.generateProof(taskCondition, clientData);
    expect(mockCache.get).toHaveBeenCalledTimes(1);
    
    // Second request: hit
    mockCache.get.mockResolvedValueOnce({ pi_a: '0x1', cached: true });
    await service.generateProof(taskCondition, clientData);
    expect(mockCache.get).toHaveBeenCalledTimes(2);

    service.shutdown();
  });
});
