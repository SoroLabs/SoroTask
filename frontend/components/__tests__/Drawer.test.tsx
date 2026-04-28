import { render, screen, fireEvent } from '@testing-library/react';
import { Drawer } from '@/components/Drawer';

describe('Drawer', () => {
  const onClose = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  describe('Rendering', () => {
    it('renders nothing when closed', () => {
      render(
        <Drawer open={false} onClose={onClose} title="Test Drawer">
          <p>body</p>
        </Drawer>
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders panel when open', () => {
      render(
        <Drawer open onClose={onClose} title="Test Drawer">
          <p>body</p>
        </Drawer>
      );
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('renders title', () => {
      render(
        <Drawer open onClose={onClose} title="My Drawer">
          <p>body</p>
        </Drawer>
      );
      expect(screen.getByText('My Drawer')).toBeInTheDocument();
    });

    it('renders description when provided', () => {
      render(
        <Drawer open onClose={onClose} title="Title" description="Drawer description">
          <p>body</p>
        </Drawer>
      );
      expect(screen.getByText('Drawer description')).toBeInTheDocument();
    });

    it('renders children', () => {
      render(
        <Drawer open onClose={onClose} title="Title">
          <p>drawer content</p>
        </Drawer>
      );
      expect(screen.getByText('drawer content')).toBeInTheDocument();
    });
  });

  describe('ARIA attributes', () => {
    it('has role="dialog"', () => {
      render(
        <Drawer open onClose={onClose} title="Title">
          <p>body</p>
        </Drawer>
      );
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('has aria-modal="true"', () => {
      render(
        <Drawer open onClose={onClose} title="Title">
          <p>body</p>
        </Drawer>
      );
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    it('has aria-labelledby pointing to title', () => {
      render(
        <Drawer open onClose={onClose} title="Drawer Title">
          <p>body</p>
        </Drawer>
      );
      const dialog = screen.getByRole('dialog');
      const labelId = dialog.getAttribute('aria-labelledby');
      expect(labelId).toBeTruthy();
      expect(document.getElementById(labelId!)).toHaveTextContent('Drawer Title');
    });

    it('has aria-describedby when description provided', () => {
      render(
        <Drawer open onClose={onClose} title="Title" description="desc">
          <p>body</p>
        </Drawer>
      );
      const dialog = screen.getByRole('dialog');
      const descId = dialog.getAttribute('aria-describedby');
      expect(descId).toBeTruthy();
      expect(document.getElementById(descId!)).toHaveTextContent('desc');
    });
  });

  describe('Close button', () => {
    it('renders close button', () => {
      render(
        <Drawer open onClose={onClose} title="Title">
          <p>body</p>
        </Drawer>
      );
      expect(screen.getByLabelText('Close drawer')).toBeInTheDocument();
    });

    it('calls onClose when close button clicked', () => {
      render(
        <Drawer open onClose={onClose} title="Title">
          <p>body</p>
        </Drawer>
      );
      fireEvent.click(screen.getByLabelText('Close drawer'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Escape key', () => {
    it('calls onClose on Escape', () => {
      render(
        <Drawer open onClose={onClose} title="Title">
          <p>body</p>
        </Drawer>
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose on Escape when disableEscapeClose', () => {
      render(
        <Drawer open onClose={onClose} title="Title" disableEscapeClose>
          <p>body</p>
        </Drawer>
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Backdrop click', () => {
    it('calls onClose when backdrop clicked', () => {
      render(
        <Drawer open onClose={onClose} title="Title">
          <p>body</p>
        </Drawer>
      );
      fireEvent.click(screen.getByTestId('overlay-backdrop'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose when disableBackdropClose', () => {
      render(
        <Drawer open onClose={onClose} title="Title" disableBackdropClose>
          <p>body</p>
        </Drawer>
      );
      fireEvent.click(screen.getByTestId('overlay-backdrop'));
      expect(onClose).not.toHaveBeenCalled();
    });

    it('does not close when panel itself is clicked', () => {
      render(
        <Drawer open onClose={onClose} title="Title">
          <p>body</p>
        </Drawer>
      );
      fireEvent.click(screen.getByTestId('drawer-panel'));
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Side variants', () => {
    it.each([
      ['right', 'right-0'],
      ['left', 'left-0'],
      ['bottom', 'bottom-0'],
    ] as const)('applies %s side positioning', (side, cls) => {
      render(
        <Drawer open onClose={onClose} title="Title" side={side}>
          <p>body</p>
        </Drawer>
      );
      expect(screen.getByTestId('drawer-panel')).toHaveClass(cls);
    });
  });

  describe('Custom dimensions', () => {
    it('applies custom width for side drawer', () => {
      render(
        <Drawer open onClose={onClose} title="Title" side="right" width="w-96">
          <p>body</p>
        </Drawer>
      );
      expect(screen.getByTestId('drawer-panel')).toHaveClass('w-96');
    });

    it('applies custom height for bottom drawer', () => {
      render(
        <Drawer open onClose={onClose} title="Title" side="bottom" height="h-48">
          <p>body</p>
        </Drawer>
      );
      expect(screen.getByTestId('drawer-panel')).toHaveClass('h-48');
    });
  });
});
