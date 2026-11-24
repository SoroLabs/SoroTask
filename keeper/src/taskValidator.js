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
  STALE_TASK_THRESHOLD_MS: 365 * 24 * 60 * 60 * 1000, // ~1 year of lapsed interval
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
    for (const arg of args) {
      if (typeof arg === "string" && arg.length > LIMITS.MAX_STRING_LENGTH) {
        errors.push(
          `args string elements cannot exceed ${LIMITS.MAX_STRING_LENGTH} characters.`,
        );
        break;
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}

/**
 * Determines whether a task is permanently inactive and should be retired.
 * A task is stale when its target contract no longer exists (destroyed) or
 * its interval has lapsed for longer than STALE_TASK_THRESHOLD_MS.
 *
 * @param {Object} task - { lastExecutedAt: number(ms), targetExists: boolean, intervalMs: number }
 * @param {number} [now=Date.now()]
 * @returns {{ stale: boolean, reason: string|null }}
 */
function isTaskStale(task, now = Date.now()) {
  if (!task || typeof task !== "object") {
    return { stale: false, reason: null };
  }
  if (task.targetExists === false) {
    return { stale: true, reason: "target_destroyed" };
  }
  const last = Number(task.lastExecutedAt);
  if (Number.isFinite(last) && now - last > LIMITS.STALE_TASK_THRESHOLD_MS) {
    return { stale: true, reason: "interval_lapsed" };
  }
  return { stale: false, reason: null };
}

/**
 * Retires stale tasks: triggers on-chain cancellation (which refunds the
 * creator's escrow) and records the refund, archiving each task once the
 * cancellation is confirmed. Failures are isolated per task so one bad
 * record cannot block the purge of the rest.
 *
 * @param {Array<Object>} tasks - Candidate tasks with { id, creator, escrowAmount, ...stale fields }
 * @param {Object} deps - { cancelTask(taskId) => Promise<{ok, refunded}>, archiveTask(task) => Promise<void> }
 * @param {Object} [options] - { now, dryRun }
 * @returns {Promise<{ retired: Array, failed: Array, refunds: Array, totalRefunded: number, skipped: number }>}
 */
async function purgeStaleTasks(tasks, deps = {}, options = {}) {
  const { cancelTask, archiveTask } = deps;
  if (typeof cancelTask !== "function" || typeof archiveTask !== "function") {
    throw new TypeError("purgeStaleTasks requires cancelTask and archiveTask functions.");
  }
  const now = options.now ?? Date.now();
  const dryRun = Boolean(options.dryRun);
  const retired = [];
  const failed = [];
  const refunds = [];
  let skipped = 0;
  let totalRefunded = 0;

  for (const task of Array.isArray(tasks) ? tasks : []) {
    const verdict = isTaskStale(task, now);
    if (!verdict.stale) {
      skipped++;
      continue;
    }
    if (dryRun) {
      retired.push({ id: task.id, reason: verdict.reason, dryRun: true });
      continue;
    }
    try {
      const result = await cancelTask(task.id);
      if (!result || result.ok !== true) {
        failed.push({ id: task.id, error: (result && result.error) || "cancel_failed" });
        continue;
      }
      const refunded = Number(result.refunded ?? task.escrowAmount ?? 0);
      if (!Number.isFinite(refunded) || refunded < 0) {
        failed.push({ id: task.id, error: "invalid_refund_amount" });
        continue;
      }
      refunds.push({ taskId: task.id, creator: task.creator, amount: refunded });
      totalRefunded += refunded;
      await archiveTask({ ...task, reason: verdict.reason, retiredAt: now, refunded });
      retired.push({ id: task.id, reason: verdict.reason, refunded });
    } catch (err) {
      failed.push({ id: task.id, error: err && err.message ? err.message : String(err) });
    }
  }

  return { retired, failed, refunds, totalRefunded, skipped };
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
  isTaskStale,
  purgeStaleTasks,
  LIMITS,
};
