/**
 * Unit Tests for Autonomous Multi-Source Oracle Aggregator Daemon (#1455)
 */

const {
  OracleAggregatorDaemon,
  fetchCoinbasePrice,
  fetchBinancePrice,
  fetchKrakenPrice,
  ingestChainlinkFeed,
  ingestPythFeed,
  filterStaleFeeds,
  filterStatisticalOutliers,
  computeVolumeWeightedMedian,
} = require('../src/resolver');
const TaskPoller = require('../src/poller');

describe('Autonomous Multi-Source Oracle Aggregator Daemon (#1455)', () => {
  const fixedNow = 1_700_000_000_000;
  const clock = { now: () => fixedNow };

  describe('Exchange REST API & On-Chain Oracle Adapters', () => {
    it('fetches normalized prices from Coinbase, Binance, and Kraken REST APIs', async () => {
      const mockFetcher = jest.fn(async (url) => {
        if (url.includes('coinbase')) {
          return { json: async () => ({ price: '0.1250', volume: '500000', time: new Date(fixedNow).toISOString() }) };
        }
        if (url.includes('binance')) {
          return { json: async () => ({ lastPrice: '0.1252', volume: '800000', closeTime: fixedNow }) };
        }
        return {
          json: async () => ({
            result: { XXLMZUSD: { c: ['0.1248'], v: ['100000', '300000'] } },
            timestamp: fixedNow,
          }),
        };
      });

      const cb = await fetchCoinbasePrice('XLM-USD', mockFetcher, clock);
      const bn = await fetchBinancePrice('XLM-USD', mockFetcher, clock);
      const kr = await fetchKrakenPrice('XLM-USD', mockFetcher, clock);

      expect(cb).toMatchObject({ source: 'coinbase', price: 0.125, volume: 500000 });
      expect(bn).toMatchObject({ source: 'binance', price: 0.1252, volume: 800000 });
      expect(kr).toMatchObject({ source: 'kraken', price: 0.1248, volume: 300000 });
    });

    it('ingests Chainlink and Pyth on-chain price feeds', async () => {
      const clFeed = await ingestChainlinkFeed(
        'XLM-USD',
        async () => ({ answer: 12510000, decimals: 8, updatedAt: fixedNow / 1000, volume: 1000000 }),
        clock,
      );
      const pythFeed = await ingestPythFeed(
        'XLM-USD',
        async () => ({ rawPrice: 125050, expo: -6, conf: 50, publishTime: fixedNow / 1000, volume: 900000 }),
        clock,
      );

      expect(clFeed.source).toBe('chainlink');
      expect(clFeed.price).toBeCloseTo(0.1251, 6);
      expect(pythFeed.source).toBe('pyth');
      expect(pythFeed.price).toBeCloseTo(0.12505, 6);
    });
  });

  describe('Staleness Guards & Statistical Outlier Elimination', () => {
    it('rejects stale and invalid feeds so zero stale feeds are utilized', () => {
      const feeds = [
        { source: 'coinbase', price: 0.125, volume: 500, timestamp: fixedNow - 5000 },
        { source: 'binance', price: 0.126, volume: 600, timestamp: fixedNow - 45000 }, // stale (>30s)
        { source: 'kraken', price: -1, volume: 400, timestamp: fixedNow - 1000 }, // invalid price
      ];

      const { freshFeeds, staleFeeds } = filterStaleFeeds(feeds, fixedNow, 30000);
      expect(freshFeeds).toHaveLength(1);
      expect(freshFeeds[0].source).toBe('coinbase');
      expect(staleFeeds).toHaveLength(2);
    });

    it('eliminates single-exchange flash crash outliers while preserving consensus', () => {
      const feeds = [
        { source: 'coinbase', price: 0.1250, volume: 500000, timestamp: fixedNow },
        { source: 'binance', price: 0.1252, volume: 800000, timestamp: fixedNow },
        { source: 'kraken', price: 0.0012, volume: 900000, timestamp: fixedNow }, // 99% flash crash on Kraken
        { source: 'chainlink', price: 0.1251, volume: 1000000, timestamp: fixedNow },
        { source: 'pyth', price: 0.1249, volume: 700000, timestamp: fixedNow },
      ];

      const { validFeeds, outliers } = filterStatisticalOutliers(feeds);
      expect(outliers).toHaveLength(1);
      expect(outliers[0].source).toBe('kraken');
      expect(validFeeds.map((f) => f.source)).not.toContain('kraken');

      const vwMedian = computeVolumeWeightedMedian(validFeeds);
      expect(vwMedian).toBeGreaterThanOrEqual(0.1249);
      expect(vwMedian).toBeLessThanOrEqual(0.1252);
    });
  });

  describe('OracleAggregatorDaemon Consensus & Threshold Publishing', () => {
    it('aggregates 5 sources, ignores flash crashes & stale feeds, and publishes within 500ms only on threshold breach', async () => {
      const publishedUpdates = [];
      const daemon = new OracleAggregatorDaemon({
        clock,
        maxStalenessMs: 30000,
        deviationThresholdBps: 50, // 0.50%
        onChainPublisher: async (update) => {
          publishedUpdates.push(update);
          return { txHash: `tx-${publishedUpdates.length}` };
        },
        sources: {
          coinbase: async () => ({ price: 1.000, volume: 500, timestamp: fixedNow - 2000 }),
          binance: async () => ({ price: 1.002, volume: 700, timestamp: fixedNow - 1000 }),
          kraken: async () => ({ price: 0.100, volume: 900, timestamp: fixedNow - 1000 }), // flash crash outlier
          chainlink: async () => ({ price: 1.001, volume: 1000, timestamp: fixedNow - 3000 }),
          pyth: async () => ({ price: 0.999, volume: 600, timestamp: fixedNow - 60000 }), // stale feed
        },
      });

      // Cycle 1: Initial consensus published
      const snap1 = await daemon.aggregateAndPublish('XLM-USD');
      expect(snap1.staleFeedsRejected).toBe(1);
      expect(snap1.outliersEliminated).toBe(1);
      expect(snap1.consensusPrice).toBeCloseTo(1.001, 4);
      expect(snap1.published).toBe(true);
      expect(snap1.withinPublishSla).toBe(true);
      expect(snap1.latencyMs).toBeLessThan(500);
      expect(publishedUpdates).toHaveLength(1);

      // Cycle 2: Minor move (< 0.50%) -> skipped to save gas
      daemon.registerSource('coinbase', async () => ({ price: 1.002, volume: 500, timestamp: fixedNow }));
      daemon.registerSource('chainlink', async () => ({ price: 1.002, volume: 1000, timestamp: fixedNow }));
      const snap2 = await daemon.aggregateAndPublish('XLM-USD');
      expect(snap2.published).toBe(false);
      expect(publishedUpdates).toHaveLength(1);

      // Cycle 3: Major move (> 0.50%) -> published on-chain within 500ms
      daemon.registerSource('coinbase', async () => ({ price: 1.020, volume: 500, timestamp: fixedNow }));
      daemon.registerSource('binance', async () => ({ price: 1.022, volume: 700, timestamp: fixedNow }));
      daemon.registerSource('chainlink', async () => ({ price: 1.021, volume: 1000, timestamp: fixedNow }));
      const snap3 = await daemon.aggregateAndPublish('XLM-USD');
      expect(snap3.published).toBe(true);
      expect(snap3.withinPublishSla).toBe(true);
      expect(publishedUpdates).toHaveLength(2);
    });

    it('integrates with TaskPoller to gate oracle-dependent tasks', async () => {
      const daemon = new OracleAggregatorDaemon({
        clock,
        sources: {
          coinbase: async () => ({ price: 0.15, volume: 500, timestamp: fixedNow }),
          binance: async () => ({ price: 0.15, volume: 500, timestamp: fixedNow }),
          chainlink: async () => ({ price: 0.15, volume: 800, timestamp: fixedNow }),
        },
      });

      const mockServer = {
        getLatestLedger: jest.fn().mockResolvedValue({ sequence: 500, closeTime: 1000 }),
      };

      const poller = new TaskPoller(mockServer, 'CCONTRACT', {
        oracleAggregator: daemon,
      });

      poller.getTaskConfig = jest.fn().mockImplementation(async (taskId) => ({
        last_run: 100,
        interval: 60,
        gas_balance: 5000,
        creator: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        target: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        function: 'execute_limit_order',
        args: [],
        oracleCondition: taskId === 1
          ? { pair: 'XLM-USD', operator: 'gte', targetPrice: 0.14 }
          : { pair: 'XLM-USD', operator: 'gte', targetPrice: 0.20 },
      }));

      const dueIds = await poller.pollDueTasks([1, 2]);
      expect(dueIds).toEqual([1]);
    });
  });
});
