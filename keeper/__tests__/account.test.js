const { initializeKeeperAccount } = require('../src/account');
const { Server, Keypair } = require('soroban-client');

jest.mock('soroban-client', () => {
    const original = jest.requireActual('soroban-client');
    return {
        ...original,
        Server: jest.fn(),
        Keypair: {
            fromSecret: jest.fn()
        }
    };
});

describe('Keeper Account Module', () => {
    const mockSecret = 'SAZMBLI37L2O56N5LJS5X4K5LJS5X4K5LJS5X4K5LJS5X4K5LJS5X4K';
    const mockPublicKey = 'GDRS6QYI6N5LJS5X4K5LJS5X4K5LJS5X4K5LJS5X4K5LJS5X4K5LJS5';

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.KEEPER_SECRET = mockSecret;
        process.env.MIN_KEEPER_BALANCE_XLM = '1.0';
        delete process.env.HALT_ON_LOW_BALANCE;

        Keypair.fromSecret.mockReturnValue({
            publicKey: () => mockPublicKey
        });
    });

    it('should successfully load and validate a funded account', async () => {
        const mockAccount = {
            accountId: () => mockPublicKey,
            sequenceNumber: () => '123',
            balances: [
                { asset_type: 'native', balance: '10.5' }
            ]
        };

        Server.prototype.getAccount = jest.fn().mockResolvedValue(mockAccount);

        const result = await initializeKeeperAccount();

        expect(result.keypair.publicKey()).toBe(mockPublicKey);
        expect(result.accountResponse.balances[0].balance).toBe('10.5');
    });

    it('should throw an error if KEEPER_SECRET is missing', async () => {
        delete process.env.KEEPER_SECRET;
        await expect(initializeKeeperAccount()).rejects.toThrow('KEEPER_SECRET environment variable is not defined');
    });

    it('should throw 404 error with clear message when account not found', async () => {
        const error = new Error('Not Found');
        error.response = { status: 404 };
        Server.prototype.getAccount = jest.fn().mockRejectedValue(error);

        await expect(initializeKeeperAccount()).rejects.toThrow(/not found on-chain/);
    });

    it('should warn but not halt if balance is below minimum', async () => {
        const mockAccount = {
            accountId: () => mockPublicKey,
            sequenceNumber: () => '123',
            balances: [
                { asset_type: 'native', balance: '0.5' }
            ]
        };
        Server.prototype.getAccount = jest.fn().mockResolvedValue(mockAccount);

        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });

        await initializeKeeperAccount();

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('is below the recommended minimum'));
        consoleSpy.mockRestore();
    });

    it('should halt if HALT_ON_LOW_BALANCE is true and balance is low', async () => {
        process.env.HALT_ON_LOW_BALANCE = 'true';
        const mockAccount = {
            accountId: () => mockPublicKey,
            sequenceNumber: () => '123',
            balances: [
                { asset_type: 'native', balance: '0.5' }
            ]
        };
        Server.prototype.getAccount = jest.fn().mockResolvedValue(mockAccount);

        await expect(initializeKeeperAccount()).rejects.toThrow(/HALTING: Keeper balance/);
    });
});
