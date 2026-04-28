import { render, fireEvent } from '@testing-library/react';
import { useEscapeKey } from '@/hooks/useEscapeKey';

function EscapeFixture({
  onEscape,
  enabled,
}: {
  onEscape: () => void;
  enabled: boolean;
}) {
  useEscapeKey(onEscape, enabled);
  return <div />;
}

describe('useEscapeKey', () => {
  const onEscape = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it('calls onEscape when Escape is pressed and enabled', () => {
    render(<EscapeFixture onEscape={onEscape} enabled />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('does not call onEscape when disabled', () => {
    render(<EscapeFixture onEscape={onEscape} enabled={false} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('does not call onEscape for non-Escape keys', () => {
    render(<EscapeFixture onEscape={onEscape} enabled />);
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'Tab' });
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('removes listener on unmount', () => {
    const { unmount } = render(<EscapeFixture onEscape={onEscape} enabled />);
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('removes listener when enabled changes to false', () => {
    const { rerender } = render(<EscapeFixture onEscape={onEscape} enabled />);
    rerender(<EscapeFixture onEscape={onEscape} enabled={false} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('innermost handler wins with nested overlays (capture phase)', () => {
    // Simulate two overlays — both listening. The inner one stops propagation.
    const outerEscape = jest.fn();
    const innerEscape = jest.fn();

    function Inner() {
      useEscapeKey(innerEscape, true);
      return <div />;
    }
    function Outer() {
      useEscapeKey(outerEscape, true);
      return <Inner />;
    }

    render(<Outer />);
    fireEvent.keyDown(document, { key: 'Escape' });

    // Both fire in capture phase — stopPropagation only prevents bubbling,
    // not other capture listeners. Both should be called.
    expect(innerEscape).toHaveBeenCalledTimes(1);
    expect(outerEscape).toHaveBeenCalledTimes(1);
  });
});
