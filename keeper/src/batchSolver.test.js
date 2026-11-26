'use strict';

const { BatchSolver } = require('./batchSolver');
const { CoWSettlementEngine, IntentOrder } = require('./cow-swap-settlement');

describe('BatchSolver & CoW Swap Settlement Engine', () => {
  let solver;
  let engine;
  let mockDexRouter;

  beforeEach(() => {
    solver = new BatchSolver({
      standardDexFeeBps: 30, // 0.30%
      cowFeeDiscountPercent: 40, // 40% fee reduction
    });

    mockDexRouter = {
      swap: jest.fn().mockImplementation(({ tokenIn, tokenOut, amountIn }) => ({
        executedAmountIn: amountIn,
        executedAmountOut: Math.floor(amountIn * 0.99),
        txHash: '0xmock_dex_swap_hash',
      })),
    };

    engine = new CoWSettlementEngine({}, mockDexRouter);
  });

  it('pairs complementary buy/sell orders and clears internal volume', () => {
    const intentA = new IntentOrder({
      id: 'intent-1',
      userId: 'user-alice',
      tokenIn: 'XLM',
      tokenOut: 'USDC',
      amountIn: 10000,
      minAmountOut: 900,
    });

    const intentB = new IntentOrder({
      id: 'intent-2',
      userId: 'user-bob',
      tokenIn: 'USDC',
      tokenOut: 'XLM',
      amountIn: 1000,
      minAmountOut: 9500,
    });

    const solution = solver.solve([intentA, intentB]);

    expect(solution.solvedPairs.length).toBe(1);
    const solvedPair = solution.solvedPairs[0];
    expect(solvedPair.internalMatchedVolume).toBeGreaterThan(0);
    expect(solvedPair.matches.length).toBe(2);
  });

  it('guarantees 40% fee reduction on batch-cleared trades', () => {
    const intentA = new IntentOrder({
      id: 'intent-1',
      userId: 'user-alice',
      tokenIn: 'XLM',
      tokenOut: 'USDC',
      amountIn: 10000,
      minAmountOut: 1000,
    });

    const intentB = new IntentOrder({
      id: 'intent-2',
      userId: 'user-bob',
      tokenIn: 'USDC',
      tokenOut: 'XLM',
      amountIn: 1000,
      minAmountOut: 9500,
    });

    const solution = solver.solve([intentA, intentB]);
    const solvedPair = solution.solvedPairs[0];

    // Standard fee is 30 bps, discounted fee is 18 bps (40% discount)
    expect(solvedPair.cowFee).toBeLessThan(solvedPair.standardFee);
    const expectedDiscountRatio = solvedPair.cowFee / solvedPair.standardFee;
    expect(expectedDiscountRatio).toBeCloseTo(0.6, 1);
    expect(solvedPair.feeSavings).toBeGreaterThan(0);
  });

  it('uses uniform clearing price to prevent MEV front-running', () => {
    const intentA = new IntentOrder({
      id: 'intent-1',
      userId: 'user-alice',
      tokenIn: 'XLM',
      tokenOut: 'USDC',
      amountIn: 10000,
      minAmountOut: 1000,
    });

    const intentB = new IntentOrder({
      id: 'intent-2',
      userId: 'user-bob',
      tokenIn: 'USDC',
      tokenOut: 'XLM',
      amountIn: 1000,
      minAmountOut: 9000,
    });

    const solution = solver.solve([intentA, intentB]);
    const solvedPair = solution.solvedPairs[0];

    expect(solvedPair.uniformClearingPrice).toBeDefined();
    expect(solvedPair.uniformClearingPrice).toBeGreaterThan(0);
    // Both sides clear at the exact uniform clearing price
    const matchA = solvedPair.matches.find((m) => m.side === 'SELL_A');
    const matchB = solvedPair.matches.find((m) => m.side === 'SELL_B');
    expect(matchA.clearingPrice).toBe(solvedPair.uniformClearingPrice);
    expect(matchB.clearingPrice).toBeCloseTo(1 / solvedPair.uniformClearingPrice, 4);
  });

  it('routes residual order volume imbalances seamlessly to DEX AMMs', () => {
    // Alice wants to sell 20000 XLM, but Bob only wants to sell 1000 USDC (~10000 XLM)
    const intentA = new IntentOrder({
      id: 'intent-1',
      userId: 'user-alice',
      tokenIn: 'XLM',
      tokenOut: 'USDC',
      amountIn: 20000,
      minAmountOut: 1900,
    });

    const intentB = new IntentOrder({
      id: 'intent-2',
      userId: 'user-bob',
      tokenIn: 'USDC',
      tokenOut: 'XLM',
      amountIn: 1000,
      minAmountOut: 9000,
    });

    const solution = solver.solve([intentA, intentB], mockDexRouter);
    const solvedPair = solution.solvedPairs[0];

    expect(solvedPair.residualImbalance).not.toBeNull();
    expect(solvedPair.residualImbalance.routedToAmm).toBe(true);
    expect(mockDexRouter.swap).toHaveBeenCalled();
  });

  it('completes end-to-end engine settlement execution with proof generation', async () => {
    engine.submitIntent({
      id: 'intent-alice',
      userId: 'alice',
      tokenIn: 'XLM',
      tokenOut: 'USDC',
      amountIn: 5000,
      minAmountOut: 500,
    });

    engine.submitIntent({
      id: 'intent-bob',
      userId: 'bob',
      tokenIn: 'USDC',
      tokenOut: 'XLM',
      amountIn: 500,
      minAmountOut: 4500,
    });

    const matches = engine.matchIntents();
    expect(matches.length).toBe(1);

    const settlement = await engine.executeSettlement(matches[0]);
    expect(settlement.status).toBe('completed');
    expect(settlement.feeSavings).toBeGreaterThan(0);

    const proof = engine.generateSettlementProof(settlement);
    expect(proof).toHaveLength(64);

    const stats = engine.getSettlementStats();
    expect(stats.totalSettlements).toBe(1);
    expect(stats.totalSavings).toBeGreaterThan(0);
  });
});
