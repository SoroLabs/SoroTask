import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '@/components/ConfirmDialog';

describe('ConfirmDialog', () => {
  const onClose = jest.fn();
  const onConfirm = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  describe('Rendering', () => {
    it('renders nothing when closed', () => {
      render(
        <ConfirmDialog
          open={false}
          onClose={onClose}
          onConfirm={onConfirm}
          title="Delete task?"
        />
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders when open', () => {
      render(
        <ConfirmDialog
          open
          onClose={onClose}
          onConfirm={onConfirm}
          title="Delete task?"
        />
      );
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('renders title', () => {
      render(
        <ConfirmDialog
          open
          onClose={onClose}
          onConfirm={onConfirm}
          title="Delete task?"
        />
      );
      expect(screen.getByText('Delete task?')).toBeInTheDocument();
    });

    it('renders description when provided', () => {
      render(
        <ConfirmDialog
          open
          onClose={onClose}
          onConfirm={onConfirm}
          title="Delete task?"
          description="This cannot be undone."
        />
      );
      expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    });

    it('renders default button labels', () => {
      render(
        <ConfirmDialog
          open
          onClose={onClose}
          onConfirm={onConfirm}
          title="Delete task?"
        />
      );
      expect(screen.getByText('Confirm')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('renders custom button labels', () => {
      render(
        <ConfirmDialog
          open
          onClose={onClose}
          onConfirm={onConfirm}
          title="Delete task?"
          confirmLabel="Delete"
          cancelLabel="Keep"
        />
      );
      expect(screen.getByText('Delete')).toBeInTheDocument();
      expect(screen.getByText('Keep')).toBeInTheDocument();
    });
  });

  describe('Actions', () => {
    it('calls onConfirm when confirm button clicked', () => {
      render(
        <ConfirmDialog
          open
          onClose={onClose}
          onConfirm={onConfirm}
          title="Delete task?"
        />
      );
      fireEvent.click(screen.getByText('Confirm'));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when cancel button clicked', () => {
      render(
        <ConfirmDialog
          open
          onClose={onClose}
          onConfirm={onConfirm}
          title="Delete task?"
        />
      );
      fireEvent.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose on Escape', () => {
      render(
        <ConfirmDialog
          open
          onClose={onClose}
          onConfirm={onConfirm}
          title="Delete task?"
        />
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Loading state', () => {
    it('disables both buttons when isLoading', () => {
      render(
        <ConfirmDialog
          open
          onClose={onClose}
          onConfirm={onConfirm}
          title="Delete task?"
          isLoading
        />
      );
      expect(screen.getByText('Cancel')).toBeDisabled();
      expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
    });

    it('prevents Escape close when isLoading', () => {
      render(
        <ConfirmDialog
          open
          onClose={onClose}
          onConfirm={onConfirm}
          title="Delete task?"
          isLoading
        />
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
    });

    it('prevents backdrop close when isLoading', () => {
      render(
        <ConfirmDialog
          open
          onClose={onClose}
          onConfirm={onConfirm}
          title="Delete task?"
          isLoading
        />
      );
      fireEvent.click(screen.getByTestId('overlay-backdrop'));
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Intent variants', () => {
    it('applies danger styles by default', () => {
      render(
        <ConfirmDialog
          open
          onClose={onClose}
          onConfirm={onConfirm}
          title="Delete?"
        />
      );
      expect(screen.getByText('Confirm')).toHaveClass('bg-red-600');
    });

    it('applies primary styles when intent is primary', () => {
      render(
        <ConfirmDialog
          open
          onClose={onClose}
          onConfirm={onConfirm}
          title="Submit?"
          intent="primary"
        />
      );
      expect(screen.getByText('Confirm')).toHaveClass('bg-blue-600');
    });
  });
});
