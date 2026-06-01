const LIMITS = Object.freeze({
  MAX_PAYLOAD_SIZE_BYTES: 8192,
  MAX_ARGS_LENGTH: 20,
  MAX_STRING_LENGTH: 1024,
  MAX_FUNCTION_NAME_LENGTH: 64,
  MAX_NESTING_DEPTH: 8,
  MAX_OBJECT_KEYS: 50,
});

const CONTRACT_ADDRESS_RE = /^C[A-Z0-9]{55}$/;
const FUNCTION_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

class TaskPayloadValidationError extends Error {
  constructor(errors) {
    super(`Invalid task payload: ${errors.join("; ")}`);
    this.name = "TaskPayloadValidationError";
    this.code = "TASK_PAYLOAD_INVALID";
    this.errors = errors;
  }
}

function getSerializedSizeBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function walkValue(value, path, errors, depth = 0) {
  if (depth > LIMITS.MAX_NESTING_DEPTH) {
    errors.push(`${path} exceeds maximum nesting depth of ${LIMITS.MAX_NESTING_DEPTH}.`);
    return;
  }

  if (typeof value === "string" && value.length > LIMITS.MAX_STRING_LENGTH) {
    errors.push(
      `${path} exceeds maximum string length of ${LIMITS.MAX_STRING_LENGTH} characters.`,
    );
    return;
  }

  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    errors.push(`${path} contains unsupported ${typeof value} value.`);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => walkValue(item, `${path}[${index}]`, errors, depth + 1));
    return;
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length > LIMITS.MAX_OBJECT_KEYS) {
      errors.push(`${path} exceeds maximum object key count of ${LIMITS.MAX_OBJECT_KEYS}.`);
      return;
    }

    keys.forEach((key) => walkValue(value[key], `${path}.${key}`, errors, depth + 1));
  }
}

function validateTaskPayload(taskConfig, args = []) {
  const errors = [];

  if (!taskConfig || typeof taskConfig !== "object" || Array.isArray(taskConfig)) {
    errors.push("taskConfig must be an object.");
  } else {
    if (!CONTRACT_ADDRESS_RE.test(taskConfig.target || "")) {
      errors.push(
        "taskConfig.target must be a Soroban contract address with 56 characters starting with C.",
      );
    }

    const functionName = taskConfig.functionName || taskConfig.function;
    if (typeof functionName !== "string" || functionName.length === 0) {
      errors.push("taskConfig.functionName must be a non-empty string.");
    } else {
      if (functionName.length > LIMITS.MAX_FUNCTION_NAME_LENGTH) {
        errors.push(
          `taskConfig.functionName exceeds ${LIMITS.MAX_FUNCTION_NAME_LENGTH} characters.`,
        );
      }
      if (!FUNCTION_NAME_RE.test(functionName)) {
        errors.push("taskConfig.functionName must use a valid identifier format.");
      }
    }
  }

  if (!Array.isArray(args)) {
    errors.push("args must be an array.");
  } else {
    if (args.length > LIMITS.MAX_ARGS_LENGTH) {
      errors.push(`args cannot exceed ${LIMITS.MAX_ARGS_LENGTH} items.`);
    }
    walkValue(args, "args", errors);
  }

  try {
    const sizeBytes = getSerializedSizeBytes({ taskConfig, args });
    if (sizeBytes > LIMITS.MAX_PAYLOAD_SIZE_BYTES) {
      errors.push(
        `payload size ${sizeBytes} bytes exceeds ${LIMITS.MAX_PAYLOAD_SIZE_BYTES} bytes.`,
      );
    }
  } catch (error) {
    errors.push("payload must be JSON serializable.");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

function assertValidTaskPayload(taskConfig, args = []) {
  const result = validateTaskPayload(taskConfig, args);
  if (!result.isValid) {
    throw new TaskPayloadValidationError(result.errors);
  }
  return true;
}

module.exports = {
  LIMITS,
  TaskPayloadValidationError,
  assertValidTaskPayload,
  validateTaskPayload,
};
