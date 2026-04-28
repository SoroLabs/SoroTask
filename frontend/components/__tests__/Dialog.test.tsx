import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog, DialogFooter } from '@/components/Dialog';

describe('Dialog', () => {
  const onClose = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  describe('Rendering', () => {
    it('renders nothing when closed', () => {
      render(
        <Dialog open={false} onClose={onClose} title="Test Dialog">
          <p>body</p>
        </Dialog>
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders panel when open', () => {
      render(
        <Dialog open onClose={onClose} title="Test Dialog">
          <p>body</p>
        </Dialog>
      );
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('renders title', () => {
      render(
        <Dialog open onClose={onClose} title="My Title">
          <p>body</p>
        </Dialog>
      );
      expect(screen.getByText('My Title')).toBeInTheDocument();
    });

    it('renders description when provided', () => {
      render(
        <Dialog open onClose={onClose} title="Title" description="Some description">
          <p>body</p>
        </Dialog>
      );
      expect(screen.getByText('Some description')).toBeInTheDocument();
    });

    it('renders children', () => {
      render(
        <Dialog open onClose={onClose} title="Title">
          <p>dialog body content</p>
        </Dialog>
      );
      expect(screen.getByText('dialog body content')).toBeInTheDocument();
    });

    it('hides header when hideHeader is true', () => {
      render(
        <Dialog open onClose={onClose} title="Hidden Title" hideHeader>
          <p>body</p>
        </Dialog>
      );
      expect(screen.queryByText('Hidden Title')).not.toBeInTheDocument();
    });
  });

  describe('ARIA attributes', () => {
    it('has role="dialog"', () => {
      render(
        <Dialog open onClose={onClose} title="Title">
          <p>body</p>
        </Dialog>
      );
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('has aria-modal="true"', () => {
      render(
        <Dialog open onClose={onClose} title="Title">
          <p>body</p>
        </Dialog>
      );
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    it('has aria-labelledby pointing to title', () => {
      render(
        <Dialog open onClose={onClose} title="Labelled Title">
          <p>body</p>
        </Dialog>
      );
      const dialog = screen.getByRole('dialog');
      const labelId = dialog.getAttribute('aria-labelledby');
      expect(labelId).toBeTruthy();
      expect(document.getElementById(labelId!)).toHaveTextContent('Labelled Title');
    });

    it('has aria-describedby when description is provided', () => {
      render(
        <Dialog open onClose={onClose} title="Title" description="A description">
          <p>body</p>
        </Dialog>
      );
      const dialog = screen.getByRole('dialog');
      const descId = dialog.getAttribute('aria-describedby');
      expect(descId).toBeTruthy();
      expect(document.getElementById(descId!)).toHaveTextContent('A description');
    });

    it('does not have aria-describedby when no description', () => {
      render(
        <Dialog open onClose={onClose} title="Title">
          <p>body</p>
        </Dialog>
      );
      expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby');
    });
  });

  describe('Close button', () => {
    it('renders close button', () => {
      render(
        <Dialog open onClose={onClose} title="Title">
          <p>body</p>
        </Dialog>
      );
      expect(screen.getByLabelText('Close dialog')).toBeInTheDocument();
    });

    it('calls onClose when close button clicked', () => {
      render(
        <Dialog open onClose={onClose} title="Title">
          <p>body</p>
        </Dialog>
      );
      fireEvent.click(screen.getByLabelText('Close dialog'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Escape key', () => {
    it('calls onClose on Escape', () => {
      render(
        <Dialog open onClose={onClose} title="Title">
          <p>body</p>
        </Dialog>
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose on Escape when disableEscapeClose', () => {
      render(
        <Dialog open onClose={onClose} title="Title" disableEscapeClose>
          <p>body</p>
        </Dialog>
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Backdrop click', () => {
    it('calls onClose when backdrop clicked', () => {
      render(
        <Dialog open onClose={onClose} title="Title">
          <p>body</p>
        </Dialog>
      );
      // Click the centering wrapper (acts as backdrop for dialog)
      fireEvent.click(screen.getByTestId('dialog-centering'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose when disableBackdropClose', () => {
      render(
        <Dialog open onClose={onClose} title="Title" disableBackdropClose>
          <p>body</p>
        </Dialog>
      );
      fireEvent.click(screen.getByTestId('dialog-centering'));
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Size variants', () => {
    it.each([
      ['sm', 'max-w-sm'],
      ['md', 'max-w-md'],
      ['lg', 'max-w-lg'],
      ['xl', 'max-w-xl'],
    ] as const)('applies %s size class', (size, cls) => {
      render(
        <Dialog open onClose={onClose} title="Title" size={size}>
          <p>body</p>
        </Dialog>
      );
      expect(screen.getByTestId('dialog-panel')).toHaveClass(cls);
    });
  });

  describe('DialogFooter', () => {
    it('renders footer children', () => {
      render(
        <Dialog open onClose={onClose} title="Title">
          <DialogFooter>
            <button>OK</button>
          </DialogFooter>
        </Dialog>
      );
      expect(screen.getByText('OK')).toBeInTheDocument();
    });
  });
});
