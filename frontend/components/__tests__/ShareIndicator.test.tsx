import { render, screen, fireEvent } from '@testing-library/react';
import { ShareIndicator } from '@/components/ShareIndicator';
import type { SharedAccess } from '@/types/sharing';

describe('ShareIndicator', () => {
  const mockOnOpenShareModal = jest.fn();
  
  const mockShare: SharedAccess = {
    id: 'share-1',
    shareToken: 'abc123',
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

  describe('No shares', () => {
    it('should render share button when no shares exist', () => {
      render(<ShareIndicator shares={[]} onOpenShareModal={mockOnOpenShareModal} />);
      expect(screen.getByText('Share')).toBeInTheDocument();
    });

    it('should call onOpenShareModal when clicked', () => {
      render(<ShareIndicator shares={[]} onOpenShareModal={mockOnOpenShareModal} />);
      fireEvent.click(screen.getByText('Share'));
      expect(mockOnOpenShareModal).toHaveBeenCalled();
    });
  });

  describe('Active shares', () => {
    it('should display share count when shares exist', () => {
      render(<ShareIndicator shares={[mockShare]} onOpenShareModal={mockOnOpenShareModal} />);
      expect(screen.getByText('1 shared')).toBeInTheDocument();
    });

    it('should display plural form for multiple shares', () => {
      const shares = [
        mockShare,
        { ...mockShare, id: 'share-2', shareToken: 'def456' },
      ];
      render(<ShareIndicator shares={shares} onOpenShareModal={mockOnOpenShareModal} />);
      expect(screen.getByText('2 shared')).toBeInTheDocument();
    });

    it('should show tooltip on hover', () => {
      render(<ShareIndicator shares={[mockShare]} onOpenShareModal={mockOnOpenShareModal} />);
      fireEvent.mouseEnter(screen.getByText('1 shared'));
      expect(screen.getByText('1 active share')).toBeInTheDocument();
    });
  });

  describe('Expired shares', () => {
    it('should show expired count', () => {
      const expiredShare = { ...mockShare, status: 'expired' as const };
      render(<ShareIndicator shares={[expiredShare]} onOpenShareModal={mockOnOpenShareModal} />);
      expect(screen.getByText('Share issues')).toBeInTheDocument();
    });

    it('should show expired shares in tooltip', () => {
      const expiredShare = { ...mockShare, status: 'expired' as const };
      render(<ShareIndicator shares={[expiredShare]} onOpenShareModal={mockOnOpenShareModal} />);
      fireEvent.mouseEnter(screen.getByText('Share issues'));
      expect(screen.getByText('1 expired share')).toBeInTheDocument();
    });
  });

  describe('Revoked shares', () => {
    it('should show revoked shares in tooltip', () => {
      const revokedShare = { ...mockShare, status: 'revoked' as const };
      render(<ShareIndicator shares={[revokedShare]} onOpenShareModal={mockOnOpenShareModal} />);
      fireEvent.mouseEnter(screen.getByText('Share issues'));
      expect(screen.getByText('1 revoked share')).toBeInTheDocument();
    });
  });

  describe('Mixed shares', () => {
    it('should show both active and expired counts', () => {
      const shares = [
        mockShare,
        { ...mockShare, id: 'share-2', status: 'expired' as const },
      ];
      render(<ShareIndicator shares={shares} onOpenShareModal={mockOnOpenShareModal} />);
      expect(screen.getByText('1 shared')).toBeInTheDocument();
      expect(screen.getByText('(1 expired)')).toBeInTheDocument();
    });
  });

  describe('Compact mode', () => {
    it('should not show text in compact mode', () => {
      render(<ShareIndicator shares={[]} onOpenShareModal={mockOnOpenShareModal} compact />);
      expect(screen.queryByText('Share')).not.toBeInTheDocument();
    });

    it('should still be clickable in compact mode', () => {
      render(<ShareIndicator shares={[]} onOpenShareModal={mockOnOpenShareModal} compact />);
      fireEvent.click(screen.getByLabelText('Create share link'));
      expect(mockOnOpenShareModal).toHaveBeenCalled();
    });
  });

  describe('Accessibility', () => {
    it('should have accessible label for no shares', () => {
      render(<ShareIndicator shares={[]} onOpenShareModal={mockOnOpenShareModal} />);
      expect(screen.getByLabelText('Create share link')).toBeInTheDocument();
    });

    it('should have accessible label for shares', () => {
      render(<ShareIndicator shares={[mockShare]} onOpenShareModal={mockOnOpenShareModal} />);
      expect(screen.getByLabelText('1 active share')).toBeInTheDocument();
    });
  });
});
