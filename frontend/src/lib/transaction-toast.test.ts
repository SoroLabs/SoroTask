import { toast } from 'sonner';
import { TransactionToastHandler } from './transaction-toast';

jest.mock('sonner', () => ({
  toast: {
    loading: jest.fn().mockReturnValue('toast-id-123'),
    success: jest.fn(),
    error: jest.fn(),
  },
}));

describe('TransactionToastHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize toast in awaiting signature state', () => {
    const handler = TransactionToastHandler.start('Transfer XLM', 'testnet');

    expect(toast.loading).toHaveBeenCalledWith(
      'Transfer XLM: Awaiting Wallet Signature...',
      expect.objectContaining({
        description: expect.stringContaining('wallet extension'),
      }),
    );
    expect(handler).toBeInstanceOf(TransactionToastHandler);
  });

  it('should update toast state to submitting', () => {
    const handler = TransactionToastHandler.start('Transfer XLM', 'testnet');
    handler.updateToSubmitting();

    expect(toast.loading).toHaveBeenCalledWith(
      'Submitting to Soroban Ledger...',
      expect.objectContaining({ id: 'toast-id-123' }),
    );
  });

  it('should finalize toast on confirmation with Stellar Expert link', () => {
    const handler = TransactionToastHandler.start('Transfer XLM', 'testnet');
    handler.confirm('abc123txhash');

    expect(toast.success).toHaveBeenCalledWith(
      'Transaction Confirmed on Ledger!',
      expect.objectContaining({
        id: 'toast-id-123',
        action: expect.objectContaining({
          label: 'View on Explorer',
        }),
      }),
    );
  });
});