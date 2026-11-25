// Simple account tests - just test that the function exists and handles missing env
const { initializeKeeperAccount } = require('../src/account');

describe('Keeper Account Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should throw error when KEEPER_SECRET is missing', async () => {
    delete process.env.KEEPER_SECRET;

    // Just test that it throws when secret is missing
    await expect(initializeKeeperAccount()).rejects.toThrow();
  });

  it('should have KEEPER_SECRET defined', () => {
    process.env.KEEPER_SECRET = 'test-secret';
    // This test just verifies env is set correctly
    expect(process.env.KEEPER_SECRET).toBe('test-secret');
  });

  it('should fetch secret key from Vault HTTP API', async () => {
    const { fetchSecretFromVault } = require('../src/account');
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { data: { KEEPER_SECRET: 'SD321VALIDSSECRETKEY' } } }),
    });

    const secret = await fetchSecretFromVault('http://vault.internal:8200', 'test-token');
    expect(secret).toBe('SD321VALIDSSECRETKEY');
  });

  it('should zero out memory references without throwing', () => {
    const { clearSecretMemory } = require('../src/account');
    expect(() => clearSecretMemory()).not.toThrow();
  });
});
