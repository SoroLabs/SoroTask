/**
 * prover-backend.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Hardware-detection + backend-selection layer for witness/proof generation.
 *
 * ⚠️  HONESTY NOTICE  ⚠️
 * ─────────────────────────────────────────────────────────────────────────────
 * There is NO real GPU acceleration in this build. Real CUDA/Metal offload of
 * MSM (multi-scalar multiplication) and NTT (number-theoretic transform) — the
 * hot loops in proof generation — requires native GPU bindings compiled from
 * C++/CUDA (rapidsnark-style) or a Rust/WASM+wgpu module. This CPU-only,
 * GPU-less environment cannot build or verify any of that.
 *
 * WHAT THIS MODULE ACTUALLY DOES (all real):
 *   1. detectAvailableBackends() — inspects realistic host signals
 *      (PROVER_BACKEND env var, CUDA_VISIBLE_DEVICES, presence of an nvidia-smi
 *      binary on PATH) and reports what it saw. Detecting a *signal* is NOT the
 *      same as having a working backend module — the report is honest about that.
 *   2. selectProverBackend() — chooses the backend. Defaults UNCONDITIONALLY to
 *      the existing CPU path unless the operator explicitly opts into a GPU
 *      backend. If they set PROVER_BACKEND=cuda|metal but no real GPU backend
 *      module is wired in (the case here), it FAILS FAST AND LOUDLY rather than
 *      silently pretending to be accelerated.
 *   3. withProofTiming() — a wall-clock timing harness around the real CPU proof
 *      call, so an apples-to-apples benchmark already exists for when a genuine
 *      GPU backend is added later.
 *
 * A real GPU backend would be injected via `options.gpuBackends` (or a registry)
 * so selectProverBackend() returns it instead of throwing — the selection and
 * timing code below would not need to change.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { execSync } = require('child_process');

/** Backends this selection layer understands. Only 'cpu' is actually implemented. */
const KNOWN_BACKENDS = Object.freeze(['cpu', 'rapidsnark', 'cuda', 'metal', 'auto']);
const GPU_BACKENDS = Object.freeze(['cuda', 'metal']);
const RAPIDSNARK_BINARY = 'rapidsnark';

/**
 * Safe existence check for a binary on PATH (e.g. nvidia-smi). Never throws.
 * @param {string} binary
 * @returns {boolean}
 */
function isBinaryOnPath(binary) {
  try {
    const probe = process.platform === 'win32' ? `where ${binary}` : `command -v ${binary}`;
    execSync(probe, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Inspect host signals that *might* indicate accelerated proving support.
 * A positive signal does NOT mean a working accelerated backend module is
 * present in this build — it is reported so the selection layer (and
 * operators) can act on it honestly.
 *
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {{
 *   cpu: boolean,
 *   requestedBackend: string | null,
 *   signals: { cudaVisibleDevices: boolean, nvidiaSmi: boolean, rapidsnark: boolean },
 *   accelerationAvailable: boolean
 * }}
 */
function detectAvailableBackends(opts = {}) {
  const env = opts.env ?? process.env;
  const requested = (env.PROVER_BACKEND || '').trim().toLowerCase() || null;

  const cudaVisibleDevices =
    typeof env.CUDA_VISIBLE_DEVICES === 'string' &&
    env.CUDA_VISIBLE_DEVICES.trim() !== '' &&
    env.CUDA_VISIBLE_DEVICES.trim() !== '-1';
  const nvidiaSmi = isBinaryOnPath('nvidia-smi');
  const rapidsnark =
    isBinaryOnPath(RAPIDSNARK_BINARY) ||
    (typeof env.PROVER_RAPIDSNARK_PATH === 'string' &&
      env.PROVER_RAPIDSNARK_PATH.trim() !== '');

  return {
    cpu: true, // the CPU path is always available
    requestedBackend: requested,
    signals: { cudaVisibleDevices, nvidiaSmi, rapidsnark },
    // No real accelerated backend module ships in this build, so regardless of
    // host signals there is no genuinely-available acceleration. Kept explicit
    // so a future real backend can flip this to true honestly.
    accelerationAvailable: false,
  };
}

/**
 * Select the prover backend.
 *
 * Behaviour contract:
 *   - No PROVER_BACKEND set, or set to 'cpu'  -> { backend:'cpu', accelerated:false }.
 *     ZERO behaviour change for the existing CPU proving path.
 *   - PROVER_BACKEND = 'rapidsnark' and the rapidsnark binary is detected
 *     -> { backend:'rapidsnark', accelerated:true, impl:{kind, binaryPath} }.
 *     If the binary is NOT found, the selection falls back to the CPU prover
 *     and reports `fellBackToCpu: true` (#1210 rapidsnark fallback) instead of
 *     failing the service.
 *   - PROVER_BACKEND = 'auto' -> GPU backend if one is injected, else
 *     rapidsnark when detected, else CPU — never throws.
 *   - PROVER_BACKEND = 'cuda' | 'metal' and a matching real backend is injected
 *     via opts.gpuBackends -> returns that backend.
 *   - PROVER_BACKEND = 'cuda' | 'metal' with NO real backend (the case here)
 *     -> THROWS. Fail fast, loud, honest — never silently fall back to CPU while
 *     letting the deployment believe it is GPU-accelerated.
 *   - Any other value -> THROWS (unknown backend).
 *
 * @param {{ env?: NodeJS.ProcessEnv, gpuBackends?: Record<string, object> }} [opts]
 * @returns {{ backend: string, accelerated: boolean, impl: object | null, fellBackToCpu?: boolean, fallbackReason?: string }}
 */
function selectProverBackend(opts = {}) {
  const env = opts.env ?? process.env;
  const gpuBackends = opts.gpuBackends ?? {};
  const requested = (env.PROVER_BACKEND || '').trim().toLowerCase();

  if (requested === '' || requested === 'cpu') {
    return { backend: 'cpu', accelerated: false, impl: null };
  }

  const rapidsnarkAvailable =
    isBinaryOnPath(RAPIDSNARK_BINARY) ||
    (typeof env.PROVER_RAPIDSNARK_PATH === 'string' &&
      env.PROVER_RAPIDSNARK_PATH.trim() !== '');

  if (requested === 'auto') {
    // GPU backend first (only when genuinely injected), then the rapidsnark
    // native prover, then the always-available CPU path.
    for (const gpu of GPU_BACKENDS) {
      const impl = gpuBackends[gpu];
      if (impl) return { backend: gpu, accelerated: true, impl };
    }
    if (rapidsnarkAvailable) {
      return {
        backend: 'rapidsnark',
        accelerated: true,
        impl: { kind: 'rapidsnark', binaryPath: env.PROVER_RAPIDSNARK_PATH || RAPIDSNARK_BINARY },
      };
    }
    return {
      backend: 'cpu',
      accelerated: false,
      impl: null,
      fellBackToCpu: true,
      fallbackReason: 'No GPU backend injected and rapidsnark binary not detected',
    };
  }

  if (requested === 'rapidsnark') {
    if (rapidsnarkAvailable) {
      return {
        backend: 'rapidsnark',
        accelerated: true,
        impl: { kind: 'rapidsnark', binaryPath: env.PROVER_RAPIDSNARK_PATH || RAPIDSNARK_BINARY },
      };
    }
    // #1210 — rapidsnark fallback: degrade to CPU instead of failing, and say so.
    return {
      backend: 'cpu',
      accelerated: false,
      impl: null,
      fellBackToCpu: true,
      fallbackReason:
        'rapidsnark binary not found on PATH and PROVER_RAPIDSNARK_PATH is not set',
    };
  }

  if (!KNOWN_BACKENDS.includes(requested)) {
    throw new Error(
      `[prover-backend] Unknown PROVER_BACKEND='${requested}'. ` +
      `Expected one of: ${KNOWN_BACKENDS.join(', ')}.`,
    );
  }

  if (GPU_BACKENDS.includes(requested)) {
    const impl = gpuBackends[requested];
    if (impl) {
      return { backend: requested, accelerated: true, impl };
    }
    throw new Error(
      `[prover-backend] PROVER_BACKEND='${requested}' requested GPU acceleration, ` +
      'but no real GPU backend is available in this build/environment. ' +
      'GPU acceleration (CUDA/Metal MSM/NTT offload) requires native GPU bindings ' +
      'that are not compiled here. Refusing to silently run on CPU while reporting ' +
      'as accelerated. Unset PROVER_BACKEND (or set PROVER_BACKEND=cpu) to use the ' +
      'CPU prover explicitly.',
    );
  }

  // Unreachable given the checks above, but defensive.
  return { backend: 'cpu', accelerated: false, impl: null };
}

/**
 * Wall-clock timing harness around a real proof-generation call. Records actual
 * elapsed time so a future GPU backend can be benchmarked apples-to-apples
 * against the CPU baseline.
 *
 * @template T
 * @param {() => Promise<T>} proofFn - async fn that performs one proof generation.
 * @param {{ backend?: string, label?: string }} [meta]
 * @returns {Promise<{ result: T, durationMs: number, backend: string, label: string, startedAt: string }>}
 */
async function withProofTiming(proofFn, meta = {}) {
  const backend = meta.backend ?? 'cpu';
  const label = meta.label ?? 'proof-generation';
  const startedAt = new Date().toISOString();
  const start = process.hrtime.bigint();
  const result = await proofFn();
  const end = process.hrtime.bigint();
  const durationMs = Number(end - start) / 1e6;
  return { result, durationMs, backend, label, startedAt };
}

module.exports = {
  KNOWN_BACKENDS,
  GPU_BACKENDS,
  isBinaryOnPath,
  detectAvailableBackends,
  selectProverBackend,
  withProofTiming,
};
