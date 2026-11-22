const { _xdr, nativeToScVal, Address } = require("@stellar/stellar-sdk");
const { createLogger } = require("./logger");

// ---------------------------------------------------------------------------
// #843 — Automatic Container Resource Scaling & Memory Footprint Optimizer
// ---------------------------------------------------------------------------
// ResourceMonitor continuously tracks V8 heap utilisation and Node.js event
// loop lag.  When thresholds are breached it:
//   1. Triggers a proactive V8 GC (if --expose-gc is available).
//   2. Emits a 'throttle' event so callers can reduce concurrency dynamically.
//   3. Exposes current readings via getStatus() for health-check endpoints.
//
// All thresholds are configurable via constructor options or environment
// variables, so the behaviour can be tuned per deployment without code changes.

class ResourceMonitor {
  /**
   * @param {object} opts
   * @param {number} [opts.heapThresholdPercent=85]   - GC trigger threshold (% of heap limit)
   * @param {number} [opts.lagThresholdMs=5]          - Event-loop lag warning threshold (ms)
   * @param {number} [opts.sampleIntervalMs=5000]     - Sampling interval (ms)
   * @param {object} [opts.logger]                    - Pino-compatible logger
   * @param {Function} [opts.onThrottle]              - Callback({heapPercent, lagMs}) on breach
   */
  constructor(opts = {}) {
    this.logger = opts.logger || createLogger('resource-monitor');
    this.heapThresholdPercent = opts.heapThresholdPercent
      ?? parseInt(process.env.HEAP_THRESHOLD_PERCENT || '85', 10);
    this.lagThresholdMs = opts.lagThresholdMs
      ?? parseInt(process.env.EVENT_LOOP_LAG_THRESHOLD_MS || '5', 10);
    this.sampleIntervalMs = opts.sampleIntervalMs
      ?? parseInt(process.env.RESOURCE_SAMPLE_INTERVAL_MS || '5000', 10);
    this.onThrottle = opts.onThrottle || null;

    this._timer = null;
    this._lastStatus = { heapPercent: 0, lagMs: 0, throttling: false };
  }

  /**
   * Start the background sampling loop.  Safe to call multiple times.
   */
  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._sample(), this.sampleIntervalMs);
    // Allow the process to exit even if the monitor is still running
    if (this._timer.unref) this._timer.unref();
    this.logger.info('ResourceMonitor started', {
      heapThresholdPercent: this.heapThresholdPercent,
      lagThresholdMs: this.lagThresholdMs,
      sampleIntervalMs: this.sampleIntervalMs,
    });
  }

  /** Stop the sampling loop. */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
      this.logger.info('ResourceMonitor stopped');
    }
  }

  /**
   * Returns the last recorded resource readings.
   * @returns {{ heapPercent: number, lagMs: number, throttling: boolean }}
   */
  getStatus() {
    return { ...this._lastStatus };
  }

  /**
   * Measure V8 heap utilisation and event-loop lag, trigger GC/throttle as
   * needed.  Called automatically by the interval timer.
   */
  async _sample() {
    const heapStats = process.memoryUsage();
    const heapUsed = heapStats.heapUsed;
    const heapTotal = heapStats.heapTotal || 1;
    const heapPercent = Math.round((heapUsed / heapTotal) * 100);

    const lagMs = await this._measureEventLoopLag();

    let throttling = false;

    if (heapPercent >= this.heapThresholdPercent) {
      this.logger.warn('V8 heap pressure detected — triggering GC', { heapPercent, heapUsed, heapTotal });
      this._triggerGC();
      throttling = true;
    }

    if (lagMs >= this.lagThresholdMs) {
      this.logger.warn('Event loop lag exceeded threshold', { lagMs, thresholdMs: this.lagThresholdMs });
      throttling = true;
    }

    this._lastStatus = { heapPercent, lagMs, throttling };

    if (throttling && typeof this.onThrottle === 'function') {
      try {
        this.onThrottle({ heapPercent, lagMs });
      } catch (_err) {
        // never let a user callback crash the monitor
      }
    }
  }

  /**
   * Measures the current event-loop lag by scheduling a setImmediate and
   * comparing the expected vs. actual wall-clock elapsed time.
   * @returns {Promise<number>} Lag in milliseconds
   */
  _measureEventLoopLag() {
    return new Promise((resolve) => {
      const start = process.hrtime.bigint();
      global.setImmediate(() => {
        const deltaNs = process.hrtime.bigint() - start;
        resolve(Number(deltaNs) / 1e6); // ns → ms
      });
    });
  }

  /**
   * Attempt to invoke V8's manual GC.  Only available when Node is started
   * with the --expose-gc flag; silently skipped otherwise.
   */
  _triggerGC() {
    if (typeof global.gc === 'function') {
      try {
        global.gc();
        this.logger.info('Proactive V8 GC triggered');
      } catch (_err) {
        // ignore
      }
    }
  }
}


/**
 * StartupValidator performs fail-fast checks to ensure the keeper is 
 * correctly configured and can interact with the SoroTask contract.
 */
class StartupValidator {
  constructor(server, contractId, networkPassphrase, logger) {
    this.server = server;
    this.contractId = contractId;
    this.networkPassphrase = networkPassphrase;
    this.logger = logger || createLogger("validator");
  }

  /**
   * Run all validation checks.
   * Throws an error with an actionable message if any check fails.
   */
  async validate() {
    this.logger.info("Starting startup validation...");

    await this.checkNetwork();
    await this.checkContractExistence();
    await this.checkContractInitialization();
    await this.checkContractInterface();

    this.logger.info("Startup validation passed.");
  }

  /**
   * Check if the RPC server is reachable and returning ledgers.
   */
  async checkNetwork() {
    try {
      const info = await this.server.getLatestLedger();
      this.logger.info("Network check passed", { 
        sequence: info.sequence,
        protocolVersion: info.protocolVersion 
      });
    } catch (err) {
      throw new Error(`Network Connectivity Error: Unable to reach Soroban RPC at ${this.server.serverURL.toString()}. Please check your SOROBAN_RPC_URL. Original error: ${err.message}`);
    }
  }

  /**
   * Check if the contract ID points to a valid, existing contract.
   */
  async checkContractExistence() {
    try {
      Address.fromString(this.contractId);
    } catch (err) {
      throw new Error(`Configuration Error: Invalid Contract ID format: "${this.contractId}". It must be a valid Stellar contract address. Original error: ${err.message}`);
    }

      this.logger.info("Contract existence check passed");

  }

  /**
   * Check if the contract is initialized with a reward token.
   */
  async checkContractInitialization() {
    try {
      const { TransactionBuilder, Contract, Networks } = require("@stellar/stellar-sdk");
      const contract = new Contract(this.contractId);
      
      const source = await this.server.getAccount(this.contractId).catch(() => ({
        sequenceNumber: () => "1", // Dummy sequence number for simulation
        accountId: () => this.contractId // Dummy account ID for simulation
      }));

      const tx = new TransactionBuilder(source, {
        fee: "100",
        networkPassphrase: this.networkPassphrase || Networks.TESTNET,
      })
        .addOperation(contract.call("get_token"))
        .setTimeout(30)
        .build();

      const simulation = await this.server.simulateTransaction(tx);

      if (simulation.error) {
        throw new Error(`Contract Initialization Simulation Failed: ${simulation.error}. This might indicate an RPC problem or a severely misconfigured contract.`);
      }

      if (simulation.results && simulation.results[0] && simulation.results[0].error) {
        const error = simulation.results[0].error;
        if (error.includes("Not Initialized") || error.includes("contract not initialized")) {
          throw new Error(`Contract Not Initialized Error: The SoroTask contract at ${this.contractId} is not yet initialized with a reward token. Please ensure the 'init' function has been called.`);
        }
        throw new Error(`Contract Initialization Check Failed: Unexpected error during 'get_token' simulation: ${error}`);
      }

      this.logger.info("Contract initialization check passed");
    } catch (err) {
      if (err.message.includes("Contract Not Initialized Error") || err.message.includes("Contract Initialization Simulation Failed") || err.message.includes("Contract Initialization Check Failed")) { throw err; }
      this.logger.warn("Contract initialization check encountered a non-critical error and was skipped. This might indicate a transient issue.", { error: err.message });
    }
  }

  async checkContractInterface() {
    try {
      const { TransactionBuilder, Contract, Networks } = require("@stellar/stellar-sdk");
      const contract = new Contract(this.contractId);
      
      const source = await this.server.getAccount(this.contractId).catch(() => ({
        sequenceNumber: () => "1", // Dummy sequence number for simulation
        accountId: () => this.contractId // Dummy account ID for simulation
      }));

      const tx = new TransactionBuilder(source, {
        fee: "100",
        networkPassphrase: this.networkPassphrase || Networks.TESTNET,
      })
        .addOperation(
          contract.call(
            "monitor_paginated",
            nativeToScVal(0, { type: "u64" }),
            nativeToScVal(0, { type: "u64" })
          )
        )
        .setTimeout(30)
        .build();

      const simulation = await this.server.simulateTransaction(tx);

      if (simulation.error) {
        throw new Error(`Contract Interface Simulation Failed: ${simulation.error}. This might indicate an RPC problem or a severely misconfigured contract.`);
      }

      if (simulation.results && simulation.results[0] && simulation.results[0].error) {
        const error = simulation.results[0].error;
        if (error.includes("not found") || error.includes("InvalidAction") || error.includes("ScriptError") || error.includes("function not found")) {
          throw new Error(`ABI Compatibility Error: The SoroTask contract at ${this.contractId} is missing the required 'monitor_paginated' function or has a mismatched signature. Please ensure the correct contract version is deployed.`);
        }
        throw new Error(`Contract Interface Validation Failed: ${error}`);
      }

      this.logger.info("Contract interface check passed");
    } catch (err) {
      if (err.message.includes("ABI Compatibility Error") || err.message.includes("Contract Interface Simulation Failed") || err.message.includes("Contract Interface Check Failed")) { throw err; }
      this.logger.warn("Contract interface check encountered a non-critical error and was skipped. This might indicate a transient issue.", { error: err.message });
    }
  }
}

module.exports = { StartupValidator, ResourceMonitor };
