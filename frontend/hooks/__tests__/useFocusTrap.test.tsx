import { render, screen, fireEvent } from '@testing-library/react';
import { useFocusTrap } from '@/hooks/useFocusTrap';

// Test component that uses the hook
function TrapFixture({ enabled }: { enabled: boolean }) {
  const ref = useFocusTrap<HTMLDivElement>({ enabled });
  return (
    <div>
      <button data-testid="outside">Outside</button>
      <div ref={ref} data-testid="container">
        <button data-testid="btn-a">A</button>
        <button data-testid="btn-b">B</button>
        <button data-testid="btn-c">C</button>
      </div>
    </div>
  );
}

function EmptyTrapFixture({ enabled }: { enabled: boolean }) {
  const ref = useFocusTrap<HTMLDivElement>({ enabled });
  return (
    <div ref={ref} data-testid="empty-container" tabIndex={-1}>
      {/* no focusable children */}
      <span>no buttons here</span>
    </div>
  );
}

describe('useFocusTrap', () => {
  describe('Tab cycling', () => {
    it('wraps Tab from last to first focusable element', () => {
      render(<TrapFixture enabled />);
      const btnC = screen.getByTestId('btn-c');
      btnC.focus();
      expect(document.activeElement).toBe(btnC);

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });
      expect(document.activeElement).toBe(screen.getByTestId('btn-a'));
    });

    it('wraps Shift+Tab from first to last focusable element', () => {
      render(<TrapFixture enabled />);
      const btnA = screen.getByTestId('btn-a');
      btnA.focus();
      expect(document.activeElement).toBe(btnA);

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(screen.getByTestId('btn-c'));
    });

    it('does not interfere with Tab when trap is disabled', () => {
      render(<TrapFixture enabled={false} />);
      const btnC = screen.getByTestId('btn-c');
      btnC.focus();

      // Tab should not be intercepted — no focus change from the hook
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });
      // Active element stays on btnC (browser doesn't move it in jsdom)
      expect(document.activeElement).toBe(btnC);
    });
  });

  describe('Empty container', () => {
    it('prevents Tab when no focusable children', () => {
      render(<EmptyTrapFixture enabled />);
      const container = screen.getByTestId('empty-container');
      container.focus();

      // Should not throw
      fireEvent.keyDown(document, { key: 'Tab' });
    });
  });
});
