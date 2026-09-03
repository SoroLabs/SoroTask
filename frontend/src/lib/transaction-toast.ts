import { toast } from 'sonner';
import { captureTransactionBreadcrumb } from './errors/breadcrumbs';

export type TxLifecycleState =
  | 'AWAITING_SIGNATURE'
  | 'SUBMITTING'
  | 'CONFIRMED'
  | 'FAILED';

export interface TxToastOptions {
  network?: 'public' | 'testnet' | 'futurenet';
  onSuccess?: (txHash: string) => void;
  onError?: (error: Error) => void;
}

const STELLAR_EXPERT_BASE_URL: Record<string, string> = {
  public: 'https://stellar.expert/explorer/public/tx',
  testnet: 'https://stellar.expert/explorer/testnet/tx',
  futurenet: 'https://stellar.expert/explorer/futurenet/tx',
};

export class TransactionToastHandler {
  private toastId: string | number;
  private network: 'public' | 'testnet' | 'futurenet';

  constructor(toastId: string | number, network: 'public' | 'testnet' | 'futurenet' = 'testnet') {
    this.toastId = toastId;
    this.network = network;
  }

  /**
   * Initializes transaction toast tracking in 'Awaiting Signature' state
   */
  static start(
    title: string = 'Transaction Initiated',
    network: 'public' | 'testnet' | 'futurenet' = 'testnet',
  ): TransactionToastHandler {
    const toastId = toast.loading(`${title}: Awaiting Wallet Signature...`, {
      description: 'Please review and confirm the transaction in your Stellar wallet extension.',
    });
    return new TransactionToastHandler(toastId, network);
  }

  /**
   * Updates state to 'Submitting to Soroban network'
   */
  updateToSubmitting(): void {
    captureTransactionBreadcrumb('submitting');
    toast.loading('Submitting to Soroban Ledger...', {
      id: this.toastId,
      description: 'Transaction signed. Broadcaster submitting to network consensus...',
    });
  }

  /**
   * Finalizes toast with Success state and link to Stellar Expert explorer
   */
  confirm(txHash: string): void {
    captureTransactionBreadcrumb('confirmed_on_ledger', txHash, { network: this.network });
    const explorerUrl = `${STELLAR_EXPERT_BASE_URL[this.network]}/${txHash}`;

    toast.success('Transaction Confirmed on Ledger!', {
      id: this.toastId,
      description: 'Your transaction has been validated and recorded on-chain.',
      action: {
        label: 'View on Explorer',
        onClick: () => window.open(explorerUrl, '_blank', 'noopener,noreferrer'),
      },
      duration: 8000,
    });
  }

  /**
   * Updates toast to Failure state
   */
  fail(error: Error | string): void {
    captureTransactionBreadcrumb('failed', undefined, {
      message: typeof error === 'string' ? error : (error.message ?? 'Transaction rejected or failed.'),
    });
    const message = typeof error === 'string' ? error : error.message || 'Transaction rejected or failed.';

    toast.error('Transaction Failed', {
      id: this.toastId,
      description: message,
      duration: 6000,
    });
  }
}