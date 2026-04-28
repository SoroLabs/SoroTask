import { render, act } from '@testing-library/react';
import { useScrollLock } from '@/hooks/useScrollLock';

function ScrollLockFixture({ locked }: { locked: boolean }) {
  useScrollLock(locked);
  return <div />;
}

describe('useScrollLock', () => {
  beforeEach(() => {
    // Reset body styles before each test
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
  });

  it('sets overflow hidden on body when locked', () => {
    render(<ScrollLockFixture locked />);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('sets position fixed on body when locked', () => {
    render(<ScrollLockFixture locked />);
    expect(document.body.style.position).toBe('fixed');
  });

  it('sets width 100% on body when locked', () => {
    render(<ScrollLockFixture locked />);
    expect(document.body.style.width).toBe('100%');
  });

  it('does not modify body when not locked', () => {
    render(<ScrollLockFixture locked={false} />);
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.position).toBe('');
  });

  it('restores body styles on unmount', () => {
    const { unmount } = render(<ScrollLockFixture locked />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.position).toBe('');
  });

  it('restores body styles when locked changes to false', () => {
    const { rerender } = render(<ScrollLockFixture locked />);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<ScrollLockFixture locked={false} />);
    expect(document.body.style.overflow).toBe('');
  });
});
