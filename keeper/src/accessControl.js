'use strict';

/**
 * accessControl.js — Contract Access Control Audit for Administrative Paths
 *
 * Issue #250: Verify that privileged contract actions cannot be triggered by
 * the wrong actors.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * PERMISSION MODEL (as implemented in contract/src/lib.rs)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The SoroTask contract enforces four distinct authorization layers:
 *
 * 1. SIGNATURE-BASED  (require_auth)
 *    The Soroban host verifies that the named address signed the transaction.
 *    Used for creator-owned operations (register, pause, cancel, withdraw…)
 *    and keeper-owned operations (execute, batch_execute, settle_state_channel).
 *
 * 2. WHITELIST-BASED
 *    execute() checks: if !whitelist.is_empty() && !whitelist.contains(keeper)
 *    → Error::Unauthorized.
 *    SEMANTICS AMBIGUITY: an empty whitelist means ANY keeper may execute.
 *    A non-empty whitelist is strictly restrictive.  Task creators who forget
 *    to populate the whitelist unknowingly publish an open task.
 *
 * 3. ADMIN-BASED
 *    set_admin_address, set_vrf_oracle_address, update_tokenomics_config,
 *    assign_role, revoke_role, grant_permission, revoke_permission, and
 *    delegate_permission are all gated on the stored DataKey::AdminAddress.
 *
 *    ⚠ AMBIGUITY — BOOTSTRAP RACE:
 *    set_admin_address allows the first caller to set the admin unchallenged
 *    ("Anyone can set the initial admin" — lib.rs:3167).  Until an admin is
 *    set, assign_role / grant_permission skip their admin check entirely
 *    (the outer `if let Some(admin)` block is not entered), meaning any actor
 *    can assign roles before the admin is initialized.
 *
 *    ⚠ BUG — BROKEN set_admin_address GUARD (lib.rs:3179):
 *    The existing-admin guard uses `env.current_contract_address()` as the
 *    caller, not the transaction signer.  `current_contract_address()` always
 *    returns the contract's own address, which will never equal an externally
 *    set AdminAddress.  The check therefore always fails, letting **any**
 *    external caller overwrite the admin address after initial bootstrap.
 *
 *    ⚠ BUG — BROKEN init_yield_strategy GUARD (lib.rs:3265):
 *    The guard `if admin != env.current_contract_address()` compares the
 *    contract address with itself — the condition is always false, making
 *    this function callable by any actor with no restriction.
 *
 * 4. ROLE / PERMISSION-BASED
 *    assign_role, revoke_role, grant_permission, revoke_permission require
 *    the caller to be admin OR hold the AdminAccess permission.
 *    RoleAssignment carries an `expires_at` field (lib.rs:4007) but no code
 *    path enforces expiry — expired roles remain valid indefinitely.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * KEEPER ADMIN API PERMISSION MODEL
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The keeper's /admin/* HTTP endpoints are gated by requireAdminAuth()
 * (src/auth.js), which validates a Bearer token against KEEPER_ADMIN_TOKEN.
 *
 * The admin API controls operational state only (pause / resume / status).
 * It does NOT submit on-chain transactions and has no contract-level authority.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ── Privilege levels ──────────────────────────────────────────────────────────

/**
 * Enumeration of all authorization tiers used by the SoroTask contract.
 * Ordered from least to most privileged.
 */
const PrivilegeLevel = Object.freeze({
  PUBLIC: 'public',
  CREATOR: 'creator',
  KEEPER: 'keeper',
  WHITELISTED_KEEPER: 'whitelisted_keeper',
  ADMIN: 'admin',
  ADMIN_OR_DELEGATE: 'admin_or_delegate',
  CONTRACT_SELF: 'contract_self',
  ORACLE_CONTRACT: 'oracle_contract',
  CHANNEL_PARTICIPANT: 'channel_participant',
});

// ── Contract entry point registry ─────────────────────────────────────────────

/**
 * Authoritative registry of every public contract entry point, its required
 * privilege level, the exact mechanism used, and any known ambiguities.
 *
 * This is the source of truth for the access control audit.  The test suite
 * (accessControl.test.js) validates each entry in this registry.
 *
 * @type {readonly Object[]}
 */
const CONTRACT_ENTRY_POINTS = Object.freeze([
  // ── Read-only (no auth) ──────────────────────────────────────────────────
  {
    fn: 'get_task',
    privilege: PrivilegeLevel.PUBLIC,
    mechanism: 'none',
    notes: 'Read-only view. Returns null for non-existent tasks.',
  },
  {
    fn: 'monitor',
    privilege: PrivilegeLevel.PUBLIC,
    mechanism: 'none',
    notes: 'Returns executable task list. No state mutation.',
  },

  // ── Creator-owned task operations ────────────────────────────────────────
  {
    fn: 'register',
    privilege: PrivilegeLevel.CREATOR,
    mechanism: 'config.creator.require_auth()',
    notes: 'Creator signs the transaction. Interval and payload are validated before storage.',
  },
  {
    fn: 'pause_task',
    privilege: PrivilegeLevel.CREATOR,
    mechanism: 'config.creator.require_auth()',
    notes: 'Panics with TaskAlreadyPaused if already inactive.',
  },
  {
    fn: 'resume_task',
    privilege: PrivilegeLevel.CREATOR,
    mechanism: 'config.creator.require_auth()',
    notes: 'Panics with TaskAlreadyActive if already active.',
  },
  {
    fn: 'cancel_task',
    privilege: PrivilegeLevel.CREATOR,
    mechanism: 'config.creator.require_auth()',
    notes: 'Removes task from storage. ID is never reused.',
  },
  {
    fn: 'withdraw_gas',
    privilege: PrivilegeLevel.CREATOR,
    mechanism: 'config.creator.require_auth()',
    notes: 'Transfers gas tokens back to creator.',
  },
  {
    fn: 'add_dependency_with_rule',
    privilege: PrivilegeLevel.CREATOR,
    mechanism: 'task.creator.require_auth()',
    notes: 'A task cannot depend on itself (SelfDependency). Max 16 dependencies.',
  },
  {
    fn: 'request_vrf_randomness',
    privilege: PrivilegeLevel.CREATOR,
    mechanism: 'config.creator.require_auth()',
    notes: 'VRF oracle address must be set first via set_vrf_oracle_address.',
  },
  {
    fn: 'request_oracle_data',
    privilege: PrivilegeLevel.CREATOR,
    mechanism: 'task.creator.require_auth()',
    notes: 'Oracle provider config must be set. Provider address validated.',
  },
  {
    fn: 'submit_zk_condition',
    privilege: PrivilegeLevel.CREATOR,
    mechanism: 'config.creator.require_auth()',
    notes: 'ZK verifier contract address is stored alongside the condition.',
  },
  {
    fn: 'submit_merkle_proof',
    privilege: PrivilegeLevel.CREATOR,
    mechanism: 'config.creator.require_auth()',
    notes: 'Merkle root stored; proof is verified by verifier contract at verify time.',
  },

  // ── Portfolio operations (creator-owned) ─────────────────────────────────
  {
    fn: 'add_task_to_portfolio',
    privilege: PrivilegeLevel.CREATOR,
    mechanism: 'portfolio.creator.require_auth()',
    notes: 'Portfolio creator, not task creator, authorizes.',
  },
  {
    fn: 'remove_task_from_portfolio',
    privilege: PrivilegeLevel.CREATOR,
    mechanism: 'portfolio.creator.require_auth()',
    notes: 'Same: portfolio creator only.',
  },
  {
    fn: 'pause_portfolio',
    privilege: PrivilegeLevel.CREATOR,
    mechanism: 'portfolio.creator.require_auth()',
    notes: 'Pauses all tasks in the portfolio.',
  },
  {
    fn: 'resume_portfolio',
    privilege: PrivilegeLevel.CREATOR,
    mechanism: 'portfolio.creator.require_auth()',
    notes: 'Resumes all tasks in the portfolio.',
  },
  {
    fn: 'fund_portfolio',
    privilege: PrivilegeLevel.CREATOR,
    mechanism: 'portfolio.creator.require_auth()',
    notes: 'Deposits gas to all tasks proportionally.',
  },
  {
    fn: 'execute_portfolio_tasks',
    privilege: PrivilegeLevel.CREATOR,
    mechanism: 'portfolio.creator.require_auth()',
    notes: 'Batch execution gated on portfolio creator; NOT keeper-level auth.',
  },

  // ── Keeper execution paths ────────────────────────────────────────────────
  {
    fn: 'execute',
    privilege: PrivilegeLevel.WHITELISTED_KEEPER,
    mechanism: 'keeper.require_auth() + whitelist check',
    notes: [
      'Two-stage auth: (1) keeper signs tx, (2) whitelist check if non-empty.',
      'AMBIGUITY: empty whitelist = any keeper can execute (open task).',
      'Task creators who omit a whitelist unknowingly publish open tasks.',
    ].join(' '),
  },
  {
    fn: 'batch_execute',
    privilege: PrivilegeLevel.KEEPER,
    mechanism: 'keeper.require_auth()',
    notes: 'No per-task whitelist check in batch path. Max 100 tasks per call.',
  },
  {
    fn: 'deposit_gas',
    privilege: PrivilegeLevel.KEEPER,
    mechanism: 'from.require_auth()',
    notes: 'Depositor (not creator) authorizes. Any address may top up gas.',
  },

  // ── State channel operations ─────────────────────────────────────────────
  {
    fn: 'update_state_channel',
    privilege: PrivilegeLevel.CHANNEL_PARTICIPANT,
    mechanism: 'participants list check',
    notes: 'Caller must be in channel.participants. No require_auth — membership check only.',
  },
  {
    fn: 'settle_state_channel',
    privilege: PrivilegeLevel.KEEPER,
    mechanism: 'keeper.require_auth()',
    notes: 'Keeper settles; triggers micro-task execution within the settlement.',
  },

  // ── Oracle / VRF fulfillment (contract-to-contract) ──────────────────────
  {
    fn: 'fulfill_oracle_data',
    privilege: PrivilegeLevel.ORACLE_CONTRACT,
    mechanism: 'caller.require_auth() + oracle address match',
    notes: 'Oracle contract address must match DataKey::OracleConfig(provider).address.',
  },
  {
    fn: 'fulfill_vrf_request',
    privilege: PrivilegeLevel.ORACLE_CONTRACT,
    mechanism: 'VRF oracle address match (no require_auth)',
    notes: [
      'Uses env.current_contract_address() comparison instead of require_auth.',
      'AMBIGUITY: no cryptographic proof that caller is the configured oracle.',
      'Any contract that somehow gets the VRF oracle address slot could fulfill.',
    ].join(' '),
  },

  // ── ZK / Merkle verification ─────────────────────────────────────────────
  {
    fn: 'verify_zk_condition',
    privilege: PrivilegeLevel.CONTRACT_SELF,
    mechanism: 'verifier address check',
    notes: 'Only the stored ZK verifier contract may call this.',
  },
  {
    fn: 'verify_merkle_proof',
    privilege: PrivilegeLevel.CONTRACT_SELF,
    mechanism: 'verifier address check',
    notes: 'Only the stored Merkle verifier contract may call this.',
  },

  // ── Admin / governance paths ─────────────────────────────────────────────
  {
    fn: 'set_admin_address',
    privilege: PrivilegeLevel.ADMIN,
    mechanism: 'existing admin check OR open bootstrap',
    severity: 'CRITICAL',
    notes: [
      'BUG: guard uses env.current_contract_address() as "caller" (lib.rs:3179).',
      'current_contract_address() == contract address, never == AdminAddress.',
      'Result: ANY external caller can overwrite the admin address after bootstrap.',
      'Bootstrap window (no admin set) also allows any first caller to claim admin.',
    ].join(' '),
  },
  {
    fn: 'set_vrf_oracle_address',
    privilege: PrivilegeLevel.ADMIN,
    mechanism: 'DataKey::AdminAddress comparison',
    notes: 'Correctly guards against non-admin callers when admin is set.',
  },
  {
    fn: 'update_tokenomics_config',
    privilege: PrivilegeLevel.ADMIN,
    mechanism: 'admin address OR governance execution path',
    notes: 'Dual path: admin direct call OR governance-executed proposal.',
  },
  {
    fn: 'init_yield_strategy',
    privilege: PrivilegeLevel.ADMIN,
    mechanism: 'broken — always passes (lib.rs:3265)',
    severity: 'HIGH',
    notes: [
      'BUG: guard is `if admin != env.current_contract_address()` where',
      'admin = env.current_contract_address(). Both sides are equal, so',
      'the condition is always false. Any caller can init yield strategies.',
    ].join(' '),
  },

  // ── Role & permission management ─────────────────────────────────────────
  {
    fn: 'assign_role',
    privilege: PrivilegeLevel.ADMIN_OR_DELEGATE,
    mechanism: 'admin address OR AdminAccess permission',
    notes: [
      'When no admin is set, the admin check block is skipped entirely.',
      'Any actor can assign roles before admin initialization.',
    ].join(' '),
  },
  {
    fn: 'revoke_role',
    privilege: PrivilegeLevel.ADMIN_OR_DELEGATE,
    mechanism: 'admin address OR AdminAccess permission',
    notes: 'Same pre-admin bootstrap gap as assign_role.',
  },
  {
    fn: 'grant_permission',
    privilege: PrivilegeLevel.ADMIN_OR_DELEGATE,
    mechanism: 'admin address OR AdminAccess permission',
    notes: 'Permissions include AdminAccess — escalation risk if grant is wide.',
  },
  {
    fn: 'revoke_permission',
    privilege: PrivilegeLevel.ADMIN_OR_DELEGATE,
    mechanism: 'admin address OR AdminAccess permission',
    notes: 'Revocation is immediate; no grace period.',
  },
  {
    fn: 'delegate_permission',
    privilege: PrivilegeLevel.CREATOR,
    mechanism: 'caller must hold the permissions being delegated',
    notes: [
      'Delegation expires after 30 days by default.',
      'AMBIGUITY: expiry field exists but no enforcement in auth checks.',
      'Expired delegations remain valid until explicitly revoked.',
    ].join(' '),
  },
  {
    fn: 'revoke_delegation',
    privilege: PrivilegeLevel.CREATOR,
    mechanism: 'original delegator address match',
    notes: 'Only the address that created the delegation can revoke it.',
  },
  {
    fn: 'initialize_keeper_reputation',
    privilege: PrivilegeLevel.ADMIN_OR_DELEGATE,
    mechanism: 'admin address OR AdminAccess permission',
    notes: 'Creates an initial reputation record for a keeper address.',
  },
]);

// ── Pre-flight authorization guards ──────────────────────────────────────────
//
// These functions run on the keeper side BEFORE submitting a transaction,
// providing an early-exit with a diagnostic error rather than wasting an
// RPC call that will be rejected by the contract.

/**
 * Assert that a keeper address is authorized to execute a given task.
 *
 * Replicates the contract's two-stage check:
 *   1. keeper must be a string (address will be require_auth'd by Soroban)
 *   2. If task whitelist is non-empty, keeper must appear in it
 *
 * @param   {Object}   taskConfig       - Decoded TaskConfig from the contract
 * @param   {string}   keeperAddress    - The keeper's public key / address
 * @throws  {AccessControlError}        - When the keeper is not authorized
 */
function assertKeeperAuthorized(taskConfig, keeperAddress) {
  if (!taskConfig || typeof keeperAddress !== 'string' || !keeperAddress) {
    throw new AccessControlError(
      'assertKeeperAuthorized: taskConfig and keeperAddress are required',
      'INVALID_ARGS',
    );
  }

  const whitelist = taskConfig.whitelist || [];

  // Empty whitelist = open task — any authenticated keeper may execute
  if (whitelist.length === 0) {
    return; // authorized (open)
  }

  // Non-empty whitelist — keeper must appear
  if (!whitelist.includes(keeperAddress)) {
    throw new AccessControlError(
      `Keeper ${keeperAddress} is not in the task whitelist`,
      'KEEPER_NOT_WHITELISTED',
      { keeperAddress, whitelist },
    );
  }
}

/**
 * Assert that a caller is the creator of a task.
 * Used for creator-only operations (pause, cancel, withdraw_gas, etc.).
 *
 * @param   {Object} taskConfig      - Decoded TaskConfig
 * @param   {string} callerAddress   - Address attempting the operation
 * @throws  {AccessControlError}
 */
function assertCreatorAuthorized(taskConfig, callerAddress) {
  if (!taskConfig || typeof callerAddress !== 'string' || !callerAddress) {
    throw new AccessControlError(
      'assertCreatorAuthorized: taskConfig and callerAddress are required',
      'INVALID_ARGS',
    );
  }

  if (taskConfig.creator !== callerAddress) {
    throw new AccessControlError(
      `Caller ${callerAddress} is not the task creator (${taskConfig.creator})`,
      'NOT_CREATOR',
      { callerAddress, creator: taskConfig.creator },
    );
  }
}

/**
 * Assert that a portfolio operation is authorized by the portfolio creator.
 *
 * @param   {Object} portfolio       - Decoded Portfolio struct
 * @param   {string} callerAddress
 * @throws  {AccessControlError}
 */
function assertPortfolioCreatorAuthorized(portfolio, callerAddress) {
  if (!portfolio || typeof callerAddress !== 'string' || !callerAddress) {
    throw new AccessControlError(
      'assertPortfolioCreatorAuthorized: portfolio and callerAddress are required',
      'INVALID_ARGS',
    );
  }

  if (portfolio.creator !== callerAddress) {
    throw new AccessControlError(
      `Caller ${callerAddress} is not the portfolio creator (${portfolio.creator})`,
      'NOT_PORTFOLIO_CREATOR',
      { callerAddress, creator: portfolio.creator },
    );
  }
}

/**
 * Assert that the keeper admin HTTP token is valid.
 *
 * Mirrors the logic in src/auth.js so callers can validate pre-flight
 * without going through the Express middleware stack.
 *
 * @param   {string|undefined} bearerToken   - Token from Authorization header
 * @param   {string|undefined} expected      - Expected token (KEEPER_ADMIN_TOKEN)
 * @throws  {AccessControlError}
 */
function assertAdminTokenValid(bearerToken, expected) {
  if (!bearerToken) {
    throw new AccessControlError('Missing admin bearer token', 'MISSING_TOKEN');
  }

  if (!expected) {
    throw new AccessControlError(
      'Admin API is disabled: KEEPER_ADMIN_TOKEN is not configured',
      'ADMIN_DISABLED',
    );
  }

  if (bearerToken !== expected) {
    throw new AccessControlError('Invalid admin bearer token', 'INVALID_TOKEN');
  }
}

/**
 * Check whether a task's whitelist is empty (open task) and surface a warning.
 *
 * This is an informational check — open tasks are valid but may be
 * unintentional.  Returns a diagnostic object rather than throwing.
 *
 * @param   {Object} taskConfig
 * @param   {number} taskId
 * @returns {{ isOpen: boolean, warning: string|null }}
 */
function auditTaskWhitelist(taskConfig, taskId) {
  const whitelist = taskConfig?.whitelist || [];

  if (whitelist.length === 0) {
    return {
      isOpen: true,
      warning: `Task ${taskId} has an empty whitelist — any keeper can execute it. ` +
               'If this is unintentional, add keeper addresses to the whitelist.',
    };
  }

  return { isOpen: false, warning: null };
}

// ── Audit helpers ─────────────────────────────────────────────────────────────

/**
 * Return all known privileged entry points for a given privilege level.
 *
 * @param   {string} level - One of PrivilegeLevel.*
 * @returns {Object[]}
 */
function getEntryPointsByPrivilege(level) {
  return CONTRACT_ENTRY_POINTS.filter(ep => ep.privilege === level);
}

/**
 * Return all entry points that carry a known severity flag (bug / ambiguity).
 *
 * @returns {Object[]}
 */
function getKnownAmbiguities() {
  return CONTRACT_ENTRY_POINTS.filter(ep => ep.severity);
}

/**
 * Generate a human-readable summary of the access control model for logging
 * or documentation purposes.
 *
 * @returns {string}
 */
function generateAuditSummary() {
  const byLevel = {};
  for (const ep of CONTRACT_ENTRY_POINTS) {
    if (!byLevel[ep.privilege]) {
      byLevel[ep.privilege] = [];
    }
    byLevel[ep.privilege].push(ep.fn);
  }

  const lines = ['SoroTask Contract Access Control Audit Summary', '='.repeat(50)];

  for (const [level, fns] of Object.entries(byLevel)) {
    lines.push(`\n${level.toUpperCase()} (${fns.length}):`);
    fns.forEach(fn => lines.push(`  - ${fn}`));
  }

  const ambiguities = getKnownAmbiguities();
  if (ambiguities.length > 0) {
    lines.push('\nKNOWN ISSUES / AMBIGUITIES:');
    ambiguities.forEach(ep => {
      lines.push(`  [${ep.severity}] ${ep.fn}: ${ep.notes}`);
    });
  }

  return lines.join('\n');
}

// ── Error type ────────────────────────────────────────────────────────────────

/**
 * Structured error for access control violations.
 * Carries a machine-readable code for test assertions.
 */
class AccessControlError extends Error {
  /**
   * @param {string} message
   * @param {string} code     - Machine-readable code (KEEPER_NOT_WHITELISTED, etc.)
   * @param {Object} [meta]   - Additional diagnostic context
   */
  constructor(message, code, meta = {}) {
    super(message);
    this.name = 'AccessControlError';
    this.code = code;
    this.meta = meta;
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Constants
  PrivilegeLevel,
  CONTRACT_ENTRY_POINTS,

  // Pre-flight guards
  assertKeeperAuthorized,
  assertCreatorAuthorized,
  assertPortfolioCreatorAuthorized,
  assertAdminTokenValid,

  // Audit helpers
  auditTaskWhitelist,
  getEntryPointsByPrivilege,
  getKnownAmbiguities,
  generateAuditSummary,

  // Error type
  AccessControlError,
};
