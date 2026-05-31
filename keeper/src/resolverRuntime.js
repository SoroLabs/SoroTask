const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createLogger } = require('./logger');

const DEFAULT_TIMEOUT_MS = 250;
const DEFAULT_MAX_SOURCE_BYTES = 64 * 1024;
const DEFAULT_MAX_INPUT_BYTES = 32 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024;

const FORBIDDEN_SOURCE_PATTERNS = [
  /\brequire\s*\(/,
  /\bprocess\b/,
  /\bchild_process\b/,
  /\bworker_threads\b/,
  /\bfs\b/,
  /\bnet\b/,
  /\btls\b/,
  /\bhttp\b/,
  /\bhttps\b/,
  /\bimport\s*\(/,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
];

class ResolverRuntimeError extends Error {
  constructor(message, code, metadata = {}) {
    super(message);
    this.name = 'ResolverRuntimeError';
    this.code = code;
    this.metadata = metadata;
  }
}

function parseInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function byteLength(value) {
  return Buffer.byteLength(String(value), 'utf8');
}

function cloneJson(value, label, maxBytes) {
  let serialized;
  try {
    serialized = JSON.stringify(value ?? null);
  } catch (error) {
    throw new ResolverRuntimeError(
      `${label} must be JSON serializable`,
      'SERIALIZATION_FAILED',
      { label, error: error.message },
    );
  }

  if (byteLength(serialized) > maxBytes) {
    throw new ResolverRuntimeError(
      `${label} exceeds ${maxBytes} bytes`,
      'PAYLOAD_TOO_LARGE',
      { label, maxBytes },
    );
  }

  return JSON.parse(serialized);
}

function normalizeResolverResult(value) {
  if (typeof value === 'boolean') {
    return { isReady: value };
  }

  if (typeof value === 'number') {
    return { isReady: value !== 0, value };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResolverRuntimeError(
      'Resolver must return a boolean or an object',
      'INVALID_RESULT',
    );
  }

  const readiness =
    typeof value.isReady === 'boolean'
      ? value.isReady
      : value.ready;

  if (typeof readiness !== 'boolean') {
    throw new ResolverRuntimeError(
      'Resolver result must include isReady or ready boolean',
      'INVALID_RESULT',
    );
  }

  return {
    isReady: readiness,
    args: Array.isArray(value.args) ? value.args : undefined,
    reason: typeof value.reason === 'string' ? value.reason : undefined,
    metadata:
      value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
        ? value.metadata
        : undefined,
  };
}

function validateJavaScriptSource(source, maxSourceBytes) {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new ResolverRuntimeError('Resolver source is required', 'INVALID_SOURCE');
  }

  if (byteLength(source) > maxSourceBytes) {
    throw new ResolverRuntimeError(
      `Resolver source exceeds ${maxSourceBytes} bytes`,
      'SOURCE_TOO_LARGE',
      { maxSourceBytes },
    );
  }

  const matchedPattern = FORBIDDEN_SOURCE_PATTERNS.find((pattern) => pattern.test(source));
  if (matchedPattern) {
    throw new ResolverRuntimeError(
      'Resolver source contains a blocked capability',
      'BLOCKED_CAPABILITY',
      { pattern: matchedPattern.toString() },
    );
  }
}

function createBoundConsole(logger, resolverId, correlationId) {
  return Object.freeze({
    debug: (...args) => logger.debug('Resolver console.debug', { resolverId, correlationId, args }),
    info: (...args) => logger.info('Resolver console.info', { resolverId, correlationId, args }),
    warn: (...args) => logger.warn('Resolver console.warn', { resolverId, correlationId, args }),
    error: (...args) => logger.error('Resolver console.error', { resolverId, correlationId, args }),
  });
}

function resolveConfigEntries(config) {
  if (!config || typeof config !== 'object') {
    return {};
  }
  return config.functions || config.resolvers || config;
}

class ResolverRuntime {
  constructor(options = {}) {
    this.logger = options.logger || createLogger('resolver-runtime');
    this.defaultTimeoutMs = parseInteger(options.defaultTimeoutMs, DEFAULT_TIMEOUT_MS);
    this.maxSourceBytes = parseInteger(options.maxSourceBytes, DEFAULT_MAX_SOURCE_BYTES);
    this.maxInputBytes = parseInteger(options.maxInputBytes, DEFAULT_MAX_INPUT_BYTES);
    this.maxOutputBytes = parseInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES);
    this.baseDir = path.resolve(options.baseDir || process.cwd());
    this.definitions = new Map();
    this.scriptCache = new Map();

    const entries = resolveConfigEntries(options.functions || options.resolvers || {});
    Object.entries(entries).forEach(([id, definition]) => this.register(id, definition));
  }

  static fromConfigFile(configPath, options = {}) {
    const absolutePath = path.resolve(configPath);
    const raw = fs.readFileSync(absolutePath, 'utf8');
    const parsed = JSON.parse(raw);
    return new ResolverRuntime({
      ...options,
      baseDir: options.baseDir || path.dirname(absolutePath),
      functions: parsed,
    });
  }

  register(id, definition = {}) {
    if (!id || typeof id !== 'string') {
      throw new ResolverRuntimeError('Resolver id must be a non-empty string', 'INVALID_ID');
    }

    const normalized = this.normalizeDefinition(id, definition);
    this.definitions.set(id, normalized);
    return normalized;
  }

  has(id) {
    return this.definitions.has(id);
  }

  list() {
    return Array.from(this.definitions.keys());
  }

  async evaluate(id, input, options = {}) {
    const definition = this.definitions.get(id);
    if (!definition) {
      throw new ResolverRuntimeError(`Resolver "${id}" is not registered`, 'RESOLVER_NOT_FOUND', { id });
    }

    if (definition.enabled === false) {
      throw new ResolverRuntimeError(`Resolver "${id}" is disabled`, 'RESOLVER_DISABLED', { id });
    }

    const startedAt = Date.now();
    const safeInput = cloneJson(input, 'resolver input', definition.maxInputBytes);
    const result = definition.runtime === 'wasm'
      ? await this.evaluateWasm(id, definition, safeInput, options)
      : await this.evaluateJavaScript(id, definition, safeInput, options);

    const safeResult = cloneJson(result, 'resolver result', definition.maxOutputBytes);

    return {
      ...safeResult,
      resolverId: id,
      runtime: definition.runtime,
      durationMs: Date.now() - startedAt,
    };
  }

  normalizeDefinition(id, definition) {
    if (!definition || typeof definition !== 'object') {
      throw new ResolverRuntimeError(`Resolver "${id}" definition must be an object`, 'INVALID_DEFINITION', { id });
    }

    const runtime = (definition.runtime || 'javascript').toLowerCase();
    if (!['javascript', 'js', 'wasm'].includes(runtime)) {
      throw new ResolverRuntimeError(`Unsupported resolver runtime "${definition.runtime}"`, 'UNSUPPORTED_RUNTIME', { id });
    }

    const normalized = {
      ...definition,
      runtime: runtime === 'js' ? 'javascript' : runtime,
      entry: definition.entry || 'resolve',
      timeoutMs: parseInteger(definition.timeoutMs, this.defaultTimeoutMs),
      maxInputBytes: parseInteger(definition.maxInputBytes, this.maxInputBytes),
      maxOutputBytes: parseInteger(definition.maxOutputBytes, this.maxOutputBytes),
      maxSourceBytes: parseInteger(definition.maxSourceBytes, this.maxSourceBytes),
    };

    if (normalized.runtime === 'javascript') {
      normalized.source = this.loadSource(normalized, normalized.maxSourceBytes);
      normalized.sourceHash = crypto.createHash('sha256').update(normalized.source).digest('hex');
      validateJavaScriptSource(normalized.source, normalized.maxSourceBytes);
    } else {
      normalized.wasmBytes = this.loadWasmBytes(normalized);
    }

    return normalized;
  }

  loadSource(definition, maxSourceBytes) {
    if (definition.source != null) {
      return String(definition.source);
    }

    if (!definition.path) {
      throw new ResolverRuntimeError('JavaScript resolver requires source or path', 'INVALID_SOURCE');
    }

    const sourcePath = this.resolveSafePath(definition.path);
    const stat = fs.statSync(sourcePath);
    if (stat.size > maxSourceBytes) {
      throw new ResolverRuntimeError(
        `Resolver source file exceeds ${maxSourceBytes} bytes`,
        'SOURCE_TOO_LARGE',
        { path: sourcePath, maxSourceBytes },
      );
    }

    return fs.readFileSync(sourcePath, 'utf8');
  }

  loadWasmBytes(definition) {
    if (definition.bytesBase64) {
      return Buffer.from(definition.bytesBase64, 'base64');
    }

    if (!definition.path) {
      throw new ResolverRuntimeError('WASM resolver requires bytesBase64 or path', 'INVALID_SOURCE');
    }

    return fs.readFileSync(this.resolveSafePath(definition.path));
  }

  resolveSafePath(candidate) {
    const absolutePath = path.resolve(this.baseDir, candidate);
    if (!absolutePath.startsWith(this.baseDir + path.sep) && absolutePath !== this.baseDir) {
      throw new ResolverRuntimeError('Resolver path escapes configured baseDir', 'PATH_ESCAPE', {
        baseDir: this.baseDir,
        path: candidate,
      });
    }
    return absolutePath;
  }

  getScript(definition) {
    const cacheKey = `${definition.sourceHash}:${definition.entry}`;
    const cached = this.scriptCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const wrappedSource = `
      "use strict";
      const module = { exports: {} };
      const exports = module.exports;
      ${definition.source}
      const __resolver = module.exports && (
        module.exports[${JSON.stringify(definition.entry)}] ||
        module.exports.default ||
        module.exports
      );
      if (typeof __resolver !== "function") {
        throw new Error("Resolver export is not a function");
      }
      __resolver(input, context);
    `;

    const script = new vm.Script(wrappedSource, {
      filename: `resolver:${definition.sourceHash.slice(0, 12)}.js`,
    });
    this.scriptCache.set(cacheKey, script);
    return script;
  }

  async evaluateJavaScript(id, definition, input, options) {
    const contextPayload = cloneJson(
      {
        taskId: input.taskId,
        currentTimestamp: input.currentTimestamp,
        correlationId: options.correlationId || null,
      },
      'resolver context',
      definition.maxInputBytes,
    );

    const sandbox = {
      input,
      context: Object.freeze(contextPayload),
      console: createBoundConsole(this.logger, id, options.correlationId || null),
    };

    const contextified = vm.createContext(sandbox, {
      name: `resolver-${id}`,
      codeGeneration: {
        strings: false,
        wasm: false,
      },
    });

    const script = this.getScript(definition);
    const rawResult = script.runInContext(contextified, {
      timeout: definition.timeoutMs,
      displayErrors: true,
      breakOnSigint: false,
    });

    const awaitedResult = await this.withTimeout(
      Promise.resolve(rawResult),
      definition.timeoutMs,
      id,
    );

    return normalizeResolverResult(awaitedResult);
  }

  async evaluateWasm(id, definition, input) {
    const wasmArgs = Array.isArray(input.wasmArgs)
      ? input.wasmArgs.map((value) => Number(value))
      : [];

    const module = await WebAssembly.compile(definition.wasmBytes);
    const instance = await WebAssembly.instantiate(module, {});
    const exported = instance.exports[definition.entry];

    if (typeof exported !== 'function') {
      throw new ResolverRuntimeError(
        `WASM resolver "${id}" does not export "${definition.entry}"`,
        'INVALID_EXPORT',
        { id, entry: definition.entry },
      );
    }

    return normalizeResolverResult(exported(...wasmArgs));
  }

  withTimeout(promise, timeoutMs, id) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new ResolverRuntimeError(
          `Resolver "${id}" exceeded ${timeoutMs}ms`,
          'TIMEOUT',
          { id, timeoutMs },
        ));
      }, timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
  }
}

module.exports = {
  ResolverRuntime,
  ResolverRuntimeError,
  normalizeResolverResult,
};
