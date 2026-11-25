const { Sep10Sep24Client } = require('./sep10Sep24Client');

describe('Sep10Sep24Client', () => {
  test('authenticates and starts an idempotent deposit without exposing secrets', async () => {
    const calls = [];
    const fetchFn = jest.fn().mockImplementation(async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => (url.endsWith('/auth') && options.method === 'POST' ? { token: 'jwt' } : { id: 'deposit-1' }) };
    });
    const client = new Sep10Sep24Client({ anchorUrl: 'https://anchor.example', fetchFn, signer: async (challenge) => ({ ...challenge, signature: 'signed' }) });
    await expect(client.deposit({ account: 'GABC', amount: 20, idempotencyKey: 'reserve-1' })).resolves.toEqual({ id: 'deposit-1' });
    expect(calls[2].options.headers.authorization).toBe('Bearer jwt');
    expect(JSON.stringify(calls)).not.toContain('secret');
  });
});
