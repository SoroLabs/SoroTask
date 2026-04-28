import { render, screen, fireEvent } from '@testing-library/react';
import { Overlay } from '@/components/Overlay';

// Portal renders into document.body — jsdom supports this
describe('Overlay', () => {
  const onClose = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  describe('Rendering', () => {
    it('renders nothing when closed', () => {
      render(
        <Overlay open={false} onClose={onClose}>
          <div>content</div>
        </Overlay>
      );
      expect(screen.queryByTestId('overlay-backdrop')).not.toBeInTheDocument();
    });

    it('renders backdrop and children when open', () => {
      render(
        <Overlay open onClose={onClose}>
          <div>content</div>
        </Overlay>
      );
      expect(screen.getByTestId('overlay-backdrop')).toBeInTheDocument();
      expect(screen.getByText('content')).toBeInTheDocument();
    });

    it('backdrop has aria-hidden', () => {
      render(
        <Overlay open onClose={onClose}>
          <div>content</div>
        </Overlay>
      );
      expect(screen.getByTestId('overlay-backdrop')).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('Backdrop click', () => {
    it('calls onClose when backdrop is clicked', () => {
      render(
        <Overlay open onClose={onClose}>
          <div data-testid="inner">content</div>
        </Overlay>
      );
      fireEvent.click(screen.getByTestId('overlay-backdrop'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose when a child is clicked', () => {
      render(
        <Overlay open onClose={onClose}>
          <div data-testid="inner">content</div>
        </Overlay>
      );
      fireEvent.click(screen.getByTestId('inner'));
      expect(onClose).not.toHaveBeenCalled();
    });

    it('does not call onClose when disableBackdropClose is true', () => {
      render(
        <Overlay open onClose={onClose} disableBackdropClose>
          <div>content</div>
        </Overlay>
      );
      fireEvent.click(screen.getByTestId('overlay-backdrop'));
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Escape key', () => {
    it('calls onClose on Escape key', () => {
      render(
        <Overlay open onClose={onClose}>
          <div>content</div>
        </Overlay>
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose on Escape when disableEscapeClose is true', () => {
      render(
        <Overlay open onClose={onClose} disableEscapeClose>
          <div>content</div>
        </Overlay>
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
    });

    it('does not call onClose on Escape when closed', () => {
      render(
        <Overlay open={false} onClose={onClose}>
          <div>content</div>
        </Overlay>
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
    });

    it('does not call onClose for non-Escape keys', () => {
      render(
        <Overlay open onClose={onClose}>
          <div>content</div>
        </Overlay>
      );
      fireEvent.keyDown(document, { key: 'Enter' });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Custom backdrop class', () => {
    it('applies custom backdropClassName', () => {
      render(
        <Overlay open onClose={onClose} backdropClassName="custom-backdrop">
          <div>content</div>
        </Overlay>
      );
      expect(screen.getByTestId('overlay-backdrop')).toHaveClass('custom-backdrop');
    });
  });
});
