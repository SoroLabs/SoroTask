import { useCallback } from 'react';
import { TransactionToastHandler } from '@/lib/transaction-toast';

interface ExecuteTxParams<T> {
  title?: string;
  network?: 'public' | 'testnet' | 'futurenet';
  signAndSubmit: (
    updateProgress: (state: 'SUBMITTING') => void,
  ) => Promise<{ txHash: string; result: T }>;
}

export function useWeb3TransactionToast() {
  const executeWithToast = useCallback(
    async <T>({
      title = 'Contract Interaction',
      network = 'testnet',
      signAndSubmit,
    }: ExecuteTxParams<T>): Promise<T | null> => {
      const toastHandler = TransactionToastHandler.start(title, network);

      try {
        const { txHash, result } = await signAndSubmit(() => {
          toastHandler.updateToSubmitting();
        });

        toastHandler.confirm(txHash);
        return result;
      } catch (error: any) {
        toastHandler.fail(error);
        return null;
      }
    },
    [],
  );

  return { executeWithToast };
}