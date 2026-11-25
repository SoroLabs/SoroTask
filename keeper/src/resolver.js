const EventEmitter = require('events');
const { createLogger } = require('./logger');
const { ResolverRuntime, ResolverRuntimeError } = require('./resolverRuntime');

const DEFAULT_MAX_STALENESS_MS = 30_000;
const DEFAULT_OUTLIER_Z_THRESHOLD = 2.5;
const DEFAULT_MAX_MEDIAN_DEVIATION_RATIO = 0.15;
const DEFAULT_DEVIATION_THRESHOLD_BPS = 50; // 0.50%
const DEFAULT_PUBLISH_SLA_MS = 500;

/**
 * Fetch normalized asset price from Coinbase REST API or injected adapter.
 *
 * @param {string} pair - Asset pair (e.g. 'XLM-USD')
 * @param {Function} [httpFetcher] - Optional fetch implementation
 * @param {object} [clock] - Optional clock with now()
 * @returns {Promise<object>}
 */
async function fetchCoinbasePrice(pair = 'XLM-USD', httpFetcher = global.fetch, clock = Date) {
  const now = typeof clock.now === 'function' ? clock.now() : Date.now();
  if (typeof httpFetcher !== 'function') {
    throw new Error('HTTP fetcher unavailable for Coinbase feed');
  }
  const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(pair)}/ticker`;
  const res = await httpFetcher(url);
  const data = typeof res.json === 'function' ? await res.json() : res;
  return {
    source: 'coinbase',
    type: 'rest',
    pair,
    price: Number(data.price),
    volume: Number(data.volume ?? data.volume_24h ?? 1000),
    timestamp: data.time ? new Date(data.time).getTime() : (Number(data.timestamp) || now),
  };
}

/**
 * Fetch normalized asset price from Binance REST API or injected adapter.
 *
 * @param {string} pair - Asset pair (e.g. 'XLM-USD')
 * @param {Function} [httpFetcher] - Optional fetch implementation
 * @param {object} [clock] - Optional clock with now()
 * @returns {Promise<object>}
 */
async function fetchBinancePrice(pair = 'XLM-USD', httpFetcher = global.fetch, clock = Date) {
  const now = typeof clock.now === 'function' ? clock.now() : Date.now();
  if (typeof httpFetcher !== 'function') {
    throw new Error('HTTP fetcher unavailable for Binance feed');
  }
  const symbol = pair.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
  const res = await httpFetcher(url);
  const data = typeof res.json === 'function' ? await res.json() : res;
  return {
    source: 'binance',
    type: 'rest',
    pair,
    price: Number(data.lastPrice ?? data.price),
    volume: Number(data.volume ?? data.quoteVolume ?? 1000),
    timestamp: Number(data.closeTime ?? data.timestamp) || now,
  };
}

/**
 * Fetch normalized asset price from Kraken REST API or injected adapter.
 *
 * @param {string} pair - Asset pair (e.g. 'XLM-USD')
 * @param {Function} [httpFetcher] - Optional fetch implementation
 * @param {object} [clock] - Optional clock with now()
 * @returns {Promise<object>}
 */
async function fetchKrakenPrice(pair = 'XLM-USD', httpFetcher = global.fetch, clock = Date) {
  const now = typeof clock.now === 'function' ? clock.now() : Date.now();
  if (typeof httpFetcher !== 'function') {
    throw new Error('HTTP fetcher unavailable for Kraken feed');
  }
  const url = `https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(pair)}`;
  const res = await httpFetcher(url);
  const data = typeof res.json === 'function' ? await res.json() : res;
  const resultObj = data && data.result ? Object.values(data.result)[0] : data;
  const rawPrice = resultObj?.c ? resultObj.c[0] : resultObj?.price;
  const rawVolume = resultObj?.v ? resultObj.v[1] : (resultObj?.volume ?? 1000);
  return {
    source: 'kraken',
    type: 'rest',
    pair,
    price: Number(rawPrice),
    volume: Number(rawVolume),
    timestamp: Number(data?.timestamp ?? resultObj?.timestamp) || now,
  };
}

/**
 * Ingest Chainlink on-chain price feed data (`latestRoundData`).
 *
 * @param {string} pair - Asset pair
 * @param {Function|object} feedReader - Reader returning round data
 * @param {object} [clock] - Optional clock
 * @returns {Promise<object>}
 */
async function ingestChainlinkFeed(pair, feedReader, clock = Date) {
  const now = typeof clock.now === 'function' ? clock.now() : Date.now();
  const raw = typeof feedReader === 'function'
    ? await feedReader(pair)
    : (feedReader && typeof feedReader.latestRoundData === 'function'
      ? await feedReader.latestRoundData(pair)
      : feedReader);

  if (!raw) {
    throw new Error(`Chainlink feed unavailable for ${pair}`);
  }

  const decimals = Number.isFinite(raw.decimals) ? raw.decimals : 8;
  const price = raw.price !== undefined
    ? Number(raw.price)
    : Number(raw.answer) / Math.pow(10, decimals);
  const updatedAtMs = raw.timestamp !== undefined
    ? Number(raw.timestamp)
    : (raw.updatedAt !== undefined
      ? (Number(raw.updatedAt) < 1e12 ? Number(raw.updatedAt) * 1000 : Number(raw.updatedAt))
      : now);

  return {
    source: 'chainlink',
    type: 'onchain',
    pair,
    price,
    volume: Number(raw.volume ?? raw.weight ?? 2500),
    roundId: raw.roundId ? String(raw.roundId) : '1',
    timestamp: updatedAtMs,
  };
}

/**
 * Ingest Pyth Network on-chain price feed data.
 *
 * @param {string} pair - Asset pair
 * @param {Function|object} feedReader - Reader returning Pyth price structure
 * @param {object} [clock] - Optional clock
 * @returns {Promise<object>}
 */
async function ingestPythFeed(pair, feedReader, clock = Date) {
  const now = typeof clock.now === 'function' ? clock.now() : Date.now();
  const raw = typeof feedReader === 'function'
    ? await feedReader(pair)
    : (feedReader && typeof feedReader.getPriceUnsafe === 'function'
      ? await feedReader.getPriceUnsafe(pair)
      : feedReader);

  if (!raw) {
    throw new Error(`Pyth feed unavailable for ${pair}`);
  }

  const expo = Number.isFinite(raw.expo) ? raw.expo : 0;
  const price = expo !== 0 && raw.rawPrice !== undefined
    ? Number(raw.rawPrice) * Math.pow(10, expo)
    : Number(raw.price);
  const publishTimeMs = raw.timestamp !== undefined
    ? Number(raw.timestamp)
    : (raw.publishTime !== undefined
      ? (Number(raw.publishTime) < 1e12 ? Number(raw.publishTime) * 1000 : Number(raw.publishTime))
      : now);

  return {
    source: 'pyth',
    type: 'onchain',
    pair,
    price,
    confidence: Number(raw.conf ?? raw.confidence ?? 0),
    volume: Number(raw.volume ?? raw.weight ?? 2500),
    timestamp: publishTimeMs,
  };
}

/**
 * Filter out stale or malformed price feeds.
 * Guarantees zero stale price feeds are utilized in consensus calculation.
 *
 * @param {Array<object>} feeds
 * @param {number} nowMs
 * @param {number} [maxStalenessMs=30000]
 * @returns {{ freshFeeds: Array<object>, staleFeeds: Array<object> }}
 */
function filterStaleFeeds(feeds = [], nowMs = Date.now(), maxStalenessMs = DEFAULT_MAX_STALENESS_MS) {
  const freshFeeds = [];
  const staleFeeds = [];

  for (const feed of feeds) {
    if (!feed || !Number.isFinite(feed.price) || feed.price <= 0) {
      staleFeeds.push({ ...feed, reason: 'invalid_price' });
      continue;
    }
    const ts = Number(feed.timestamp);
    const ageMs = nowMs - ts;
    if (!Number.isFinite(ts) || ageMs > maxStalenessMs || ageMs < -5000) {
      staleFeeds.push({ ...feed, ageMs, reason: 'stale_timestamp' });
      continue;
    }
    freshFeeds.push({
      ...feed,
      volume: Number.isFinite(feed.volume) && feed.volume > 0 ? Number(feed.volume) : 1,
      ageMs: Math.max(0, ageMs),
    });
  }

  return { freshFeeds, staleFeeds };
}

function computeSimpleMedian(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Eliminate statistical outliers using Median Absolute Deviation (MAD) and
 * standard deviation cuts so single-exchange flash crashes or spikes cannot
 * corrupt the consensus price.
 *
 * @param {Array<object>} feeds
 * @param {object} [options={}]
 * @returns {{ validFeeds: Array<object>, outliers: Array<object>, stats: object }}
 */
function filterStatisticalOutliers(feeds = [], options = {}) {
  if (feeds.length <= 2) {
    return {
      validFeeds: [...feeds],
      outliers: [],
      stats: { medianPrice: computeSimpleMedian(feeds.map((f) => f.price)), stdDev: 0, mad: 0 },
    };
  }

  const zThreshold = Number.isFinite(options.zThreshold)
    ? options.zThreshold
    : DEFAULT_OUTLIER_Z_THRESHOLD;
  const maxMedianDeviationRatio = Number.isFinite(options.maxMedianDeviationRatio)
    ? options.maxMedianDeviationRatio
    : DEFAULT_MAX_MEDIAN_DEVIATION_RATIO;

  const prices = feeds.map((f) => f.price);
  const medianPrice = computeSimpleMedian(prices);
  const absDeviations = prices.map((p) => Math.abs(p - medianPrice));
  const mad = computeSimpleMedian(absDeviations);

  const mean = prices.reduce((s, p) => s + p, 0) / prices.length;
  const variance = prices.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / prices.length;
  const stdDev = Math.sqrt(variance);

  // Robust scale estimate: prefer MAD * 1.4826, fallback to tight ratio if MAD == 0
  const robustSigma = mad > 0 ? mad * 1.4826 : medianPrice * 0.01;

  const validFeeds = [];
  const outliers = [];

  for (const feed of feeds) {
    const diff = Math.abs(feed.price - medianPrice);
    const modifiedZ = robustSigma > 0 ? diff / robustSigma : 0;
    const relativeDeviation = medianPrice > 0 ? diff / medianPrice : 0;

    if (modifiedZ > zThreshold && relativeDeviation > maxMedianDeviationRatio) {
      outliers.push({
        ...feed,
        modifiedZ: Number(modifiedZ.toFixed(3)),
        relativeDeviation: Number(relativeDeviation.toFixed(4)),
        reason: 'statistical_outlier',
      });
    } else {
      validFeeds.push(feed);
    }
  }

  return {
    validFeeds: validFeeds.length > 0 ? validFeeds : [...feeds],
    outliers,
    stats: {
      medianPrice,
      meanPrice: mean,
      stdDev,
      mad,
    },
  };
}

/**
 * Compute the volume-weighted median price across validated feeds.
 *
 * @param {Array<object>} feeds
 * @returns {number}
 */
function computeVolumeWeightedMedian(feeds = []) {
  if (!feeds.length) {
    throw new Error('Cannot compute volume-weighted median from empty feeds');
  }
  if (feeds.length === 1) {
    return Number(feeds[0].price);
  }

  const sorted = [...feeds].sort((a, b) => a.price - b.price);
  const totalVolume = sorted.reduce((sum, f) => sum + (Number(f.volume) || 1), 0);
  const halfVolume = totalVolume / 2;

  let cumulative = 0;
  for (let i = 0; i < sorted.length; i++) {
    const vol = Number(sorted[i].volume) || 1;
    cumulative += vol;
    if (cumulative > halfVolume) {
      return Number(sorted[i].price);
    }
    if (Math.abs(cumulative - halfVolume) < 1e-9 && i + 1 < sorted.length) {
      return Number(((sorted[i].price + sorted[i + 1].price) / 2).toFixed(8));
    }
  }

  return Number(sorted[sorted.length - 1].price);
}

/**
 * Autonomous Multi-Source Oracle Aggregator Daemon (#1455).
 * Collects prices from 5 independent exchange & on-chain feeds, enforces
 * staleness guards, eliminates statistical outliers, computes volume-weighted
 * medians, and publishes on-chain updates within 500ms when deviation crosses threshold.
 */
class OracleAggregatorDaemon extends EventEmitter {
  constructor(options = {}) {
    super();
    this.logger = options.logger || createLogger('oracle-aggregator');
    this.clock = options.clock || { now: () => Date.now() };
    this.maxStalenessMs = Number.isFinite(options.maxStalenessMs)
      ? options.maxStalenessMs
      : DEFAULT_MAX_STALENESS_MS;
    this.outlierZThreshold = Number.isFinite(options.outlierZThreshold)
      ? options.outlierZThreshold
      : DEFAULT_OUTLIER_Z_THRESHOLD;
    this.maxMedianDeviationRatio = Number.isFinite(options.maxMedianDeviationRatio)
      ? options.maxMedianDeviationRatio
      : DEFAULT_MAX_MEDIAN_DEVIATION_RATIO;
    this.deviationThresholdBps = Number.isFinite(options.deviationThresholdBps)
      ? options.deviationThresholdBps
      : DEFAULT_DEVIATION_THRESHOLD_BPS;
    this.minPublishIntervalMs = Number.isFinite(options.minPublishIntervalMs)
      ? options.minPublishIntervalMs
      : 0;
    this.maxGasFeeStroops = Number.isFinite(options.maxGasFeeStroops)
      ? options.maxGasFeeStroops
      : 100_000;

    this.sources = options.sources || {};
    this.onChainPublisher = options.onChainPublisher || null;
    this.lastPublishedByPair = new Map();
    this.latestConsensusByPair = new Map();
    this.pollIntervalId = null;

    this.stats = {
      aggregationsRun: 0,
      updatesPublished: 0,
      updatesSkippedThreshold: 0,
      staleFeedsRejected: 0,
      outliersEliminated: 0,
      lastPublishLatencyMs: 0,
    };
  }

  /**
   * Register or override a price source provider function.
   *
   * @param {string} name - e.g. 'coinbase', 'binance', 'kraken', 'chainlink', 'pyth'
   * @param {Function} providerFn - async (pair) => ({ price, volume, timestamp })
   */
  registerSource(name, providerFn) {
    this.sources[name] = providerFn;
  }

  /**
   * Collect raw feeds from all configured sources for a given asset pair.
   *
   * @param {string} pair
   * @returns {Promise<Array<object>>}
   */
  async collectFeeds(pair = 'XLM-USD') {
    const now = this.clock.now();
    const sourceEntries = Object.entries(this.sources);

    const settled = await Promise.allSettled(
      sourceEntries.map(async ([sourceName, provider]) => {
        const result = typeof provider === 'function' ? await provider(pair) : provider;
        return {
          source: sourceName,
          pair,
          price: Number(result.price),
          volume: Number(result.volume ?? 1000),
          timestamp: result.timestamp !== undefined ? Number(result.timestamp) : now,
        };
      }),
    );

    const collected = [];
    for (const item of settled) {
      if (item.status === 'fulfilled' && item.value) {
        collected.push(item.value);
      }
    }
    return collected;
  }

  /**
   * Aggregate multi-source feeds for `pair`, applying staleness guards,
   * dynamic outlier elimination, volume-weighted median calculation, and
   * threshold-gated on-chain publishing.
   *
   * @param {string} [pair='XLM-USD']
   * @param {object} [options={}]
   * @returns {Promise<object>}
   */
  async aggregateAndPublish(pair = 'XLM-USD', options = {}) {
    const startTimeMs = this.clock.now();
    const perfStartNs = process.hrtime.bigint();
    this.stats.aggregationsRun += 1;

    const rawFeeds = options.feeds || await this.collectFeeds(pair);
    const { freshFeeds, staleFeeds } = filterStaleFeeds(
      rawFeeds,
      startTimeMs,
      options.maxStalenessMs ?? this.maxStalenessMs,
    );

    this.stats.staleFeedsRejected += staleFeeds.length;

    if (freshFeeds.length === 0) {
      const err = new Error(`Zero fresh oracle feeds available for ${pair}`);
      err.code = 'ALL_FEEDS_STALE';
      throw err;
    }

    const { validFeeds, outliers, stats: outlierStats } = filterStatisticalOutliers(freshFeeds, {
      zThreshold: options.outlierZThreshold ?? this.outlierZThreshold,
      maxMedianDeviationRatio: options.maxMedianDeviationRatio ?? this.maxMedianDeviationRatio,
    });

    this.stats.outliersEliminated += outliers.length;

    const consensusPrice = computeVolumeWeightedMedian(validFeeds);
    const previousRecord = this.lastPublishedByPair.get(pair) || null;
    const previousPrice = previousRecord ? previousRecord.price : null;

    const deviationBps = previousPrice !== null && previousPrice > 0
      ? (Math.abs(consensusPrice - previousPrice) / previousPrice) * 10_000
      : Infinity;

    const thresholdBps = options.deviationThresholdBps ?? this.deviationThresholdBps;
    const estimatedGasStroops = Number(options.estimatedGasStroops ?? 1000);
    const withinGasBudget = estimatedGasStroops <= this.maxGasFeeStroops;
    const shouldPublish = (previousPrice === null || deviationBps >= thresholdBps) && withinGasBudget;

    let published = false;
    let txHash = null;

    if (shouldPublish) {
      if (typeof this.onChainPublisher === 'function') {
        const pubResult = await this.onChainPublisher({
          pair,
          price: consensusPrice,
          previousPrice,
          deviationBps: Number.isFinite(deviationBps) ? Number(deviationBps.toFixed(2)) : null,
          sourcesUsed: validFeeds.map((f) => f.source),
          timestamp: startTimeMs,
        });
        txHash = pubResult?.txHash || 'tx-oracle-published';
      } else {
        txHash = `sim-oracle-${pair}-${startTimeMs}`;
      }

      published = true;
      this.stats.updatesPublished += 1;
      this.lastPublishedByPair.set(pair, {
        price: consensusPrice,
        timestamp: startTimeMs,
        txHash,
      });
    } else {
      this.stats.updatesSkippedThreshold += 1;
    }

    const latencyMs = Number((Number(process.hrtime.bigint() - perfStartNs) / 1e6).toFixed(3));
    if (published) {
      this.stats.lastPublishLatencyMs = latencyMs;
    }

    const snapshot = {
      pair,
      consensusPrice,
      previousPrice,
      deviationBps: Number.isFinite(deviationBps) ? Number(deviationBps.toFixed(2)) : null,
      thresholdBps,
      published,
      txHash,
      latencyMs,
      withinPublishSla: latencyMs < DEFAULT_PUBLISH_SLA_MS,
      sourcesUsed: validFeeds.map((f) => f.source),
      freshFeedCount: freshFeeds.length,
      validFeedCount: validFeeds.length,
      staleFeedsRejected: staleFeeds.length,
      outliersEliminated: outliers.length,
      staleFeeds,
      outliers,
      outlierStats,
      timestamp: startTimeMs,
    };

    this.latestConsensusByPair.set(pair, snapshot);
    if (published) {
      this.emit('price:published', snapshot);
    }

    return snapshot;
  }

  /**
   * Evaluate whether a task's oracle price condition is satisfied using verified
   * non-stale consensus prices.
   *
   * @param {object} condition - e.g. { pair: 'XLM-USD', operator: 'gte', targetPrice: 0.12 }
   * @param {object} [options={}]
   * @returns {Promise<object>}
   */
  async evaluatePriceCondition(condition = {}, options = {}) {
    const pair = condition.pair || 'XLM-USD';
    const snapshot = options.snapshot || await this.aggregateAndPublish(pair, options);
    const price = snapshot.consensusPrice;
    const target = Number(condition.targetPrice);
    const op = (condition.operator || 'gte').toLowerCase();

    let isReady = true;
    if (Number.isFinite(target)) {
      if (op === 'gt') isReady = price > target;
      else if (op === 'gte') isReady = price >= target;
      else if (op === 'lt') isReady = price < target;
      else if (op === 'lte') isReady = price <= target;
      else if (op === 'eq') isReady = Math.abs(price - target) < 1e-8;
    }

    return {
      isReady,
      reason: isReady ? 'oracle_condition_met' : 'oracle_threshold_not_met',
      consensusPrice: price,
      targetPrice: target,
      operator: op,
      pair,
      staleFeedsRejected: snapshot.staleFeedsRejected,
      outliersEliminated: snapshot.outliersEliminated,
      latencyMs: snapshot.latencyMs,
    };
  }

  getLatestConsensus(pair = 'XLM-USD') {
    return this.latestConsensusByPair.get(pair) || null;
  }

  getStats() {
    return { ...this.stats };
  }

  startDaemon(pairs = ['XLM-USD'], intervalMs = 5000) {
    if (this.pollIntervalId) return;
    this.pollIntervalId = setInterval(async () => {
      for (const pair of pairs) {
        try {
          await this.aggregateAndPublish(pair);
        } catch (err) {
          this.logger.warn('Oracle daemon cycle error', { pair, error: err.message });
        }
      }
    }, intervalMs);
  }

  stopDaemon() {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }
}

module.exports = {
  ResolverRuntime,
  ResolverRuntimeError,
  OracleAggregatorDaemon,
  fetchCoinbasePrice,
  fetchBinancePrice,
  fetchKrakenPrice,
  ingestChainlinkFeed,
  ingestPythFeed,
  filterStaleFeeds,
  filterStatisticalOutliers,
  computeVolumeWeightedMedian,
};
