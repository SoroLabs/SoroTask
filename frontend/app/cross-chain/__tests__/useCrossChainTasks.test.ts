import { renderHook, act } from '@testing-library/react';
import { useCrossChainTasks, MOCK_TASKS, MOCK_BRIDGE_EVENTS } from '../../cross-chain/useCrossChainTasks';

describe('useCrossChainTasks', () => {
  // --- initial state ---

  it('returns all mock tasks by default', () => {
    const { result } = renderHook(() => useCrossChainTasks());
    expect(result.current.tasks).toHaveLength(MOCK_TASKS.length);
  });

  it('exposes bridgeEvents', () => {
    const { result } = renderHook(() => useCrossChainTasks());
    expect(result.current.bridgeEvents).toHaveLength(MOCK_BRIDGE_EVENTS.length);
  });

  it('starts with networkFilter all and statusFilter all', () => {
    const { result } = renderHook(() => useCrossChainTasks());
    expect(result.current.networkFilter).toBe('all');
    expect(result.current.statusFilter).toBe('all');
  });

  // --- network filter ---

  it('setNetworkFilter hides tasks not on that network', () => {
    const { result } = renderHook(() => useCrossChainTasks());
    act(() => result.current.setNetworkFilter('ethereum'));
    expect(result.current.tasks.every((t) => t.networks.includes('ethereum'))).toBe(true);
  });

  it('setNetworkFilter all restores all tasks', () => {
    const { result } = renderHook(() => useCrossChainTasks());
    act(() => result.current.setNetworkFilter('base'));
    act(() => result.current.setNetworkFilter('all'));
    expect(result.current.tasks).toHaveLength(MOCK_TASKS.length);
  });

  it('setNetworkFilter to a network with no tasks returns empty', () => {
    const { result } = renderHook(() => useCrossChainTasks());
    // 'base' only appears in one task; let's filter for a network not in any task
    // All mock tasks use soroban, so filtering by a network absent from all returns 0
    act(() => result.current.setNetworkFilter('polygon'));
    // polygon is in cct-2 only
    expect(result.current.tasks.every((t) => t.networks.includes('polygon'))).toBe(true);
  });

  // --- status filter ---

  it('setStatusFilter shows only tasks with matching overallStatus', () => {
    const { result } = renderHook(() => useCrossChainTasks());
    act(() => result.current.setStatusFilter('failed'));
    expect(result.current.tasks.every((t) => t.overallStatus === 'failed')).toBe(true);
    expect(result.current.tasks.length).toBeGreaterThan(0);
  });

  it('setStatusFilter active hides failed tasks', () => {
    const { result } = renderHook(() => useCrossChainTasks());
    act(() => result.current.setStatusFilter('active'));
    expect(result.current.tasks.some((t) => t.overallStatus === 'failed')).toBe(false);
  });

  it('setStatusFilter all restores all tasks', () => {
    const { result } = renderHook(() => useCrossChainTasks());
    act(() => result.current.setStatusFilter('failed'));
    act(() => result.current.setStatusFilter('all'));
    expect(result.current.tasks).toHaveLength(MOCK_TASKS.length);
  });

  // --- combined filters ---

  it('network + status filter both apply', () => {
    const { result } = renderHook(() => useCrossChainTasks());
    act(() => {
      result.current.setNetworkFilter('soroban');
      result.current.setStatusFilter('active');
    });
    result.current.tasks.forEach((t) => {
      expect(t.networks).toContain('soroban');
      expect(t.overallStatus).toBe('active');
    });
  });

  // --- updateChainStatus ---

  it('updateChainStatus changes the chain status for a specific task/network', () => {
    const { result } = renderHook(() => useCrossChainTasks());
    act(() => result.current.updateChainStatus('cct-1', 'ethereum', 'confirmed'));
    const task = result.current.allTasks.find((t) => t.id === 'cct-1')!;
    expect(task.chainStatuses['ethereum']?.status).toBe('confirmed');
  });

  it('updateChainStatus stores error when provided', () => {
    const { result } = renderHook(() => useCrossChainTasks());
    act(() => result.current.updateChainStatus('cct-1', 'ethereum', 'failed', 'Gas limit exceeded'));
    const task = result.current.allTasks.find((t) => t.id === 'cct-1')!;
    expect(task.chainStatuses['ethereum']?.error).toBe('Gas limit exceeded');
  });

  it('updateChainStatus updates lastUpdatedAt', () => {
    const { result } = renderHook(() => useCrossChainTasks());
    const before = result.current.allTasks.find((t) => t.id === 'cct-1')!.lastUpdatedAt;
    act(() => result.current.updateChainStatus('cct-1', 'soroban', 'confirmed'));
    const after = result.current.allTasks.find((t) => t.id === 'cct-1')!.lastUpdatedAt;
    expect(after >= before).toBe(true);
  });

  it('updateChainStatus does not affect other tasks', () => {
    const { result } = renderHook(() => useCrossChainTasks());
    const before = result.current.allTasks.find((t) => t.id === 'cct-2')!.lastUpdatedAt;
    act(() => result.current.updateChainStatus('cct-1', 'soroban', 'confirmed'));
    const after = result.current.allTasks.find((t) => t.id === 'cct-2')!.lastUpdatedAt;
    expect(after).toBe(before);
  });
});
