jest.mock('./sentry', () => ({
  addSentryBreadcrumb: jest.fn(),
}));

import { addSentryBreadcrumb } from './sentry';
import {
  captureWalletBreadcrumb,
  captureTransactionBreadcrumb,
  BreadcrumbCategory,
} from './breadcrumbs';

const mockedAddBreadcrumb = addSentryBreadcrumb as jest.MockedFunction<
  typeof addSentryBreadcrumb
>;

describe('breadcrumbs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('captures a wallet connection breadcrumb with the wallet category', () => {
    captureWalletBreadcrumb('connect', { address: 'G…abc' });

    expect(mockedAddBreadcrumb).toHaveBeenCalledWith(
      BreadcrumbCategory.Wallet,
      'wallet.connect',
      { address: 'G…abc' },
      'info',
    );
  });

  it('captures transaction lifecycle breadcrumbs across the staged flow', () => {
    captureTransactionBreadcrumb('awaiting_signature');
    captureTransactionBreadcrumb('submitting');
    captureTransactionBreadcrumb('confirmed_on_ledger', 'txhash-123', { network: 'testnet' });

    expect(mockedAddBreadcrumb).toHaveBeenNthCalledWith(1, 'transaction', 'transaction.awaiting_signature', {}, 'info');
    expect(mockedAddBreadcrumb).toHaveBeenNthCalledWith(2, 'transaction', 'transaction.submitting', {}, 'info');
    expect(mockedAddBreadcrumb).toHaveBeenNthCalledWith(
      3,
      'transaction',
      'transaction.confirmed_on_ledger',
      { txHash: 'txhash-123', network: 'testnet' },
      'info',
    );
  });

  it('marks a failed transaction breadcrumb at error level', () => {
    captureTransactionBreadcrumb('failed', undefined, { message: 'user rejected' });

    expect(mockedAddBreadcrumb).toHaveBeenCalledWith(
      BreadcrumbCategory.Transaction,
      'transaction.failed',
      { message: 'user rejected' },
      'error',
    );
  });
});