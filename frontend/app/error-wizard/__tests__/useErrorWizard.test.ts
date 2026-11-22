import { renderHook, act } from '@testing-library/react';
import { useErrorWizard, generateSteps } from '../../error-wizard/useErrorWizard';
import type { FailureLog } from '../../error-wizard/types';

const makeLog = (errorCode: string, errorMessage = 'error', ctx: FailureLog['context'] = {}): FailureLog => ({
  taskId: 'task-1',
  timestamp: new Date().toISOString(),
  errorCode,
  errorMessage,
  context: ctx,
});

// ---------------------------------------------------------------------------
// generateSteps
// ---------------------------------------------------------------------------

describe('generateSteps', () => {
  it('returns empty array for empty log list', () => {
    expect(generateSteps([])).toHaveLength(0);
  });

  it('deduplicates logs with the same error category', () => {
    const logs = [makeLog('INSUFFICIENT_GAS'), makeLog('INSUFFICIENT_GAS', 'second')];
    expect(generateSteps(logs)).toHaveLength(1);
  });

  it('creates one step per unique category', () => {
    expect(generateSteps([makeLog('INSUFFICIENT_GAS'), makeLog('INVALID_ARGS', 'inv')])).toHaveLength(2);
  });

  it('INSUFFICIENT_GAS step has increase_gas action with patch using gasBudget × 1.5', () => {
    const steps = generateSteps([makeLog('INSUFFICIENT_GAS', 'oog', { gasBudget: 50000 })]);
    expect(steps[0].actions[0].type).toBe('increase_gas');
    expect(steps[0].actions[0].patch?.field).toBe('gasBudget');
    expect(steps[0].actions[0].patch?.value).toBe(75000);
  });

  it('INSUFFICIENT_GAS defaults to 100000 when gasBudget absent', () => {
    const steps = generateSteps([makeLog('INSUFFICIENT_GAS')]);
    expect(steps[0].actions[0].patch?.value).toBe(100000);
  });

  it('INSUFFICIENT_BALANCE step has top_up_balance action without patch', () => {
    const steps = generateSteps([makeLog('TX_INSUFFICIENT_BALANCE', 'insufficient balance')]);
    expect(steps[0].actions[0].type).toBe('top_up_balance');
    expect(steps[0].actions[0].patch).toBeUndefined();
  });

  it('token allowance failures produce a wallet-review approval action', () => {
    const steps = generateSteps([
      makeLog(
        'INSUFFICIENT_ALLOWANCE',
        'allowance too low',
        { tokenAddress: 'CTOKEN', spenderAddress: 'CTASK' },
      ),
    ]);

    expect(steps[0].category).toBe('TOKEN_APPROVAL_REQUIRED');
    expect(steps[0].actions[0].type).toBe('approve_token');
    expect(steps[0].actions[0].description).toContain('CTOKEN');
    expect(steps[0].actions[0].description).toContain('CTASK');
  });

  it('BAD_AUTH produces reconnect_wallet action', () => {
    const steps = generateSteps([makeLog('TX_BAD_AUTH', 'bad auth')]);
    expect(steps[0].actions[0].type).toBe('reconnect_wallet');
  });

  it('WRONG_NETWORK produces switch_network action', () => {
    const steps = generateSteps([makeLog('WRONG_NETWORK', 'network mismatch')]);
    expect(steps[0].actions[0].type).toBe('switch_network');
  });

  it('INVALID_ARGS with context produces fix_contract_address and fix_function_name', () => {
    const steps = generateSteps([
      makeLog('INVALID_ARGS', 'inv', { contractAddress: 'CABC', functionName: 'harvest' }),
    ]);
    const types = steps[0].actions.map((a) => a.type);
    expect(types).toContain('fix_contract_address');
    expect(types).toContain('fix_function_name');
  });

  it('STATE_EXPIRED produces fix_interval patch on interval field', () => {
    const steps = generateSteps([makeLog('STATE_EXPIRED', 'entry expired')]);
    expect(steps[0].actions[0].type).toBe('fix_interval');
    expect(steps[0].actions[0].patch?.field).toBe('interval');
  });

  it.each(['TX_BAD_SEQ', 'TIMEOUT', 'RATE_LIMITED', 'SERVER_ERROR'])(
    '%s produces wait_and_retry action',
    (code) => {
      const steps = generateSteps([makeLog(code, code)]);
      expect(steps[0].actions[0].type).toBe('wait_and_retry');
    },
  );

  it('unknown error code produces contact_support action', () => {
    const steps = generateSteps([makeLog('TOTALLY_UNKNOWN_CODE', 'weird')]);
    expect(steps[0].actions[0].type).toBe('contact_support');
  });

  it('every step starts with status pending', () => {
    const steps = generateSteps([makeLog('INSUFFICIENT_GAS'), makeLog('INVALID_ARGS', 'inv')]);
    expect(steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('step ids are unique', () => {
    const steps = generateSteps([makeLog('INSUFFICIENT_GAS'), makeLog('INVALID_ARGS', 'inv')]);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
  });
});

// ---------------------------------------------------------------------------
// useErrorWizard
// ---------------------------------------------------------------------------

describe('useErrorWizard', () => {
  it('starts idle with no steps and null currentStep', () => {
    const { result } = renderHook(() => useErrorWizard());
    expect(result.current.phase).toBe('idle');
    expect(result.current.steps).toHaveLength(0);
    expect(result.current.currentStep).toBeNull();
  });

  it('transitions to ready after analyze with actionable logs', () => {
    const { result } = renderHook(() => useErrorWizard());
    act(() => result.current.analyze([makeLog('INSUFFICIENT_GAS')]));
    expect(result.current.phase).toBe('ready');
    expect(result.current.steps.length).toBeGreaterThan(0);
  });

  it('transitions directly to complete when no steps are generated', () => {
    const { result } = renderHook(() => useErrorWizard());
    act(() => result.current.analyze([]));
    expect(result.current.phase).toBe('complete');
  });

  it('currentStep is the first step after analyze', () => {
    const { result } = renderHook(() => useErrorWizard());
    act(() => result.current.analyze([makeLog('INSUFFICIENT_GAS')]));
    expect(result.current.currentStep?.category).toBe('INSUFFICIENT_GAS');
    expect(result.current.currentIndex).toBe(0);
  });

  it('applyStep marks step applied, advances index, stores patch', () => {
    const { result } = renderHook(() => useErrorWizard());
    act(() => result.current.analyze([makeLog('INSUFFICIENT_GAS'), makeLog('INVALID_ARGS', 'inv')]));
    act(() => result.current.applyStep({ field: 'gasBalance', value: 100000 }));
    expect(result.current.steps[0].status).toBe('applied');
    expect(result.current.currentIndex).toBe(1);
    expect(result.current.appliedPatches['gasBalance']).toBe(100000);
  });

  it('applyStep without patch does not pollute appliedPatches', () => {
    const { result } = renderHook(() => useErrorWizard());
    act(() => result.current.analyze([makeLog('TX_INSUFFICIENT_BALANCE', 'balance')]));
    act(() => result.current.applyStep());
    expect(Object.keys(result.current.appliedPatches)).toHaveLength(0);
  });

  it('skipStep marks step skipped and advances', () => {
    const { result } = renderHook(() => useErrorWizard());
    act(() => result.current.analyze([makeLog('INSUFFICIENT_GAS'), makeLog('INVALID_ARGS', 'inv')]));
    act(() => result.current.skipStep());
    expect(result.current.steps[0].status).toBe('skipped');
    expect(result.current.currentIndex).toBe(1);
  });

  it('completing all steps transitions to complete', () => {
    const { result } = renderHook(() => useErrorWizard());
    act(() => result.current.analyze([makeLog('INSUFFICIENT_GAS')]));
    act(() => result.current.applyStep());
    expect(result.current.phase).toBe('complete');
  });

  it('reset restores idle state', () => {
    const { result } = renderHook(() => useErrorWizard());
    act(() => result.current.analyze([makeLog('INSUFFICIENT_GAS')]));
    act(() => result.current.applyStep({ field: 'gasBalance', value: 1 }));
    act(() => result.current.reset());
    expect(result.current.phase).toBe('idle');
    expect(result.current.steps).toHaveLength(0);
    expect(result.current.appliedPatches).toEqual({});
    expect(result.current.error).toBeNull();
  });

  it('accumulates patches from multiple applied steps', () => {
    const { result } = renderHook(() => useErrorWizard());
    act(() => result.current.analyze([
      makeLog('INSUFFICIENT_GAS'),
      makeLog('INVALID_ARGS', 'inv', { contractAddress: 'CABC' }),
    ]));
    act(() => result.current.applyStep({ field: 'gasBalance', value: 100 }));
    act(() => result.current.applyStep({ field: 'contractAddress', value: 'CABC' }));
    expect(result.current.appliedPatches).toEqual({ gasBalance: 100, contractAddress: 'CABC' });
    expect(result.current.phase).toBe('complete');
  });
});
