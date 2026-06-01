'use strict';

/**
 * accessControl.test.js — Contract Access Control Audit Tests
 *
 * Issue #250: Verify that privileged contract actions cannot be triggered
 * by the wrong actors.
 *
 * Coverage:
 *   - Registry completeness (every entry point is catalogued)
 *   - Keeper whitelist: empty (open), non-empty (restricted), partial matches
 *   - Creator-only guards: authorized vs unauthorized callers
 *   - Portfolio creator guards
 *   - Keeper admin HTTP API: missing / invalid / valid tokens
 *   - Admin-disabled state (no KEEPER_ADMIN_TOKEN configured)
 *   - Whitelist audit helper (surfaces open-task warnings)
 *   - Known contract bugs surfaced as documented findings
 *   - AccessControlError structure (code, meta, name)
 *   - Audit summary generation
 *   - getEntryPointsByPrivilege / getKnownAmbiguities helpers
 */

const {
  PrivilegeLevel,
  CONTRACT_ENTRY_POINTS,
  assertKeeperAuthorized,
  assertCreatorAuthorized,
  assertPortfolioCreatorAuthorized,
  assertAdminTokenValid,
  auditTaskWhitelist,
  getEntryPointsByPrivilege,
  getKnownAmbiguities,
  generateAuditSummary,
  AccessControlError,
} = require('../src/accessControl');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALICE = 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL';
const BOB = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
const CAROL = 'GCLWGQPMKIF3VP4B4BQZGCNCJVNFPBZK6H7YOTNBWB6NLCR3D4EZUVT';

function makeTaskConfig(overrides = {}) {
  return {
    creator: ALICE,
    target: BOB,
    function: 'run',
    args: [],
    resolver: null,
    interval: 3600,
    last_run: 0,
    gas_balance: 500,
    whitelist: [],
    is_active: true,
    blocked_by: [],
    ...overrides,
  };
}

function makePortfolio(overrides = {}) {
  return {
    creator: ALICE,
    name: 'Test Portfolio',
    is_active: true,
    task_count: 0,
    ...overrides,
  };
}

// ── AccessControlError ────────────────────────────────────────────────────────

describe('AccessControlError', () => {
  it('sets name, message, code, and meta', () => {
    const err = new AccessControlError('test message', 'TEST_CODE', { foo: 'bar' });
    expect(err.name).toBe('AccessControlError');
    expect(err.message).toBe('test message');
    expect(err.code).toBe('TEST_CODE');
    expect(err.meta).toEqual({ foo: 'bar' });
  });

  it('extends Error', () => {
    const err = new AccessControlError('msg', 'CODE');
    expect(err).toBeInstanceOf(Error);
  });

  it('meta defaults to empty object', () => {
    const err = new AccessControlError('msg', 'CODE');
    expect(err.meta).toEqual({});
  });
});

// ── Registry completeness ─────────────────────────────────────────────────────

describe('CONTRACT_ENTRY_POINTS registry', () => {
  it('is a non-empty frozen array', () => {
    expect(Array.isArray(CONTRACT_ENTRY_POINTS)).toBe(true);
    expect(CONTRACT_ENTRY_POINTS.length).toBeGreaterThan(0);
    expect(Object.isFrozen(CONTRACT_ENTRY_POINTS)).toBe(true);
  });

  it('every entry has fn, privilege, mechanism, and notes fields', () => {
    for (const ep of CONTRACT_ENTRY_POINTS) {
      expect(typeof ep.fn).toBe('string');
      expect(typeof ep.privilege).toBe('string');
      expect(typeof ep.mechanism).toBe('string');
      expect(typeof ep.notes).toBe('string');
    }
  });

  it('every privilege value is a known PrivilegeLevel', () => {
    const validLevels = new Set(Object.values(PrivilegeLevel));
    for (const ep of CONTRACT_ENTRY_POINTS) {
      expect(validLevels.has(ep.privilege)).toBe(true);
    }
  });

  it('catalogs all required privileged entry points', () => {
    const fns = CONTRACT_ENTRY_POINTS.map(ep => ep.fn);

    // Creator-owned
    expect(fns).toContain('register');
    expect(fns).toContain('pause_task');
    expect(fns).toContain('resume_task');
    expect(fns).toContain('cancel_task');
    expect(fns).toContain('withdraw_gas');
    expect(fns).toContain('add_dependency_with_rule');
    expect(fns).toContain('request_vrf_randomness');
    expect(fns).toContain('request_oracle_data');

    // Keeper execution
    expect(fns).toContain('execute');
    expect(fns).toContain('batch_execute');
    expect(fns).toContain('deposit_gas');

    // Portfolio
    expect(fns).toContain('add_task_to_portfolio');
    expect(fns).toContain('execute_portfolio_tasks');

    // Admin
    expect(fns).toContain('set_admin_address');
    expect(fns).toContain('set_vrf_oracle_address');
    expect(fns).toContain('init_yield_strategy');

    // Role management
    expect(fns).toContain('assign_role');
    expect(fns).toContain('revoke_role');
    expect(fns).toContain('grant_permission');
    expect(fns).toContain('revoke_permission');
    expect(fns).toContain('delegate_permission');
    expect(fns).toContain('revoke_delegation');

    // Public
    expect(fns).toContain('get_task');
    expect(fns).toContain('monitor');
  });

  it('execute is classified as WHITELISTED_KEEPER', () => {
    const ep = CONTRACT_ENTRY_POINTS.find(e => e.fn === 'execute');
    expect(ep.privilege).toBe(PrivilegeLevel.WHITELISTED_KEEPER);
  });

  it('get_task and monitor are PUBLIC with no auth mechanism', () => {
    const ep = CONTRACT_ENTRY_POINTS.find(e => e.fn === 'get_task');
    expect(ep.privilege).toBe(PrivilegeLevel.PUBLIC);
    expect(ep.mechanism).toBe('none');

    const mon = CONTRACT_ENTRY_POINTS.find(e => e.fn === 'monitor');
    expect(mon.privilege).toBe(PrivilegeLevel.PUBLIC);
  });
});

// ── Keeper whitelist authorization ────────────────────────────────────────────

describe('assertKeeperAuthorized — whitelist enforcement', () => {
  describe('open tasks (empty whitelist)', () => {
    it('allows any keeper when whitelist is empty array', () => {
      const task = makeTaskConfig({ whitelist: [] });
      expect(() => assertKeeperAuthorized(task, BOB)).not.toThrow();
      expect(() => assertKeeperAuthorized(task, CAROL)).not.toThrow();
    });

    it('allows any keeper when whitelist field is missing', () => {
      const task = makeTaskConfig();
      delete task.whitelist;
      expect(() => assertKeeperAuthorized(task, BOB)).not.toThrow();
    });
  });

  describe('restricted tasks (non-empty whitelist)', () => {
    it('allows a keeper that appears in the whitelist', () => {
      const task = makeTaskConfig({ whitelist: [BOB] });
      expect(() => assertKeeperAuthorized(task, BOB)).not.toThrow();
    });

    it('rejects a keeper that is NOT in the whitelist', () => {
      const task = makeTaskConfig({ whitelist: [BOB] });
      expect(() => assertKeeperAuthorized(task, CAROL))
        .toThrow(AccessControlError);
    });

    it('rejected error has code KEEPER_NOT_WHITELISTED', () => {
      const task = makeTaskConfig({ whitelist: [BOB] });
      let caught;
      try {
        assertKeeperAuthorized(task, CAROL);
      } catch (e) {
        caught = e;
      }
      expect(caught.code).toBe('KEEPER_NOT_WHITELISTED');
    });

    it('error meta includes keeperAddress and whitelist', () => {
      const task = makeTaskConfig({ whitelist: [BOB] });
      let caught;
      try {
        assertKeeperAuthorized(task, CAROL);
      } catch (e) {
        caught = e;
      }
      expect(caught.meta.keeperAddress).toBe(CAROL);
      expect(caught.meta.whitelist).toEqual([BOB]);
    });

    it('allows keeper when whitelist has multiple entries and keeper matches one', () => {
      const task = makeTaskConfig({ whitelist: [ALICE, BOB, CAROL] });
      expect(() => assertKeeperAuthorized(task, BOB)).not.toThrow();
    });

    it('rejects keeper when whitelist has multiple entries and keeper matches none', () => {
      const task = makeTaskConfig({ whitelist: [ALICE, BOB] });
      expect(() => assertKeeperAuthorized(task, CAROL)).toThrow(AccessControlError);
    });
  });

  describe('invalid arguments', () => {
    it('throws INVALID_ARGS when taskConfig is null', () => {
      let caught;
      try {
        assertKeeperAuthorized(null, BOB);
      } catch (e) {
        caught = e;
      }
      expect(caught.code).toBe('INVALID_ARGS');
    });

    it('throws INVALID_ARGS when keeperAddress is empty string', () => {
      const task = makeTaskConfig();
      let caught;
      try {
        assertKeeperAuthorized(task, '');
      } catch (e) {
        caught = e;
      }
      expect(caught.code).toBe('INVALID_ARGS');
    });

    it('throws INVALID_ARGS when keeperAddress is not a string', () => {
      const task = makeTaskConfig();
      let caught;
      try {
        assertKeeperAuthorized(task, 12345);
      } catch (e) {
        caught = e;
      }
      expect(caught.code).toBe('INVALID_ARGS');
    });
  });
});

// ── Creator authorization ─────────────────────────────────────────────────────

describe('assertCreatorAuthorized — creator-only operations', () => {
  it('allows the task creator', () => {
    const task = makeTaskConfig({ creator: ALICE });
    expect(() => assertCreatorAuthorized(task, ALICE)).not.toThrow();
  });

  it('rejects a non-creator caller', () => {
    const task = makeTaskConfig({ creator: ALICE });
    expect(() => assertCreatorAuthorized(task, BOB)).toThrow(AccessControlError);
  });

  it('rejected error has code NOT_CREATOR', () => {
    const task = makeTaskConfig({ creator: ALICE });
    let caught;
    try {
      assertCreatorAuthorized(task, BOB);
    } catch (e) {
      caught = e;
    }
    expect(caught.code).toBe('NOT_CREATOR');
  });

  it('error meta identifies both caller and creator', () => {
    const task = makeTaskConfig({ creator: ALICE });
    let caught;
    try {
      assertCreatorAuthorized(task, BOB);
    } catch (e) {
      caught = e;
    }
    expect(caught.meta.callerAddress).toBe(BOB);
    expect(caught.meta.creator).toBe(ALICE);
  });

  it('throws INVALID_ARGS when taskConfig is null', () => {
    let caught;
    try {
      assertCreatorAuthorized(null, ALICE);
    } catch (e) {
      caught = e;
    }
    expect(caught.code).toBe('INVALID_ARGS');
  });

  it('throws INVALID_ARGS when callerAddress is missing', () => {
    const task = makeTaskConfig();
    let caught;
    try {
      assertCreatorAuthorized(task, '');
    } catch (e) {
      caught = e;
    }
    expect(caught.code).toBe('INVALID_ARGS');
  });

  it('creator check is exact-match — prefix match does not count', () => {
    const task = makeTaskConfig({ creator: ALICE });
    // A truncated or partial address must be rejected
    expect(() => assertCreatorAuthorized(task, ALICE.slice(0, 10)))
      .toThrow(AccessControlError);
  });
});

// ── Portfolio creator authorization ───────────────────────────────────────────

describe('assertPortfolioCreatorAuthorized — portfolio operations', () => {
  it('allows the portfolio creator', () => {
    const portfolio = makePortfolio({ creator: ALICE });
    expect(() => assertPortfolioCreatorAuthorized(portfolio, ALICE)).not.toThrow();
  });

  it('rejects a task creator who is not the portfolio creator', () => {
    const portfolio = makePortfolio({ creator: ALICE });
    // BOB owns a task in the portfolio but is not the portfolio creator
    expect(() => assertPortfolioCreatorAuthorized(portfolio, BOB))
      .toThrow(AccessControlError);
  });

  it('rejected error has code NOT_PORTFOLIO_CREATOR', () => {
    const portfolio = makePortfolio({ creator: ALICE });
    let caught;
    try {
      assertPortfolioCreatorAuthorized(portfolio, BOB);
    } catch (e) {
      caught = e;
    }
    expect(caught.code).toBe('NOT_PORTFOLIO_CREATOR');
  });

  it('throws INVALID_ARGS when portfolio is null', () => {
    let caught;
    try {
      assertPortfolioCreatorAuthorized(null, ALICE);
    } catch (e) {
      caught = e;
    }
    expect(caught.code).toBe('INVALID_ARGS');
  });
});

// ── Keeper admin HTTP API ─────────────────────────────────────────────────────

describe('assertAdminTokenValid — keeper admin HTTP authorization', () => {
  it('accepts a correct bearer token', () => {
    expect(() => assertAdminTokenValid('secret-token', 'secret-token')).not.toThrow();
  });

  it('rejects a missing/undefined bearer token with MISSING_TOKEN', () => {
    let caught;
    try {
      assertAdminTokenValid(undefined, 'secret-token');
    } catch (e) {
      caught = e;
    }
    expect(caught.code).toBe('MISSING_TOKEN');
  });

  it('rejects an empty bearer token with MISSING_TOKEN', () => {
    let caught;
    try {
      assertAdminTokenValid('', 'secret-token');
    } catch (e) {
      caught = e;
    }
    expect(caught.code).toBe('MISSING_TOKEN');
  });

  it('rejects a wrong bearer token with INVALID_TOKEN', () => {
    let caught;
    try {
      assertAdminTokenValid('wrong-token', 'secret-token');
    } catch (e) {
      caught = e;
    }
    expect(caught.code).toBe('INVALID_TOKEN');
  });

  it('rejects when KEEPER_ADMIN_TOKEN is not configured (admin disabled)', () => {
    let caught;
    try {
      assertAdminTokenValid('some-token', undefined);
    } catch (e) {
      caught = e;
    }
    expect(caught.code).toBe('ADMIN_DISABLED');
  });

  it('token comparison is case-sensitive', () => {
    expect(() => assertAdminTokenValid('Secret-Token', 'secret-token'))
      .toThrow(AccessControlError);
  });

  it('token comparison is exact — extra whitespace is rejected', () => {
    expect(() => assertAdminTokenValid(' secret-token', 'secret-token'))
      .toThrow(AccessControlError);
  });
});

// ── requireAdminAuth middleware (src/auth.js) ─────────────────────────────────

describe('requireAdminAuth middleware — HTTP layer', () => {
  const { requireAdminAuth } = require('../src/auth');

  function mockRes() {
    return {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json() {},
    };
  }

  afterEach(() => {
    delete process.env.KEEPER_ADMIN_TOKEN;
  });

  it('returns 401 when Authorization header is missing', () => {
    const req = { headers: {} };
    const res = mockRes();
    requireAdminAuth(req, res, () => {});
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when Authorization header does not start with Bearer', () => {
    const req = { headers: { authorization: 'Basic sometoken' } };
    const res = mockRes();
    requireAdminAuth(req, res, () => {});
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when KEEPER_ADMIN_TOKEN is not set (admin disabled)', () => {
    // No env var set
    const req = { headers: { authorization: 'Bearer anything' } };
    const res = mockRes();
    requireAdminAuth(req, res, () => {});
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when token does not match KEEPER_ADMIN_TOKEN', () => {
    process.env.KEEPER_ADMIN_TOKEN = 'correct-token';
    const req = { headers: { authorization: 'Bearer wrong-token' } };
    const res = mockRes();
    requireAdminAuth(req, res, () => {});
    expect(res.statusCode).toBe(403);
  });

  it('calls next() when token matches KEEPER_ADMIN_TOKEN', () => {
    process.env.KEEPER_ADMIN_TOKEN = 'correct-token';
    const req = { headers: { authorization: 'Bearer correct-token' } };
    const res = mockRes();
    let nextCalled = false;
    requireAdminAuth(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200); // unchanged
  });

  it('does not call next() on authentication failure', () => {
    process.env.KEEPER_ADMIN_TOKEN = 'correct-token';
    const req = { headers: { authorization: 'Bearer wrong' } };
    const res = mockRes();
    let nextCalled = false;
    requireAdminAuth(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
  });
});

// ── Whitelist audit helper ────────────────────────────────────────────────────

describe('auditTaskWhitelist — open task detection', () => {
  it('flags an empty whitelist as open with a warning', () => {
    const task = makeTaskConfig({ whitelist: [] });
    const result = auditTaskWhitelist(task, 42);
    expect(result.isOpen).toBe(true);
    expect(result.warning).toMatch(/42/); // includes task ID
    expect(result.warning).toMatch(/empty whitelist/);
  });

  it('returns isOpen:false and no warning for a non-empty whitelist', () => {
    const task = makeTaskConfig({ whitelist: [BOB] });
    const result = auditTaskWhitelist(task, 42);
    expect(result.isOpen).toBe(false);
    expect(result.warning).toBeNull();
  });

  it('handles null taskConfig gracefully (treats as open)', () => {
    const result = auditTaskWhitelist(null, 99);
    expect(result.isOpen).toBe(true);
  });

  it('handles missing whitelist field (treats as open)', () => {
    const task = makeTaskConfig();
    delete task.whitelist;
    const result = auditTaskWhitelist(task, 1);
    expect(result.isOpen).toBe(true);
  });
});

// ── Registry query helpers ─────────────────────────────────────────────────────

describe('getEntryPointsByPrivilege', () => {
  it('returns only entries matching the given privilege level', () => {
    const creatorEps = getEntryPointsByPrivilege(PrivilegeLevel.CREATOR);
    expect(creatorEps.length).toBeGreaterThan(0);
    creatorEps.forEach(ep => expect(ep.privilege).toBe(PrivilegeLevel.CREATOR));
  });

  it('returns an empty array for an unknown privilege level', () => {
    expect(getEntryPointsByPrivilege('nonexistent')).toEqual([]);
  });

  it('ADMIN entries include set_admin_address and set_vrf_oracle_address', () => {
    const adminEps = getEntryPointsByPrivilege(PrivilegeLevel.ADMIN);
    const fns = adminEps.map(ep => ep.fn);
    expect(fns).toContain('set_admin_address');
    expect(fns).toContain('set_vrf_oracle_address');
  });

  it('PUBLIC entries include get_task and monitor', () => {
    const publicEps = getEntryPointsByPrivilege(PrivilegeLevel.PUBLIC);
    const fns = publicEps.map(ep => ep.fn);
    expect(fns).toContain('get_task');
    expect(fns).toContain('monitor');
  });
});

describe('getKnownAmbiguities', () => {
  it('returns only entries with a severity field', () => {
    const issues = getKnownAmbiguities();
    expect(issues.length).toBeGreaterThan(0);
    issues.forEach(ep => expect(ep.severity).toBeDefined());
  });

  it('surfaces set_admin_address as a CRITICAL finding', () => {
    const issues = getKnownAmbiguities();
    const adminBug = issues.find(ep => ep.fn === 'set_admin_address');
    expect(adminBug).toBeDefined();
    expect(adminBug.severity).toBe('CRITICAL');
  });

  it('surfaces init_yield_strategy as a HIGH severity finding', () => {
    const issues = getKnownAmbiguities();
    const yieldBug = issues.find(ep => ep.fn === 'init_yield_strategy');
    expect(yieldBug).toBeDefined();
    expect(yieldBug.severity).toBe('HIGH');
  });

  it('notes for set_admin_address mention the broken guard', () => {
    const issues = getKnownAmbiguities();
    const adminBug = issues.find(ep => ep.fn === 'set_admin_address');
    expect(adminBug.notes).toMatch(/current_contract_address/);
  });

  it('notes for init_yield_strategy describe the always-false condition', () => {
    const issues = getKnownAmbiguities();
    const yieldBug = issues.find(ep => ep.fn === 'init_yield_strategy');
    expect(yieldBug.notes).toMatch(/always false/);
  });
});

// ── Audit summary ─────────────────────────────────────────────────────────────

describe('generateAuditSummary', () => {
  it('returns a non-empty string', () => {
    const summary = generateAuditSummary();
    expect(typeof summary).toBe('string');
    expect(summary.length).toBeGreaterThan(0);
  });

  it('includes the known issue section', () => {
    const summary = generateAuditSummary();
    expect(summary).toMatch(/KNOWN ISSUES/);
  });

  it('includes CRITICAL finding for set_admin_address', () => {
    const summary = generateAuditSummary();
    expect(summary).toMatch(/CRITICAL/);
    expect(summary).toMatch(/set_admin_address/);
  });

  it('includes all privilege levels', () => {
    const summary = generateAuditSummary();
    expect(summary).toMatch(/PUBLIC/i);
    expect(summary).toMatch(/CREATOR/i);
    expect(summary).toMatch(/ADMIN/i);
    expect(summary).toMatch(/KEEPER/i);
  });
});

// ── Contract-level authorization findings (documented bugs) ───────────────────

describe('Documented authorization findings — for maintainer review', () => {
  /**
   * FINDING 1 (CRITICAL): set_admin_address broken guard
   *
   * Contract: lib.rs:3179
   * The re-assignment guard uses `env.current_contract_address()` as the
   * "caller" to compare against the stored admin.  current_contract_address()
   * always returns the contract's own address, never an external caller's
   * address.  This means the condition `caller != existing_admin` is always
   * true for any external account, allowing any caller to overwrite the admin
   * after the initial bootstrap.
   *
   * Expected behaviour: only the current admin (transaction signer) should be
   * able to change the admin address.
   * Fix: replace env.current_contract_address() with the signed address
   * parameter passed into the function (or add a `new_admin: Address` arg
   * and call new_admin.require_auth()).
   */
  it('FINDING-1 [CRITICAL]: set_admin_address guard is documented as broken', () => {
    const ep = CONTRACT_ENTRY_POINTS.find(e => e.fn === 'set_admin_address');
    expect(ep.severity).toBe('CRITICAL');
    expect(ep.notes).toMatch(/BUG/);
    expect(ep.notes).toMatch(/any external caller/i);
  });

  /**
   * FINDING 2 (HIGH): init_yield_strategy always-pass guard
   *
   * Contract: lib.rs:3265
   * `let admin = env.current_contract_address();`
   * `if admin != env.current_contract_address()` — both sides identical.
   * The condition is always false, so the guard never fires.
   * Any caller can initialise yield strategies with arbitrary protocol
   * addresses and harvest functions.
   *
   * Fix: use a proper admin address comparison (same pattern as
   * set_vrf_oracle_address at lib.rs:2845).
   */
  it('FINDING-2 [HIGH]: init_yield_strategy guard is documented as broken', () => {
    const ep = CONTRACT_ENTRY_POINTS.find(e => e.fn === 'init_yield_strategy');
    expect(ep.severity).toBe('HIGH');
    expect(ep.notes).toMatch(/always/);
  });

  /**
   * FINDING 3 (MEDIUM): pre-admin bootstrap — role/permission assignment open
   *
   * Contract: lib.rs:3981
   * assign_role, revoke_role, grant_permission, revoke_permission all gate
   * on `if let Some(admin) = admin_address`.  If no admin has been set yet
   * (DataKey::AdminAddress is None), the outer block is never entered and any
   * caller can freely assign roles and permissions.
   *
   * This is a bootstrap race condition: if the admin address is not set
   * atomically with contract deployment, a front-runner can claim admin-level
   * permissions before the legitimate admin is established.
   */
  it('FINDING-3 [MEDIUM]: assign_role notes surface the bootstrap gap', () => {
    const ep = CONTRACT_ENTRY_POINTS.find(e => e.fn === 'assign_role');
    expect(ep.notes).toMatch(/any actor/i);
    expect(ep.notes).toMatch(/admin initialization/i);
  });

  /**
   * FINDING 4 (LOW): whitelist empty == open task (semantic ambiguity)
   *
   * Contract: lib.rs:2015
   * execute() checks `if !whitelist.is_empty() && !whitelist.contains(keeper)`.
   * An empty whitelist means any keeper can execute.  Task creators who omit
   * the whitelist field unknowingly publish open tasks.
   *
   * This is valid by design but the semantics are not surfaced to creators
   * at registration time.
   */
  it('FINDING-4 [LOW]: execute whitelist semantics are documented', () => {
    const ep = CONTRACT_ENTRY_POINTS.find(e => e.fn === 'execute');
    expect(ep.notes).toMatch(/empty whitelist/);
    expect(ep.privilege).toBe(PrivilegeLevel.WHITELISTED_KEEPER);
  });

  /**
   * FINDING 5 (LOW): role/permission expiry not enforced
   *
   * Contract: lib.rs:4007
   * RoleAssignment.expires_at is stored but no auth-path checks the field.
   * Expired roles remain valid until manually revoked.
   *
   * This is noted in the delegate_permission registry entry.
   */
  it('FINDING-5 [LOW]: delegation expiry ambiguity is documented', () => {
    const ep = CONTRACT_ENTRY_POINTS.find(e => e.fn === 'delegate_permission');
    expect(ep.notes).toMatch(/expiry/i);
    expect(ep.notes).toMatch(/Expired delegations/i);
  });

  /**
   * FINDING 6 (LOW): fulfill_vrf_request uses address comparison not require_auth
   *
   * Contract: uses env.current_contract_address() comparison instead of
   * caller.require_auth().  This means there is no cryptographic binding that
   * the caller actually controls the configured oracle address — only that the
   * stored oracle address matches.  If the oracle contract is compromised or
   * the oracle config is manipulated (via Finding 1), arbitrary VRF responses
   * can be injected.
   */
  it('FINDING-6 [LOW]: fulfill_vrf_request uses address comparison, not require_auth', () => {
    const ep = CONTRACT_ENTRY_POINTS.find(e => e.fn === 'fulfill_vrf_request');
    expect(ep.notes).toMatch(/no require_auth/);
  });
});

// ── Privilege model sanity checks ─────────────────────────────────────────────

describe('PrivilegeLevel — model sanity', () => {
  it('is a frozen object', () => {
    expect(Object.isFrozen(PrivilegeLevel)).toBe(true);
  });

  it('has at least PUBLIC, CREATOR, KEEPER, ADMIN privilege levels', () => {
    expect(PrivilegeLevel.PUBLIC).toBeDefined();
    expect(PrivilegeLevel.CREATOR).toBeDefined();
    expect(PrivilegeLevel.KEEPER).toBeDefined();
    expect(PrivilegeLevel.ADMIN).toBeDefined();
  });

  it('WHITELISTED_KEEPER is a stricter variant of KEEPER', () => {
    expect(PrivilegeLevel.WHITELISTED_KEEPER).toBeDefined();
    expect(PrivilegeLevel.WHITELISTED_KEEPER).not.toBe(PrivilegeLevel.KEEPER);
  });
});
