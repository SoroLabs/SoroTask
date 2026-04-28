import { act, renderHook } from '@testing-library/react';
import { useUnsavedChanges } from '../use-unsaved-changes';

describe('useUnsavedChanges', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers a beforeunload listener on mount', () => {
    const addSpy = jest.spyOn(window, 'addEventListener');
    renderHook(() => useUnsavedChanges(false));
    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });

  it('removes the beforeunload listener on unmount', () => {
    const removeSpy = jest.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useUnsavedChanges(false));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });

  it('does not call preventDefault on beforeunload when form is clean', () => {
    renderHook(() => useUnsavedChanges(false));
    const event = new Event('beforeunload') as BeforeUnloadEvent;
    const preventDefaultSpy = jest.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('calls preventDefault on beforeunload when form is dirty', () => {
    renderHook(() => useUnsavedChanges(true));
    const event = new Event('beforeunload') as BeforeUnloadEvent;
    const preventDefaultSpy = jest.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('sets returnValue on beforeunload when dirty (legacy browser support)', () => {
    renderHook(() => useUnsavedChanges(true));
    const event = new Event('beforeunload') as BeforeUnloadEvent;
    let captured: string | undefined;
    Object.defineProperty(event, 'returnValue', {
      set(val: string) { captured = val; },
      get() { return captured; },
      configurable: true,
    });
    window.dispatchEvent(event);
    expect(captured).toBe('');
  });

  it('does not register a second listener on rerender', () => {
    const addSpy = jest.spyOn(window, 'addEventListener');
    const { rerender } = renderHook(({ dirty }) => useUnsavedChanges(dirty), {
      initialProps: { dirty: false },
    });
    const callsBefore = addSpy.mock.calls.filter(([name]) => name === 'beforeunload').length;
    act(() => {
      rerender({ dirty: true });
    });
    const callsAfter = addSpy.mock.calls.filter(([name]) => name === 'beforeunload').length;
    expect(callsAfter).toBe(callsBefore);
  });

  it('picks up the latest isDirty value via ref without re-registering', () => {
    const { rerender } = renderHook(({ dirty }) => useUnsavedChanges(dirty), {
      initialProps: { dirty: false },
    });
    act(() => {
      rerender({ dirty: true });
    });
    const event = new Event('beforeunload') as BeforeUnloadEvent;
    const preventDefaultSpy = jest.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  describe('confirmDiscard', () => {
    it('returns true immediately without prompting when form is clean', () => {
      const confirmSpy = jest.spyOn(window, 'confirm');
      const { result } = renderHook(() => useUnsavedChanges(false));
      expect(result.current.confirmDiscard()).toBe(true);
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('shows a confirm dialog when form is dirty', () => {
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      const { result } = renderHook(() => useUnsavedChanges(true));
      result.current.confirmDiscard();
      expect(window.confirm).toHaveBeenCalled();
    });

    it('returns true when user confirms discard', () => {
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      const { result } = renderHook(() => useUnsavedChanges(true));
      expect(result.current.confirmDiscard()).toBe(true);
    });

    it('returns false when user cancels discard', () => {
      jest.spyOn(window, 'confirm').mockReturnValue(false);
      const { result } = renderHook(() => useUnsavedChanges(true));
      expect(result.current.confirmDiscard()).toBe(false);
    });

    it('uses a custom message when provided', () => {
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      const { result } = renderHook(() => useUnsavedChanges(true));
      result.current.confirmDiscard('Discard your task?');
      expect(window.confirm).toHaveBeenCalledWith('Discard your task?');
    });

    it('reflects the latest isDirty state after form becomes clean', () => {
      const confirmSpy = jest.spyOn(window, 'confirm');
      const { rerender, result } = renderHook(({ dirty }) => useUnsavedChanges(dirty), {
        initialProps: { dirty: true },
      });
      act(() => {
        rerender({ dirty: false });
      });
      expect(result.current.confirmDiscard()).toBe(true);
      expect(confirmSpy).not.toHaveBeenCalled();
    });
  });
});
