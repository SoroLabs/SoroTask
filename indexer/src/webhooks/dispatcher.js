const { createHmac } = require("node:crypto");
const { DEFAULT_MAX_ATTEMPTS, computeBackoffDelayMs } = require("./backoff");
const { CircuitBreakerRegistry } = require("./circuitBreaker");
const { storeDeadLetter } = require("./deadLetterStore");

const SIGNATURE_HEADER = "x-sorotask-signature";
const SIGNATURE_PREFIX = "sha256=";

/**
 * Sign a webhook payload with HMAC-SHA256 using the destination's secret key.
 * Returns undefined when no secret key is configured, so the caller can skip
 * the signature header entirely for unauthenticated webhooks.
 * @param {string} payload JSON string to sign
 * @param {string} secretKey base64 secret key registered by the task creator
 * @returns {string | undefined}
 */
function signWebhookPayload(payload, secretKey) {
  if (!secretKey) return undefined;
  return `${SIGNATURE_PREFIX}${createHmac("sha256", secretKey).update(payload).digest("hex")}`;
}

/**
 * @typedef {object} WebhookDeliveryRequest
 * @property {string} destinationId
 * @property {string} url
 * @property {object} body
 * @property {string} [secretKey] - Optional base64 secret used to HMAC-sign the payload
 */

class WebhookDispatcher {
  /**
   * @param {object} [options]
   * @param {typeof fetch} [options.fetchImpl]
   * @param {CircuitBreakerRegistry} [options.circuitBreaker]
   * @param {number} [options.maxAttempts]
   * @param {(ms:number)=>Promise<void>} [options.sleep]
   */
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.circuitBreaker = options.circuitBreaker || new CircuitBreakerRegistry();
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async dispatch(request) {
    const { destinationId, url, body, secretKey } = request;
    if (!destinationId || !url) {
      throw new Error("destinationId and url are required");
    }

    const payload = JSON.stringify(body);
    const signature = signWebhookPayload(payload, secretKey);
    const headers = { "Content-Type": "application/json" };
    if (signature) {
      headers[SIGNATURE_HEADER] = signature;
    }

    if (this.circuitBreaker.isOpen(destinationId)) {
      this.circuitBreaker.tryRecover(destinationId);
      if (this.circuitBreaker.isOpen(destinationId)) {
        const error = new Error(`Circuit open for destination ${destinationId}`);
        storeDeadLetter({
          destinationId,
          url,
          body,
          attempts: 0,
          error: error.message,
          reason: "circuit_open",
        });
        throw error;
      }
    }

    let lastError = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (attempt > 1) {
        await this.sleep(computeBackoffDelayMs(attempt - 1));
      }

      try {
        const response = await this.fetchImpl(url, {
          method: "POST",
          headers,
          body: payload,
        });
        if (!response.ok) {
          throw new Error(`Webhook returned HTTP ${response.status}`);
        }
        this.circuitBreaker.recordSuccess(destinationId);
        return { success: true, attempts: attempt };
      } catch (err) {
        lastError = err;
        this.circuitBreaker.recordFailure(destinationId);
      }
    }

    storeDeadLetter({
      destinationId,
      url,
      body,
      attempts: this.maxAttempts,
      error: lastError?.message || "delivery failed",
      reason: "max_attempts_exceeded",
    });

    throw lastError || new Error("Webhook delivery failed");
  }
}

module.exports = { WebhookDispatcher, signWebhookPayload, SIGNATURE_HEADER, SIGNATURE_PREFIX };
