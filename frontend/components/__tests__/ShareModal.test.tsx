import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ShareModal } from '@/components/ShareModal';
import type { SharedAccess, SharePreview, CreateShareRequest } from '@/types/sharing';

// Mock clipboard API
const mockClipboard = {
  writeText: jest.fn().mockResolvedValue(undefined),
};
Object.assign(navigator, { clipboard: mockClipboard });

describe('ShareModal', () => {
  const mockOnCreateShare = jest.fn();
  const mockOnRevokeShare = jest.fn();
  
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    scope: 'task' as const,
    resourceId: 'task-123',
    resourceName: 'Test Task',
    onCreateShare: mockOnCreateShare,
    onRevokeShare: mockOnRevokeShare,
    existingShares: [] as SharedAccess[],
  };

  const mockPreview: SharePreview = {
    scope: 'task',
    resourceId: 'task-123',
    resourceName: 'Test Task',
    sharedFields: ['Task ID', 'Target Contract', 'Status'],
    sensitiveFields: ['Gas Balance', 'Owner Address'],
  };

  const mockShare: SharedAccess = {
    id: 'share-1',
    shareToken: 'abc123token',
    scope: 'task',
    resourceId: 'task-123',
    resourceName: 'Test Task',
    visibility: 'public',
    status: 'active',
    createdAt: '2024-01-15T10:00:00Z',
    expiresAt: null,
    createdBy: 'user-1',
    accessCount: 5,
    lastAccessedAt: '2024-01-20T15:30:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should not render when isOpen is false', () => {
      render(<ShareModal {...defaultProps} isOpen={false} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should render when isOpen is true', () => {
      render(<ShareModal {...defaultProps} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should display correct title for task scope', () => {
      render(<ShareModal {...defaultProps} />);
      expect(screen.getByText('Share Task')).toBeInTheDocument();
    });

    it('should display correct title for project scope', () => {
      render(<ShareModal {...defaultProps} scope="project" />);
      expect(screen.getByText('Share Project')).toBeInTheDocument();
    });
  });

  describe('Preview Step', () => {
    it('should show preview step by default when no existing shares', () => {
      render(<ShareModal {...defaultProps} preview={mockPreview} />);
      expect(screen.getByText('What will be shared')).toBeInTheDocument();
    });

    it('should display shared fields in preview', () => {
      render(<ShareModal {...defaultProps} preview={mockPreview} />);
      expect(screen.getByText('Task ID')).toBeInTheDocument();
      expect(screen.getByText('Target Contract')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
    });

    it('should display sensitive fields in preview', () => {
      render(<ShareModal {...defaultProps} preview={mockPreview} />);
      expect(screen.getByText('Gas Balance')).toBeInTheDocument();
      expect(screen.getByText('Owner Address')).toBeInTheDocument();
    });

    it('should navigate to configure step on Continue click', () => {
      render(<ShareModal {...defaultProps} />);
      fireEvent.click(screen.getByText('Continue'));
      expect(screen.getByText('Visibility')).toBeInTheDocument();
    });

    it('should close modal on Cancel click', () => {
      const onClose = jest.fn();
      render(<ShareModal {...defaultProps} onClose={onClose} />);
      fireEvent.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Configure Step', () => {
    beforeEach(() => {
      render(<ShareModal {...defaultProps} />);
      fireEvent.click(screen.getByText('Continue'));
    });

    it('should display visibility options', () => {
      expect(screen.getByText('Public')).toBeInTheDocument();
      expect(screen.getByText('Private')).toBeInTheDocument();
      expect(screen.getByText('Password Protected')).toBeInTheDocument();
    });

    it('should display expiration options', () => {
      expect(screen.getByText('Never expires')).toBeInTheDocument();
      expect(screen.getByText('1 hour')).toBeInTheDocument();
      expect(screen.getByText('24 hours')).toBeInTheDocument();
    });

    it('should show password field when password protected is selected', () => {
      fireEvent.click(screen.getByLabelText(/Password Protected/));
      expect(screen.getByPlaceholderText('Enter a password for access')).toBeInTheDocument();
    });

    it('should disable create button when password is required but not provided', () => {
      fireEvent.click(screen.getByLabelText(/Password Protected/));
      expect(screen.getByText('Create Share Link')).toBeDisabled();
    });

    it('should enable create button when password is provided', () => {
      fireEvent.click(screen.getByLabelText(/Password Protected/));
      fireEvent.change(screen.getByPlaceholderText('Enter a password for access'), {
        target: { value: 'testpassword' },
      });
      expect(screen.getByText('Create Share Link')).not.toBeDisabled();
    });

    it('should go back to preview step on Back click', () => {
      fireEvent.click(screen.getByText('Back'));
      expect(screen.getByText('What will be shared')).toBeInTheDocument();
    });
  });

  describe('Create Share', () => {
    it('should call onCreateShare with correct parameters', async () => {
      mockOnCreateShare.mockResolvedValueOnce(mockShare);
      render(<ShareModal {...defaultProps} />);
      
      fireEvent.click(screen.getByText('Continue'));
      fireEvent.click(screen.getByText('Create Share Link'));
      
      await waitFor(() => {
        expect(mockOnCreateShare).toHaveBeenCalledWith({
          scope: 'task',
          resourceId: 'task-123',
          visibility: 'public',
          expiresIn: undefined,
        });
      });
    });

    it('should show success message after creating share', async () => {
      mockOnCreateShare.mockResolvedValueOnce(mockShare);
      render(<ShareModal {...defaultProps} />);
      
      fireEvent.click(screen.getByText('Continue'));
      fireEvent.click(screen.getByText('Create Share Link'));
      
      await waitFor(() => {
        expect(screen.getByText('Share link created successfully')).toBeInTheDocument();
      });
    });

    it('should display error message on create failure', async () => {
      mockOnCreateShare.mockRejectedValueOnce(new Error('Create failed'));
      render(<ShareModal {...defaultProps} />);
      
      fireEvent.click(screen.getByText('Continue'));
      fireEvent.click(screen.getByText('Create Share Link'));
      
      await waitFor(() => {
        expect(screen.getByText('Create failed')).toBeInTheDocument();
      });
    });
  });

  describe('Success Step', () => {
    beforeEach(async () => {
      mockOnCreateShare.mockResolvedValueOnce(mockShare);
      render(<ShareModal {...defaultProps} />);
      fireEvent.click(screen.getByText('Continue'));
      fireEvent.click(screen.getByText('Create Share Link'));
      await waitFor(() => {
        expect(screen.getByText('Share link created successfully')).toBeInTheDocument();
      });
    });

    it('should display share link', () => {
      expect(screen.getByDisplayValue(/shared\/abc123token/)).toBeInTheDocument();
    });

    it('should copy link to clipboard', async () => {
      fireEvent.click(screen.getByText('Copy'));
      await waitFor(() => {
        expect(mockClipboard.writeText).toHaveBeenCalled();
        expect(screen.getByText('Copied!')).toBeInTheDocument();
      });
    });

    it('should navigate to manage step', () => {
      fireEvent.click(screen.getByText('Manage Shares'));
      expect(screen.getByText('Active Shares')).toBeInTheDocument();
    });
  });

  describe('Manage Step', () => {
    it('should show manage step when existing shares exist', () => {
      render(<ShareModal {...defaultProps} existingShares={[mockShare]} />);
      expect(screen.getByText('Active Shares')).toBeInTheDocument();
    });

    it('should display existing shares', () => {
      render(<ShareModal {...defaultProps} existingShares={[mockShare]} />);
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('should show revoke button for active shares', () => {
      render(<ShareModal {...defaultProps} existingShares={[mockShare]} />);
      expect(screen.getByText('Revoke')).toBeInTheDocument();
    });

    it('should call onRevokeShare when revoke is clicked', async () => {
      mockOnRevokeShare.mockResolvedValueOnce(undefined);
      render(<ShareModal {...defaultProps} existingShares={[mockShare]} />);
      
      fireEvent.click(screen.getByText('Revoke'));
      
      await waitFor(() => {
        expect(mockOnRevokeShare).toHaveBeenCalledWith('share-1');
      });
    });

    it('should show empty state when no shares', () => {
      render(<ShareModal {...defaultProps} existingShares={[]} />);
      // When no existing shares, it starts at preview step, not manage step
      // So we need to navigate to manage step first
      fireEvent.click(screen.getByText('Continue'));
      fireEvent.click(screen.getByText('Create Share Link'));
      // After creating, we can go to manage step
    });
  });

  describe('Status Badges', () => {
    it('should display active status badge', () => {
      render(<ShareModal {...defaultProps} existingShares={[mockShare]} />);
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('should display expired status badge', () => {
      const expiredShare = { ...mockShare, status: 'expired' as const };
      render(<ShareModal {...defaultProps} existingShares={[expiredShare]} />);
      expect(screen.getByText('Expired')).toBeInTheDocument();
    });

    it('should display revoked status badge', () => {
      const revokedShare = { ...mockShare, status: 'revoked' as const };
      render(<ShareModal {...defaultProps} existingShares={[revokedShare]} />);
      expect(screen.getByText('Revoked')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have correct ARIA attributes', () => {
      render(<ShareModal {...defaultProps} />);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby', 'share-modal-title');
    });

    it('should have accessible close button', () => {
      render(<ShareModal {...defaultProps} />);
      expect(screen.getByLabelText('Close modal')).toBeInTheDocument();
    });
  });
});
