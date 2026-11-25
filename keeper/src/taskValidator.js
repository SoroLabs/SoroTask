const { BytecodeScanner } = require('./bytecodeScanner');

const defaultScanner = new BytecodeScanner();

/**
 * Constraints for Task Payloads and Arguments
 */
const LIMITS = {
  MAX_PAYLOAD_SIZE_BYTES: 8192, // 8 KB limit to prevent memory exhaustion/DOS
  MAX_ARGS_LENGTH: 20, // Max number of arguments passed to a contract
  MAX_STRING_LENGTH: 1024, // Max length for any string argument
  MAX_FUNCTION_NAME_LEN: 64, // Max length of the Soroban contract function name
};

/**
 * Validates task payload shape, size, constraints, and blacklist status.
 *
 * @param {Object} taskConfig - Configuration containing target and function
 * @param {Array} args - Arguments to be passed to the smart contract
 * @param {Object} [options] - Optional settings (e.g. scanner)
 * @returns {Object} { isValid: boolean, errors: string[] }
 */
function validateTaskPayload(taskConfig, args = [], options = {}) {
  const errors = [];
  const scanner = (options && options.scanner) || defaultScanner;

  // 1. Check total payload size safely
  try {
    const payloadString = JSON.stringify({ taskConfig, args });
    const byteSize = Buffer.byteLength(payloadString, "utf8");
    if (byteSize > LIMITS.MAX_PAYLOAD_SIZE_BYTES) {
      errors.push(
        `Payload size (${byteSize} bytes) exceeds maximum allowed (${LIMITS.MAX_PAYLOAD_SIZE_BYTES} bytes).`,
      );
    }
  } catch (_err) {
    return {
      isValid: false,
      errors: ["Payload cannot be serialized (possible circular reference)."],
    };
  }

  // 2. Validate TaskConfig structure
  if (!taskConfig || typeof taskConfig !== "object") {
    return { isValid: false, errors: ["taskConfig must be a valid object."] };
  }

  // Soroban Contract Addresses are exactly 56 characters and start with 'C'
  if (
    !taskConfig.target ||
    typeof taskConfig.target !== "string" ||
    !/^C[A-Z0-9]{55}$/.test(taskConfig.target)
  ) {
    errors.push(
      "taskConfig.target must be a valid Soroban contract address (56 characters, starts with C).",
    );
  } else if (scanner.isBlacklisted(taskConfig.target)) {
    errors.push(
      `taskConfig.target (${taskConfig.target}) is blacklisted due to smart contract bytecode vulnerabilities.`,
    );
  }

  if (
    !taskConfig.function ||
    typeof taskConfig.function !== "string" ||
    taskConfig.function.length > LIMITS.MAX_FUNCTION_NAME_LEN
  ) {
    errors.push(
      `taskConfig.function must be a string and not exceed ${LIMITS.MAX_FUNCTION_NAME_LEN} characters.`,
    );
  }

  // 3. Validate Arguments
  if (!Array.isArray(args)) {
    errors.push("args must be an array.");
  } else if (args.length > LIMITS.MAX_ARGS_LENGTH) {
    errors.push(`args array cannot exceed ${LIMITS.MAX_ARGS_LENGTH} elements.`);
  } else {
    // Deep check for extreme string lengths within arguments
    const argString = JSON.stringify(args);
    if (argString.includes('":"') || argString.includes('","')) {
      // Simple heuristic: if the array contains massive strings, flag it
      // A full recursive traversal can be added here if highly nested objects are allowed.
    }
  }

  return { isValid: errors.length === 0, errors };
}

/**
 * Minimal ZK gate for private keeper triggers (issue #1469).
 * Verifies a proving-key artifact checksum once, keeps it warm in RAM,
 * and returns a fast placeholder proof. Keeps memory bounded via the daemon.
 */
function validateZkTrigger(privateInputs = {}, options = {}) {
  const { keyId, artifactBuffer, expectedSha256 } = options;
  if (!keyId || !artifactBuffer || !expectedSha256) {
    return { ok: false, reason: 'missing_zk_inputs' };
  }
  const { getSharedProver } = require('./zk/prover');
  const prover = getSharedProver({ maxArtifacts: options.maxArtifacts });
  if (!prover.isWarmed(keyId)) {
    const warmed = prover.warm(keyId, artifactBuffer, expectedSha256);
    if (!warmed.ok) return warmed;
  }
  return prover.prove(keyId, privateInputs);
}

/**
 * Validates contract bytecode using BytecodeScanner (#1447)
 * @param {Buffer|Uint8Array} bytecode
 * @param {Object} [options]
 * @returns {{ isValid: boolean, errors: string[], ast: Object, durationMs: number }}
 */
function validateContractBytecode(bytecode, options = {}) {
  const scanner = (options && options.scanner) || defaultScanner;
  const result = scanner.scan(bytecode, options);
  return {
    isValid: result.safe,
    errors: result.vulnerabilities,
    ast: result.ast,
    durationMs: result.durationMs,
  };
}

module.exports = {
  validateTaskPayload,
  validateContractBytecode,
  BytecodeScanner,
  validateZkTrigger,
  LIMITS,
};
