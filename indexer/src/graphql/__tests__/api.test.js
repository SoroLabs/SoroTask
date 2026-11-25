const assert = require('node:assert/strict');
const test = require('node:test');
const { ROLES, enforceRole, createContext, isOwner } = require('../auth');

test('GraphQL Auth Module - should enforce roles correctly', () => {
  // Admin context
  const adminCtx = { user: { role: ROLES.ADMIN } };
  assert.doesNotThrow(() => enforceRole(adminCtx, ROLES.OPERATOR));
  assert.doesNotThrow(() => enforceRole(adminCtx, ROLES.USER));

  // User context
  const userCtx = { user: { role: ROLES.USER } };
  assert.throws(
    () => enforceRole(userCtx, ROLES.ADMIN),
    /Unauthorized: Requires ADMIN access level\./
  );
  assert.throws(
    () => enforceRole(userCtx, ROLES.OPERATOR),
    /Unauthorized: Requires OPERATOR access level\./
  );
  assert.doesNotThrow(() => enforceRole(userCtx, ROLES.USER));
});

test('GraphQL Auth Module - should identify owner correctly', () => {
  const ctx = { user: { address: 'G_TEST_ADDRESS' } };
  assert.equal(isOwner(ctx, 'G_TEST_ADDRESS'), true);
  assert.equal(isOwner(ctx, 'G_OTHER_ADDRESS'), false);
});

test('GraphQL Auth Module - should create context from token', () => {
  // Test context without token
  const emptyCtx = createContext({ req: { headers: {} } });
  assert.equal(emptyCtx.user.role, ROLES.ANONYMOUS);
});
