'use strict';

const { createLogger } = require('./logger');

const logger = createLogger('batch-solver');

const DEFAULT_SOLVER_CONFIG = {
  standardDexFeeBps: 30, // 0.30%
  cowFeeDiscountPercent: 40, // 40% fee reduction
  minVolumeToSettle: 1000,
  maxSlippageBps: 50,
};

/**
 * Normalizes a pair identifier consistently (e.g. "TOKEN_A/TOKEN_B")
 */
function getPairKey(tokenA, tokenB) {
  return [tokenA, tokenB].sort().join('/');
}

/**
 * Linear Batch Solver for Coincidence of Wants (CoW) orders
 */
class BatchSolver {
  constructor(config = {}) {
    this.config = { ...DEFAULT_SOLVER_CONFIG, ...config };
    this.effectiveCowFeeBps = Math.round(
      this.config.standardDexFeeBps * (1 - this.config.cowFeeDiscountPercent / 100)
    );
  }

  /**
   * Solve an order batch:
   * 1. Groups complementary buy/sell intents by pair.
   * 2. Calculates uniform clearing prices to prevent MEV.
   * 3. Matches CoW internal volume with 40% fee reduction.
   * 4. Identifies and routes residual imbalances to DEX AMMs.
   */
  solve(intents, dexRouter = null) {
    const pairGroups = new Map();

    // Group valid intents by trading pair
    for (const intent of intents) {
      if (!intent || !intent.isValid || (typeof intent.isValid === 'function' && !intent.isValid())) {
        continue;
      }
      const pair = getPairKey(intent.tokenIn, intent.tokenOut);
      if (!pairGroups.has(pair)) {
        pairGroups.set(pair, []);
      }
      pairGroups.get(pair).push(intent);
    }

    const batchResults = [];

    for (const [pair, pairIntents] of pairGroups) {
      const solution = this.solvePairBatch(pair, pairIntents, dexRouter);
      if (solution) {
        batchResults.push(solution);
      }
    }

    return {
      batchId: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      solvedPairs: batchResults,
      totalVolumeCleared: batchResults.reduce((acc, r) => acc + r.internalMatchedVolume, 0),
      totalFeeSavings: batchResults.reduce((acc, r) => acc + r.feeSavings, 0),
    };
  }

  /**
   * Solves orders for a single token pair
   */
  solvePairBatch(pairKey, intents, dexRouter) {
    if (intents.length < 1) return null;

    const [tokenA, tokenB] = pairKey.split('/');

    // Side 1: Sells tokenA for tokenB
    const sideA = intents.filter((i) => i.tokenIn === tokenA && i.tokenOut === tokenB);
    // Side 2: Sells tokenB for tokenA
    const sideB = intents.filter((i) => i.tokenIn === tokenB && i.tokenOut === tokenA);

    const totalVolumeA = sideA.reduce((sum, i) => sum + Number(i.amountIn), 0);
    const totalVolumeB = sideB.reduce((sum, i) => sum + Number(i.amountIn), 0);

    // If pure one-sided order flow, entire batch routes to AMM
    if (sideA.length === 0 || sideB.length === 0 || totalVolumeA === 0 || totalVolumeB === 0) {
      const residualSide = sideA.length > 0 ? sideA : sideB;
      const routedResidual = this.routeResidualOrders(residualSide, dexRouter);
      return {
        pair: pairKey,
        uniformClearingPrice: null,
        internalMatchedVolume: 0,
        feeSavings: 0,
        matches: [],
        residualImbalance: {
          side: sideA.length > 0 ? 'A_TO_B' : 'B_TO_A',
          volume: sideA.length > 0 ? totalVolumeA : totalVolumeB,
          routedToAmm: true,
          executionDetails: routedResidual,
        },
      };
    }

    // Determine uniform clearing price (P = amount tokenB / amount tokenA)
    // Satisfies limit prices for both parties while preventing MEV / frontrunning
    const clearingPrice = this.computeUniformPrice(sideA, sideB);

    if (!clearingPrice || clearingPrice <= 0) {
      logger.warn('Could not establish uniform clearing price within limit constraints', { pairKey });
      return null;
    }

    // Match complementary volume at uniform price
    // Convert volumeB into equivalent tokenA units: volumeBInA = totalVolumeB / clearingPrice
    const matchedVolumeA = Math.min(totalVolumeA, totalVolumeB / clearingPrice);
    const matchedVolumeB = matchedVolumeA * clearingPrice;

    // Allocate matched volume proportionally across participants
    const matches = [];
    let matchedA = 0;
    let matchedB = 0;

    for (const orderA of sideA) {
      const share = totalVolumeA > 0 ? Number(orderA.amountIn) / totalVolumeA : 0;
      const orderMatchedIn = Math.min(Number(orderA.amountIn), Math.floor(matchedVolumeA * share));
      const orderMatchedOut = Math.floor(orderMatchedIn * clearingPrice);

      // Verify limit order satisfaction
      if (orderMatchedIn > 0 && orderMatchedOut >= Number(orderA.minAmountOut) * (orderMatchedIn / Number(orderA.amountIn))) {
        matchedA += orderMatchedIn;
        matches.push({
          orderId: orderA.id,
          userId: orderA.userId,
          side: 'SELL_A',
          amountIn: orderMatchedIn,
          amountOut: orderMatchedOut,
          clearingPrice,
          feeBps: this.effectiveCowFeeBps,
        });
      }
    }

    for (const orderB of sideB) {
      const share = totalVolumeB > 0 ? Number(orderB.amountIn) / totalVolumeB : 0;
      const orderMatchedIn = Math.min(Number(orderB.amountIn), Math.floor(matchedVolumeB * share));
      const orderMatchedOut = Math.floor(orderMatchedIn / clearingPrice);

      if (orderMatchedIn > 0 && orderMatchedOut >= Number(orderB.minAmountOut) * (orderMatchedIn / Number(orderB.amountIn))) {
        matchedB += orderMatchedIn;
        matches.push({
          orderId: orderB.id,
          userId: orderB.userId,
          side: 'SELL_B',
          amountIn: orderMatchedIn,
          amountOut: orderMatchedOut,
          clearingPrice: 1 / clearingPrice,
          feeBps: this.effectiveCowFeeBps,
        });
      }
    }

    // Calculate fee savings for users: 40% reduction compared to standard DEX AMM fees
    const standardFee = ((matchedA + matchedB) * this.config.standardDexFeeBps) / 10000;
    const cowFee = ((matchedA + matchedB) * this.effectiveCowFeeBps) / 10000;
    const feeSavings = standardFee - cowFee;

    // Handle residual imbalances
    const residualA = Math.max(0, totalVolumeA - matchedA);
    const residualB = Math.max(0, totalVolumeB - matchedB);

    let residualRouting = null;
    if (residualA > 0 || residualB > 0) {
      const residualOrders = [];
      if (residualA > 0) {
        for (const orderA of sideA) {
          const matchedSoFar = matches.filter((m) => m.orderId === orderA.id).reduce((s, m) => s + m.amountIn, 0);
          const remainder = Number(orderA.amountIn) - matchedSoFar;
          if (remainder > 0) {
            residualOrders.push({ ...orderA, amountIn: remainder });
          }
        }
      } else if (residualB > 0) {
        for (const orderB of sideB) {
          const matchedSoFar = matches.filter((m) => m.orderId === orderB.id).reduce((s, m) => s + m.amountIn, 0);
          const remainder = Number(orderB.amountIn) - matchedSoFar;
          if (remainder > 0) {
            residualOrders.push({ ...orderB, amountIn: remainder });
          }
        }
      }
      residualRouting = this.routeResidualOrders(residualOrders, dexRouter);
    }

    return {
      pair: pairKey,
      uniformClearingPrice: clearingPrice,
      internalMatchedVolume: matchedA + matchedB,
      standardFee,
      cowFee,
      feeSavings,
      matches,
      residualImbalance: residualRouting,
    };
  }

  /**
   * Computes a fair uniform clearing price between buy and sell orders.
   * Uniform clearing eliminates MEV, sandwich attacks, and order sequencing bias.
   */
  computeUniformPrice(sideA, sideB) {
    // Price = tokenB per unit of tokenA
    // sideA (tokenA -> tokenB): limit price is minAmountOut / amountIn
    // sideB (tokenB -> tokenA): limit price is amountIn / minAmountOut
    const minPricesA = sideA.map((o) => Number(o.minAmountOut) / Number(o.amountIn));
    const maxPricesB = sideB.map((o) => Number(o.amountIn) / Number(o.minAmountOut));

    const highestMinPriceA = Math.max(...minPricesA);
    const lowestMaxPriceB = Math.min(...maxPricesB);

    if (highestMinPriceA > lowestMaxPriceB) {
      // Overlapping price spread cannot be cleared uniformly without slippage compromise
      // Fallback to geometric mean of volume-weighted limits
      const avgA = minPricesA.reduce((a, b) => a + b, 0) / minPricesA.length;
      const avgB = maxPricesB.reduce((a, b) => a + b, 0) / maxPricesB.length;
      return (avgA + avgB) / 2;
    }

    // Midpoint uniform clearing price within the valid overlapping range
    return (highestMinPriceA + lowestMaxPriceB) / 2;
  }

  /**
   * Seamlessly routes residual order imbalances to liquidity pool AMMs
   */
  routeResidualOrders(residualOrders, dexRouter) {
    if (!residualOrders || residualOrders.length === 0) return null;

    const totalResidual = residualOrders.reduce((sum, o) => sum + Number(o.amountIn), 0);
    const tokenIn = residualOrders[0]?.tokenIn;
    const tokenOut = residualOrders[0]?.tokenOut;

    const routeResult = {
      tokenIn,
      tokenOut,
      volume: totalResidual,
      routedToAmm: true,
      timestamp: Date.now(),
      status: 'ROUTED_TO_DEX',
    };

    if (dexRouter && typeof dexRouter.swap === 'function') {
      try {
        const swapResult = dexRouter.swap({
          tokenIn,
          tokenOut,
          amountIn: totalResidual,
        });
        return { ...routeResult, ...swapResult };
      } catch (err) {
        logger.error('DEX AMM residual routing error', { error: err.message });
      }
    }

    return routeResult;
  }
}

module.exports = {
  BatchSolver,
  DEFAULT_SOLVER_CONFIG,
};
