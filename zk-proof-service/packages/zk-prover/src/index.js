'use strict';

/**
 * @sorotask/zk-prover — client-side WASM ZK proof generation (#852).
 *
 * Wraps snarkjs's groth16 prover (already WASM-based and browser-compatible)
 * so witness data never leaves the browser for devices that can handle the
 * computation locally — sending private witness data to the backend
 * zk-proof-service requires trusting that service's host with it.
 *
 * Falls back to the backend only when the device looks too constrained to
 * run the WASM prover reliably (e.g. low-memory mobile devices), per the
 * issue's proposed solution. snarkjs is an optional peer dependency: it's
 * only actually imported on the browser-proving path, so consumers who
 * always take the backend fallback don't need it bundled.
 */

const DEFAULT_FALLBACK_DEVICE_MEMORY_GB = 4;

/**
 * Heuristic: should this device use the backend fallback instead of proving
 * locally? True when WebAssembly is unavailable, or when the browser
 * reports (via the non-standard but Chromium-supported
 * `navigator.deviceMemory`) less RAM than `minDeviceMemoryGb`.
 *
 * `navigator.deviceMemory` isn't implemented in every browser (notably
 * Safari/Firefox) — when it's absent, this assumes the device CAN run the
 * prover rather than silently routing everyone through the backend, since
 * that would defeat this package's whole privacy goal for the majority of
 * users on browsers that just don't expose the API.
 *
 * @param {{ minDeviceMemoryGb?: number, nav?: { deviceMemory?: number } }} [options]
 * @returns {boolean}
 */
function shouldUseFallback(options = {}) {
  const minDeviceMemoryGb = options.minDeviceMemoryGb ?? DEFAULT_FALLBACK_DEVICE_MEMORY_GB;
  const nav = options.nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);

  if (typeof WebAssembly === 'undefined') return true;

  const deviceMemory = nav && typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined;
  if (deviceMemory !== undefined && deviceMemory < minDeviceMemoryGb) return true;

  return false;
}

/**
 * Generate a Groth16 proof entirely client-side using snarkjs's WASM
 * prover. The witness (`input`) never leaves the browser.
 *
 * @param {Record<string, unknown>} input - Circuit witness input.
 * @param {string} wasmUrl - URL to the circuit's compiled .wasm witness calculator.
 * @param {string} zkeyUrl - URL to the circuit's proving key (.zkey).
 * @returns {Promise<{ proof: object, publicSignals: string[] }>}
 */
async function generateProofInBrowser(input, wasmUrl, zkeyUrl) {
  let snarkjs;
  try {
    // eslint-disable-next-line global-require
    snarkjs = require('snarkjs');
  } catch (err) {
    throw new Error(
      '[zk-prover] snarkjs is required for browser-side proving but is not installed. ' +
      'Install it (npm install snarkjs), or always pass a backendBaseUrl to generateProof ' +
      'so it can use the backend fallback instead.',
    );
  }
  return snarkjs.groth16.fullProve(input, wasmUrl, zkeyUrl);
}

/**
 * Request proof generation from the zk-proof-service backend's
 * POST /generate-proof route — used when `shouldUseFallback()` is true.
 *
 * @param {string} baseUrl - zk-proof-service base URL.
 * @param {{ taskId?: string, circuitId?: string, taskCondition: object, clientData: object }} payload
 * @param {{ authToken?: string, fetch?: typeof fetch }} [options]
 * @returns {Promise<object>}
 */
async function generateProofViaBackend(baseUrl, payload, options = {}) {
  const doFetch = options.fetch ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!doFetch) {
    throw new Error(
      '[zk-prover] No fetch implementation available for the backend fallback. ' +
      'Pass options.fetch explicitly in non-browser environments.',
    );
  }

  const response = await doFetch(`${baseUrl.replace(/\/$/, '')}/generate-proof`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`[zk-prover] Backend proof generation failed (${response.status}): ${body}`);
  }

  return response.json();
}

/**
 * Generate a ZK proof, proving locally in the browser when the device looks
 * capable, and falling back to the backend zk-proof-service otherwise.
 *
 * @param {object} params
 * @param {Record<string, unknown>} [params.input] - Circuit witness input (browser path only).
 * @param {string} [params.wasmUrl] - Required for the browser path.
 * @param {string} [params.zkeyUrl] - Required for the browser path.
 * @param {string} [params.backendBaseUrl] - zk-proof-service base URL, required for the fallback path.
 * @param {object} [params.backendPayload] - Request body for the fallback path (see generateProofViaBackend).
 * @param {{ minDeviceMemoryGb?: number, nav?: object, authToken?: string, fetch?: typeof fetch }} [options]
 * @returns {Promise<{ proof: object, publicSignals: string[], source: 'browser' | 'backend' }>}
 */
async function generateProof(params, options = {}) {
  const useFallback = shouldUseFallback(options);

  if (useFallback) {
    if (!params.backendBaseUrl || !params.backendPayload) {
      throw new Error(
        '[zk-prover] This device requires the backend fallback but backendBaseUrl/' +
        'backendPayload were not provided.',
      );
    }
    const result = await generateProofViaBackend(params.backendBaseUrl, params.backendPayload, options);
    return { ...result, source: 'backend' };
  }

  if (!params.wasmUrl || !params.zkeyUrl) {
    throw new Error('[zk-prover] wasmUrl/zkeyUrl are required to prove in the browser.');
  }
  const result = await generateProofInBrowser(params.input, params.wasmUrl, params.zkeyUrl);
  return { ...result, source: 'browser' };
}

module.exports = {
  shouldUseFallback,
  generateProofInBrowser,
  generateProofViaBackend,
  generateProof,
};
