import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SharedAccessPage } from '@/components/SharedAccessPage';
import type { AccessValidationResult, SharedAccess } from '@/types/sharing';

describe('SharedAccessPage', () => {
  const mockOnValidateAccess = jest.fn();
  
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

  describe('Loading state', () => {
    it('should show loading state initially', () => {
      mockOnValidateAccess.mockImplementation(() => new Promise(() => {})); // Never resolves
      render(<SharedAccessPage shareToken="abc123" onValidateAccess={mockOnValidateAccess} />);
      expect(screen.getByText('Validating access...')).toBeInTheDocument();
    });
  });

  describe('Valid access', () => {
    it('should display shared content when access is valid', async () => {
      mockOnValidateAccess.mockResolvedValueOnce({ valid: true, share: mockShare });
      render(<SharedAccessPage shareToken="abc123" onValidateAccess={mockOnValidateAccess} />);
      
      await waitFor(() => {
        expect(screen.getByText('Test Task')).toBeInTheDocument();
      });
    });

    it('should show active status badge', async () => {
      mockOnValidateAccess.mockResolvedValueOnce({ valid: true, share: mockShare });
      render(<SharedAccessPage shareToken="abc123" onValidateAccess={mockOnValidateAccess} />);
      
      await waitFor(() => {
        expect(screen.getByText('Active')).toBeInTheDocument();
      });
    });

    it('should display access count', async () => {
      mockOnValidateAccess.mockResolvedValueOnce({ valid: true, share: mockShare });
      render(<SharedAccessPage shareToken="abc123" onValidateAccess={mockOnValidateAccess} />);
      
      await waitFor(() => {
        expect(screen.getByText(/Accessed 5 times/)).toBeInTheDocument();
      });
    });
  });

  describe('Expired access', () => {
    it('should show expired message', async () => {
      mockOnValidateAccess.mockResolvedValueOnce({ 
        valid: false, 
        reason: 'expired', 
        share: { ...mockShare, status: 'expired' } 
      });
      render(<SharedAccessPage shareToken="abc123" onValidateAccess={mockOnValidateAccess} />);
      
      await waitFor(() => {
        expect(screen.getByText('Link Expired')).toBeInTheDocument();
        expect(screen.getByText(/no longer accessible/)).toBeInTheDocument();
      });
    });
  });

  describe('Revoked access', () => {
    it('should show revoked message', async () => {
      mockOnValidateAccess.mockResolvedValueOnce({ 
        valid: false, 
        reason: 'revoked', 
        share: { ...mockShare, status: 'revoked' } 
      });
      render(<SharedAccessPage shareToken="abc123" onValidateAccess={mockOnValidateAccess} />);
      
      await waitFor(() => {
        expect(screen.getByText('Access Revoked')).toBeInTheDocument();
        expect(screen.getByText(/revoked access/)).toBeInTheDocument();
      });
    });
  });

  describe('Not found', () => {
    it('should show not found message', async () => {
      mockOnValidateAccess.mockResolvedValueOnce({ valid: false, reason: 'not_found' });
      render(<SharedAccessPage shareToken="invalid" onValidateAccess={mockOnValidateAccess} />);
      
      await waitFor(() => {
        expect(screen.getByText('Link Not Found')).toBeInTheDocument();
      });
    });
  });

  describe('Password protected', () => {
    it('should show password form when password is required', async () => {
      mockOnValidateAccess.mockResolvedValueOnce({ 
        valid: false, 
        reason: 'password_required', 
        share: { ...mockShare, visibility: 'password_protected' } 
      });
      render(<SharedAccessPage shareToken="abc123" onValidateAccess={mockOnValidateAccess} />);
      
      await waitFor(() => {
        expect(screen.getByText('Password Required')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Enter password')).toBeInTheDocument();
      });
    });

    it('should submit password and validate', async () => {
      mockOnValidateAccess
        .mockResolvedValueOnce({ 
          valid: false, 
          reason: 'password_required', 
          share: { ...mockShare, visibility: 'password_protected' } 
        })
        .mockResolvedValueOnce({ valid: true, share: mockShare });
      
      render(<SharedAccessPage shareToken="abc123" onValidateAccess={mockOnValidateAccess} />);
      
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Enter password')).toBeInTheDocument();
      });
      
      fireEvent.change(screen.getByPlaceholderText('Enter password'), {
        target: { value: 'testpassword' },
      });
      fireEvent.click(screen.getByText('Access Content'));
      
      await waitFor(() => {
        expect(mockOnValidateAccess).toHaveBeenCalledWith('abc123', 'testpassword');
      });
    });

    it('should show error for incorrect password', async () => {
      mockOnValidateAccess
        .mockResolvedValueOnce({ 
          valid: false, 
          reason: 'password_required', 
          share: { ...mockShare, visibility: 'password_protected' } 
        })
        .mockResolvedValueOnce({ 
          valid: false, 
          reason: 'invalid_token', 
          share: { ...mockShare, visibility: 'password_protected' } 
        });
      
      render(<SharedAccessPage shareToken="abc123" onValidateAccess={mockOnValidateAccess} />);
      
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Enter password')).toBeInTheDocument();
      });
      
      fireEvent.change(screen.getByPlaceholderText('Enter password'), {
        target: { value: 'wrongpassword' },
      });
      fireEvent.click(screen.getByText('Access Content'));
      
      await waitFor(() => {
        // When password is wrong, it shows Access Denied (invalid_token reason)
        expect(screen.getByText('Access Denied')).toBeInTheDocument();
      });
    });

    it('should disable submit button when password is empty', async () => {
      mockOnValidateAccess.mockResolvedValueOnce({ 
        valid: false, 
        reason: 'password_required', 
        share: { ...mockShare, visibility: 'password_protected' } 
      });
      render(<SharedAccessPage shareToken="abc123" onValidateAccess={mockOnValidateAccess} />);
      
      await waitFor(() => {
        expect(screen.getByText('Access Content')).toBeDisabled();
      });
    });
  });

  describe('Scope display', () => {
    it('should display task scope correctly', async () => {
      mockOnValidateAccess.mockResolvedValueOnce({ valid: true, share: mockShare });
      render(<SharedAccessPage shareToken="abc123" onValidateAccess={mockOnValidateAccess} />);
      
      await waitFor(() => {
        expect(screen.getByText('Shared Task')).toBeInTheDocument();
      });
    });

    it('should display project scope correctly', async () => {
      const projectShare = { ...mockShare, scope: 'project' as const };
      mockOnValidateAccess.mockResolvedValueOnce({ valid: true, share: projectShare });
      render(<SharedAccessPage shareToken="abc123" onValidateAccess={mockOnValidateAccess} />);
      
      await waitFor(() => {
        expect(screen.getByText('Shared Project')).toBeInTheDocument();
      });
    });
  });
});
