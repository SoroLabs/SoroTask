const { VaultLeaseManager } = require('./vaultLeaseManager');

function response(body, ok = true) { return { ok, status: ok ? 200 : 500, json: async () => body }; }

describe('VaultLeaseManager', () => {
  test('authenticates with AppRole and renews before the lease expires', async () => {
    const calls = [];
    const manager = new VaultLeaseManager({ primary: 'https://vault', roleId: 'role', secretId: 'secret', fetch: async (url) => { calls.push(url); return response({ auth: { client_token: 't', lease_duration: 100 } }); } });
    await manager.authenticate();
    expect(manager.getToken()).toBe('t');
    expect(manager.scheduleRenewal()).toBe(75000);
    expect(calls[0]).toContain('auth/approle/login');
    manager.stop();
  });

  test('fails over to the secondary cluster for secret reads', async () => {
    const calls = [];
    const manager = new VaultLeaseManager({ primary: 'https://primary', secondary: 'https://secondary', roleId: 'r', secretId: 's', fetch: async (url) => { calls.push(url); if (url.includes('primary')) return response({}, false); return response({ auth: { client_token: 't', lease_duration: 100 }, data: { data: { key: 'value' } } }); } });
    await manager.authenticate();
    await expect(manager.read('keeper/signing')).resolves.toHaveProperty('data.data.key', 'value');
    expect(calls.some((url) => url.includes('secondary'))).toBe(true);
  });
});
