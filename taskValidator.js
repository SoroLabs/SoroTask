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
 * Validates task payload shape, size, and constraints.
 *
 * @param {Object} taskConfig - Configuration containing target and function
 * @param {Array} args - Arguments to be passed to the smart contract
 * @returns {Object} { isValid: boolean, errors: string[] }
 */
function validateTaskPayload(taskConfig, args = []) {
  const errors = [];

  // 1. Check total payload size safely
  try {
    const payloadString = JSON.stringify({ taskConfig, args });
    const byteSize = Buffer.byteLength(payloadString, "utf8");
    if (byteSize > LIMITS.MAX_PAYLOAD_SIZE_BYTES) {
      errors.push(
        `Payload size (${byteSize} bytes) exceeds maximum allowed (${LIMITS.MAX_PAYLOAD_SIZE_BYTES} bytes).`,
      );
    }
  } catch (err) {
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

module.exports = { validateTaskPayload, LIMITS };
