const { buildSecurityStack } = require('../src/keeperSecurity');

describe('Keeper security stack', () => {
  let stack;

  beforeEach(() => {
    stack = buildSecurityStack({ storageDir: __dirname + '/data', auditFile: __dirname + '/data/audit.log' });
  });

  test('creates keys in HSM and lists them', async () => {
    const k = await stack.keyManager.createKey({ keyId: 'testkey' });
    expect(k.keyId).toBe('testkey');
    const list = await stack.keyManager.listKeys();
    expect(list.find(l => l.keyId === 'testkey')).toBeTruthy();
  });

  test('permissions grant allows signing and revocation blocks it', async () => {
    await stack.keyManager.createKey({ keyId: 'k1' });
    const grant = stack.permissions.createGrant({ subject: 'alice', resource: 'k1', actions: ['sign'], scope: 'tx' });
    const { signature } = await stack.signing.sign({ requester: 'alice', keyId: 'k1', payload: 'hello', purpose: 'tx' });
    expect(signature).toBeTruthy();

    // revoke and assert unauthorized
    stack.permissions.revokeGrant(grant.grantId);
    await expect(stack.signing.sign({ requester: 'alice', keyId: 'k1', payload: 'hello', purpose: 'tx' })).rejects.toThrow(/Unauthorized/);
  });

  test('audit log records events', () => {
    const tail = stack.audit.tail(10);
    expect(Array.isArray(tail)).toBeTruthy();
    // create a new grant and ensure audit recorded
    const g = stack.permissions.createGrant({ subject: 'bob', resource: 'k1' });
    const tail2 = stack.audit.tail(5);
    expect(tail2.some(e => e.eventType === 'permission.grant.create' && e.details.grantId === g.grantId)).toBeTruthy();
  });
});
