import { act, renderHook } from '@testing-library/react';
import {
  useSorobanTx,
  UserRejectedError,
  TxTimeoutError,
  TxOnChainError,
  type TxPhaseCallbacks,
} from '../use-soroban-tx';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Builds an executor that resolves through every phase with controllable timing. */
function makeExecutor(opts: {
  hash?: string;
  /** If provided, the executor throws this error instead of succeeding. */
  throws?: unknown;
  /** Ref where onSubmitting / onPending callbacks will be stored for manual calling. */
  captureCallbacks?: { current: TxPhaseCallbacks | null };
}) {
  return jest.fn(async (callbacks: TxPhaseCallbacks): Promise<string> => {
    if (opts.captureCallbacks) {
      opts.captureCallbacks.current = callbacks;
    }
    if (opts.throws !== undefined) {
      throw opts.throws;
    }
    callbacks.onSubmitting();
    const hash = opts.hash ?? 'abc123deadbeef00abc123deadbeef00abc123deadbeef00abc123deadbeef00';
    callbacks.onPending(hash);
    return hash;
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useSorobanTx', () => {
  it('starts in idle state', () => {
    const { result } = renderHook(() => useSorobanTx());
    expect(result.current.state.status).toBe('idle');
  });

  it('transitions to signing immediately on execute()', async () => {
    const { result } = renderHook(() => useSorobanTx());

    let resolveExecutor!: (hash: string) => void;
    const suspendedExecutor = jest.fn(
      (_callbacks: TxPhaseCallbacks): Promise<string> =>
        new Promise((resolve) => {
          resolveExecutor = resolve;
        }),
    );

    act(() => {
      result.current.execute(suspendedExecutor);
    });

    expect(result.current.state.status).toBe('signing');

    // Resolve to clean up
    await act(async () => {
      resolveExecutor('hash');
    });
  });

  it('transitions to submitting when onSubmitting() is called', async () => {
    const { result } = renderHook(() => useSorobanTx());
    const captureCallbacks = { current: null as TxPhaseCallbacks | null };
    const executor = makeExecutor({ captureCallbacks });

    let resolveExecutor!: (hash: string) => void;
    const controlledExecutor = jest.fn(async (callbacks: TxPhaseCallbacks): Promise<string> => {
      captureCallbacks.current = callbacks;
      return new Promise((resolve) => {
        resolveExecutor = resolve;
      });
    });

    act(() => { result.current.execute(controlledExecutor); });
    expect(result.current.state.status).toBe('signing');

    act(() => { captureCallbacks.current!.onSubmitting(); });
    expect(result.current.state.status).toBe('submitting');

    await act(async () => { resolveExecutor('hash'); });
  });

  it('transitions to pending with hash when onPending() is called', async () => {
    const { result } = renderHook(() => useSorobanTx());
    const captureCallbacks = { current: null as TxPhaseCallbacks | null };

    let resolveExecutor!: (hash: string) => void;
    const controlledExecutor = jest.fn(async (callbacks: TxPhaseCallbacks): Promise<string> => {
      captureCallbacks.current = callbacks;
      return new Promise((resolve) => { resolveExecutor = resolve; });
    });

    act(() => { result.current.execute(controlledExecutor); });
    act(() => { captureCallbacks.current!.onPending('testhash1234'); });

    expect(result.current.state.status).toBe('pending');
    if (result.current.state.status === 'pending') {
      expect(result.current.state.hash).toBe('testhash1234');
    }

    await act(async () => { resolveExecutor('testhash1234'); });
  });

  it('reaches success state with hash on resolved executor', async () => {
    const { result } = renderHook(() => useSorobanTx());
    const HASH = 'deadbeef00112233deadbeef00112233deadbeef00112233deadbeef00112233';
    const executor = makeExecutor({ hash: HASH });

    await act(async () => { await result.current.execute(executor); });

    expect(result.current.state.status).toBe('success');
    if (result.current.state.status === 'success') {
      expect(result.current.state.hash).toBe(HASH);
    }
  });

  it('maps UserRejectedError to reason=user_rejected', async () => {
    const { result } = renderHook(() => useSorobanTx());
    const executor = makeExecutor({ throws: new UserRejectedError('User rejected') });

    await act(async () => { await result.current.execute(executor); });

    expect(result.current.state.status).toBe('error');
    if (result.current.state.status === 'error') {
      expect(result.current.state.reason).toBe('user_rejected');
      expect(result.current.state.message).toBe('User rejected');
    }
  });

  it('maps TxOnChainError to reason=transaction_failed', async () => {
    const { result } = renderHook(() => useSorobanTx());
    const executor = makeExecutor({ throws: new TxOnChainError('reverted') });

    await act(async () => { await result.current.execute(executor); });

    expect(result.current.state.status).toBe('error');
    if (result.current.state.status === 'error') {
      expect(result.current.state.reason).toBe('transaction_failed');
    }
  });

  it('maps TxTimeoutError to reason=timeout', async () => {
    const { result } = renderHook(() => useSorobanTx());
    const executor = makeExecutor({ throws: new TxTimeoutError('timed out') });

    await act(async () => { await result.current.execute(executor); });

    expect(result.current.state.status).toBe('error');
    if (result.current.state.status === 'error') {
      expect(result.current.state.reason).toBe('timeout');
    }
  });

  it('maps generic Error to reason=submission_failed', async () => {
    const { result } = renderHook(() => useSorobanTx());
    const executor = makeExecutor({ throws: new Error('network error') });

    await act(async () => { await result.current.execute(executor); });

    expect(result.current.state.status).toBe('error');
    if (result.current.state.status === 'error') {
      expect(result.current.state.reason).toBe('submission_failed');
      expect(result.current.state.message).toBe('network error');
    }
  });

  it('reset() from success returns to idle', async () => {
    const { result } = renderHook(() => useSorobanTx());
    const executor = makeExecutor({});

    await act(async () => { await result.current.execute(executor); });
    expect(result.current.state.status).toBe('success');

    act(() => { result.current.reset(); });
    expect(result.current.state.status).toBe('idle');
  });

  it('reset() from error returns to idle', async () => {
    const { result } = renderHook(() => useSorobanTx());
    const executor = makeExecutor({ throws: new Error('oops') });

    await act(async () => { await result.current.execute(executor); });
    expect(result.current.state.status).toBe('error');

    act(() => { result.current.reset(); });
    expect(result.current.state.status).toBe('idle');
  });

  it('reset() during in-flight is a no-op', async () => {
    const { result } = renderHook(() => useSorobanTx());
    let resolveExecutor!: (hash: string) => void;
    const suspendedExecutor = jest.fn(
      (_callbacks: TxPhaseCallbacks): Promise<string> =>
        new Promise((resolve) => { resolveExecutor = resolve; }),
    );

    act(() => { result.current.execute(suspendedExecutor); });
    expect(result.current.state.status).toBe('signing');

    act(() => { result.current.reset(); });
    // Still signing — reset was ignored
    expect(result.current.state.status).toBe('signing');

    await act(async () => { resolveExecutor('hash'); });
  });

  it('second execute() while in-flight is a no-op', async () => {
    const { result } = renderHook(() => useSorobanTx());
    let resolveFirst!: (hash: string) => void;
    const firstExecutor = jest.fn(
      (_callbacks: TxPhaseCallbacks): Promise<string> =>
        new Promise((resolve) => { resolveFirst = resolve; }),
    );
    const secondExecutor = jest.fn(async (_callbacks: TxPhaseCallbacks): Promise<string> => 'second');

    act(() => { result.current.execute(firstExecutor); });
    expect(result.current.state.status).toBe('signing');

    await act(async () => { await result.current.execute(secondExecutor); });
    expect(secondExecutor).not.toHaveBeenCalled();

    await act(async () => { resolveFirst('first_hash'); });
    expect(result.current.state.status).toBe('success');
  });
});
