const { MempoolTransactionSniffer } = require('./mempoolSniffer');

describe('MempoolTransactionSniffer', () => {
  test('detects conflicting pending transactions for the same source and sequence', async () => {
    const conflicts = [];
    const sniffer = new MempoolTransactionSniffer({ rpcUrl: 'https://rpc', fetch: async () => ({ ok: true, json: async () => ({ result: { transactions: [{ source: 'G', sequence: '4' }, { source: 'G', sequence: '4' }] } }) }), onConflict: async (conflict) => conflicts.push(conflict) });
    await expect(sniffer.scanOnce()).resolves.toMatchObject({ conflicts: 1 });
    expect(conflicts[0].action).toBe('reorder-or-cancel');
    expect(sniffer.metrics.conflictsDetected).toBe(1);
  });
});
