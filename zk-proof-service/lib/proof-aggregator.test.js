const { ProofAggregator } = require('./proof-aggregator');

describe('ProofAggregator', () => {
  describe('estimateGasSavings', () => {
    test('reports negative savings for a single proof', () => {
      const aggregator = new ProofAggregator();
      const estimate = aggregator.estimateGasSavings(1);
      expect(estimate.worthAggregating).toBe(false);
      expect(estimate.estimatedSavings).toBeLessThan(0);
    });

    test('reports positive savings once enough proofs are batched', () => {
      const aggregator = new ProofAggregator();
      const estimate = aggregator.estimateGasSavings(10);
      expect(estimate.worthAggregating).toBe(true);
      expect(estimate.individualGas).toBe(2_500_000);
      expect(estimate.aggregateGas).toBe(400_000);
      expect(estimate.estimatedSavings).toBe(2_100_000);
    });
  });

  describe('aggregate', () => {
    test('throws when no proofs are given', async () => {
      const aggregator = new ProofAggregator({ backend: { aggregate: jest.fn() } });
      await expect(aggregator.aggregate([])).rejects.toThrow('non-empty array');
    });

    test('throws a clear error when no backend is configured', async () => {
      const aggregator = new ProofAggregator();
      await expect(aggregator.aggregate([{ proofId: '1' }])).rejects.toThrow(
        /No aggregation backend configured/,
      );
    });

    test('delegates to the configured backend and returns gas savings', async () => {
      const backend = { aggregate: jest.fn().mockResolvedValue({ combined: true }) };
      const aggregator = new ProofAggregator({ backend });
      const proofs = [{ proofId: '1' }, { proofId: '2' }, { proofId: '3' }];

      const result = await aggregator.aggregate(proofs);

      expect(backend.aggregate).toHaveBeenCalledWith(proofs);
      expect(result.aggregateProof).toEqual({ combined: true });
      expect(result.proofCount).toBe(3);
      expect(result.gasSavings.worthAggregating).toBe(true);
      expect(result.gasSavings.estimatedSavings).toBe(350_000);
    });
  });
});
