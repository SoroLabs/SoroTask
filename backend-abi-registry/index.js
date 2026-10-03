const http = require('node:http');
const https = require('node:https');
const parser = require('./parser');
const registry = require('./registry');
const errorHandler = require('./errorHandler');
const errorCodes = require('./errorCodes');
const Monitor = require('./monitor');
const { AbiCache } = require('./abiCache');
const { isValidContractAddress } = require('./registry');

// ---------------------------------------------------------------------------
// Soroban RPC helpers
// ---------------------------------------------------------------------------

/**
 * Encodes a Soroban contract ID (C-strkey) as a base64-encoded XDR
 * `LedgerKey` of type `ContractCode`.
 *
 * The Soroban RPC method `getLedgerEntries` requires a `LedgerKey` XDR blob.
 * We attempt to use `@stellar/stellar-sdk` if available; otherwise we fall
 * back to a raw XDR construction for the most common case.
 *
 * @param {string} contractId - Soroban C-strkey contract address.
 * @returns {string|null} Base64-encoded XDR ledger key, or null on failure.
 */
function buildContractCodeLedgerKey(contractId) {
  try {
    // Prefer the stellar-sdk path when available
    const sdk = require('@stellar/stellar-sdk');
    const sdkRoot = sdk.default || sdk;
    const { xdr, StrKey } = sdkRoot;

    if (!StrKey || !xdr) return null;

    // Decode the contract ID strkey to its raw 32-byte hash
    const contractHashBytes = StrKey.decodeContract(contractId);

    // Build: LedgerKey.contractCode(LedgerKeyContractCode{ hash: Hash })
    const ledgerKey = xdr.LedgerKey.contractCode(
      new xdr.LedgerKeyContractCode({ hash: contractHashBytes })
    );

    return ledgerKey.toXDR('base64');
  } catch (_) {
    return null;
  }
}

/**
 * Sends a JSON-RPC 2.0 POST request to `url` and returns the parsed response.
 *
 * @param {string} url - Soroban RPC endpoint URL.
 * @param {Object} body - JSON-serialisable request body.
 * @param {number} [timeoutMs=10000] - Request timeout in milliseconds.
 * @returns {Promise<Object>} Parsed JSON response.
 */
function jsonRpcPost(url, body, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = transport.request(options, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) {
          reject(new Error(`Invalid JSON from RPC: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`RPC request timed out after ${timeoutMs}ms`));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Queries a Soroban RPC node for the contract executable (`ContractCode`
 * ledger entry) associated with `contractId`, then decodes the embedded WASM.
 *
 * RPC method: `getLedgerEntries`
 * Docs: https://developers.stellar.org/docs/data/rpc/api-reference/methods/getLedgerEntries
 *
 * Response shape (result.entries[0]):
 *  {
 *    xdr: "<base64 LedgerEntryData>",
 *    ...
 *  }
 *
 * `LedgerEntryData.contractCode().code()` is the raw WASM bytes.
 *
 * @param {string} contractId - Soroban C-strkey.
 * @param {string} rpcUrl - Soroban RPC endpoint URL.
 * @returns {Promise<Buffer|null>} Raw WASM bytes, or null if not found.
 */
async function fetchWasmFromRpc(contractId, rpcUrl) {
  const ledgerKey = buildContractCodeLedgerKey(contractId);
  if (!ledgerKey) {
    // SDK unavailable — cannot build the ledger key
    console.warn('[ABIRegistryService] @stellar/stellar-sdk not available; cannot query Soroban RPC');
    return null;
  }

  const rpcResponse = await jsonRpcPost(rpcUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'getLedgerEntries',
    params: { keys: [ledgerKey] },
  });

  if (rpcResponse.error) {
    throw new Error(`Soroban RPC error ${rpcResponse.error.code}: ${rpcResponse.error.message}`);
  }

  const entries = rpcResponse.result && rpcResponse.result.entries;
  if (!entries || entries.length === 0) {
    return null; // Contract not found on-chain
  }

  // Decode the LedgerEntryData XDR to extract the WASM bytes
  try {
    const sdk = require('@stellar/stellar-sdk');
    const sdkRoot = sdk.default || sdk;
    const { xdr } = sdkRoot;

    const entryData = xdr.LedgerEntryData.fromXDR(entries[0].xdr, 'base64');
    const wasmBytes = entryData.contractCode().code();
    return Buffer.from(wasmBytes);
  } catch (xdrErr) {
    throw new Error(`Failed to decode ContractCode XDR: ${xdrErr.message}`);
  }
}

// ---------------------------------------------------------------------------
// ABIRegistryService
// ---------------------------------------------------------------------------

const { TaskFlowGraph } = require('./taskFlowGraph');
const { validateEnv } = require('./envValidator');
const { createSigner } = require('./signer');main

class ABIRegistryService {
  constructor(options = {}) {
    validateEnv(process.env);
    this.monitor = new Monitor(parser, registry);
    this.cache = options.cache || new AbiCache(options);
    this.taskFlowGraph = new TaskFlowGraph();
    this.signer = options.signer || createSigner(options.signerConfig || {});
    this.indexerEvents = null;
    if (options.indexerEvents) this.attachIndexerEvents(options.indexerEvents);
  }

  start() {
    console.log('[ABIRegistryService] Initializing ABI Registry and Parser Service...');
    this.monitor.start();
  }

  stop() {
    console.log('[ABIRegistryService] Shutting down ABI Registry and Parser Service...');
    this.monitor.stop();
  }

  getRegistry() {
    return registry;
  }

  getErrorHandler() {
    return errorHandler;
  }

  getErrorCodes() {
    return errorCodes;
  }

  getTaskFlowGraph() {
    return this.taskFlowGraph;
  }

  registerTaskFlow(graph) {
    return this.taskFlowGraph.register(graph);
  }

  exportTaskFlowToRegisterParams(graph) {
    return this.taskFlowGraph.toRegisterParams(graph);
  }

  decodeErrorCode(code) {
    return errorCodes.decodeErrorCode(code);
  }

  async getABI(contractId, wasmHash, fetchABI) {
    const cached = await this.cache.getPersistent(contractId, wasmHash);
    if (cached) return cached;
    if (typeof fetchABI !== 'function') return null;
    const abi = await fetchABI();
    if (abi) await this.cache.set(contractId, wasmHash, abi);
    return abi;
  }

/**
   * Downloads the WASM for `contractId` from a live Soroban RPC node,
   * parses its embedded `contractspecv0` section into a typed ABI schema,
   * stores the result in the in-memory registry, and caches it with a Redis
   * TTL (if a Redis client was provided at construction).
   *
   * The WASM hash (SHA-256 of the raw bytes) is used as the cache key so that
   * upgraded contracts automatically get a fresh cache entry.
   *
   * @param {string} contractId - Soroban C-strkey contract address.
   * @param {string} rpcUrl     - Soroban RPC endpoint, e.g.
   *                              "https://soroban-testnet.stellar.org".
   * @returns {Promise<Object|null>} Parsed ABI or null on failure.
   */
  async fetchContractABI(contractId, rpcUrl) {
    // ── 1. Validate the contract address ────────────────────────────────────
    if (!isValidContractAddress(contractId)) {
      errorHandler.logError(
        'ABIRegistryService',
        `fetchContractABI: invalid contract address "${contractId}"`
      );
      return null;
    }

    if (!rpcUrl || typeof rpcUrl !== 'string') {
      errorHandler.logError('ABIRegistryService', 'fetchContractABI: rpcUrl is required');
      return null;
    }

    // ── 2. Compute a stable cache key: use the WASM hash after downloading ──
    //    (First check if we already have a fresh cached ABI without downloading)
    //    For now, use a sentinel hash of 'latest' so we can do a pre-check.
    const sentinelHash = 'latest';
    const preCached = await this.cache.getPersistent(contractId, sentinelHash);
    if (preCached) {
      console.log(`[ABIRegistryService] Cache hit for ${contractId} (sentinel)`);
      return preCached;
    }

    // ── 3. Fetch WASM from Soroban RPC ──────────────────────────────────────
    let wasmBytes;
    try {
      wasmBytes = await fetchWasmFromRpc(contractId, rpcUrl);
    } catch (rpcErr) {
      errorHandler.logError('ABIRegistryService', rpcErr);
      return null;
    }

    if (!wasmBytes) {
      errorHandler.logError(
        'ABIRegistryService',
        new Error(`Contract ${contractId} not found on-chain (no ContractCode entry)`)
      );
      return null;
    }

    // ── 4. Compute WASM hash for the real cache key ──────────────────────────
    let wasmHash;
    try {
      const { createHash } = require('node:crypto');
      wasmHash = createHash('sha256').update(wasmBytes).digest('hex');
    } catch (_) {
      wasmHash = sentinelHash;
    }

    // Check cache under the real hash
    const hashCached = await this.cache.getPersistent(contractId, wasmHash);
    if (hashCached) {
      console.log(`[ABIRegistryService] Cache hit for ${contractId} hash=${wasmHash}`);
      registry.addABI(contractId, hashCached);
      return hashCached;
    }

    // ── 5. Parse the WASM → ABI ───────────────────────────────────────────
    let abi;
    try {
      abi = await parser.extractABI({ bytecode: wasmBytes });
    } catch (parseErr) {
      errorHandler.logError('ABIRegistryService', parseErr);
      return null;
    }

    if (!abi) {
      errorHandler.logError(
        'ABIRegistryService',
        new Error(`Failed to parse ABI for contract ${contractId}`)
      );
      return null;
    }

    // ── 6. Store in registry + cache ─────────────────────────────────────────
    registry.addABI(contractId, abi);
    await this.cache.set(contractId, wasmHash, abi);
    // Also store under the sentinel key with the same TTL so the pre-check
    // above works until the next contract upgrade invalidates things.
    await this.cache.set(contractId, sentinelHash, abi);

    console.log(
      `[ABIRegistryService] Fetched and cached ABI for ${contractId} ` +
        `(${abi.functions ? abi.functions.length : 0} functions, hash=${wasmHash})`
    );

    return abi;

getSigner() {
    return this.signer;
  }

  async signTransaction(payload) {
    return this.signer.sign(payload);
  }

  async invalidateOnIndexerEvent(event) {
    return this.cache.handleIndexerEvent(event);
  }

  attachIndexerEvents(eventEmitter) {
    if (!eventEmitter || typeof eventEmitter.on !== 'function') return false;
    this.indexerEvents = eventEmitter;
    eventEmitter.on('event', event => this.invalidateOnIndexerEvent(event));
    eventEmitter.on('ContractUpgraded', event => this.invalidateOnIndexerEvent(event));
    return true;
  }
}

module.exports = new ABIRegistryService();
module.exports.jsonRpcPost = jsonRpcPost;
module.exports.fetchWasmFromRpc = fetchWasmFromRpc;
module.exports.buildContractCodeLedgerKey = buildContractCodeLedgerKey;

module.exports = new ABIRegistryService({ signerConfig: { networkPassphrase: process.env.NETWORK_PASSTHRAPE || process.env.STELLAR_NETWORK_PASSTHRAPE } });
