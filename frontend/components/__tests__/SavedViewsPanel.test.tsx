import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SavedViewsPanel } from '@/components/SavedViewsPanel';
import type { SavedView } from '@/types/search';

describe('SavedViewsPanel', () => {
  const mockView: SavedView = {
    id: 'view-1',
    name: 'My View',
    filters: { query: 'test', status: ['active'] },
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z',
  };

  const defaultProps = {
    savedViews: [],
    activeViewId: null,
    hasActiveFilters: false,
    onSaveView: jest.fn(),
    onLoadView: jest.fn(),
    onDeleteView: jest.fn(),
    onUpdateView: jest.fn(),
    onCopyShareableUrl: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Empty state', () => {
    it('should show empty message when no views', () => {
      render(<SavedViewsPanel {...defaultProps} />);
      expect(screen.getByText('No saved views yet.')).toBeInTheDocument();
    });

    it('should show save hint when filters are active but no views', () => {
      render(<SavedViewsPanel {...defaultProps} hasActiveFilters />);
      expect(screen.getByText('Save your current filters as a view.')).toBeInTheDocument();
    });
  });

  describe('Save view', () => {
    it('should show save button when filters are active', () => {
      render(<SavedViewsPanel {...defaultProps} hasActiveFilters />);
      expect(screen.getByText('Save view')).toBeInTheDocument();
    });

    it('should not show save button when no active filters', () => {
      render(<SavedViewsPanel {...defaultProps} />);
      expect(screen.queryByText('Save view')).not.toBeInTheDocument();
    });

    it('should show save form when save button clicked', () => {
      render(<SavedViewsPanel {...defaultProps} hasActiveFilters />);
      fireEvent.click(screen.getByText('Save view'));
      expect(screen.getByPlaceholderText('View name...')).toBeInTheDocument();
    });

    it('should call onSaveView with name', () => {
      render(<SavedViewsPanel {...defaultProps} hasActiveFilters />);
      fireEvent.click(screen.getByText('Save view'));
      fireEvent.change(screen.getByPlaceholderText('View name...'), {
        target: { value: 'My New View' },
      });
      fireEvent.click(screen.getByText('Save'));
      expect(defaultProps.onSaveView).toHaveBeenCalledWith('My New View');
    });

    it('should save on Enter key', () => {
      render(<SavedViewsPanel {...defaultProps} hasActiveFilters />);
      fireEvent.click(screen.getByText('Save view'));
      const input = screen.getByPlaceholderText('View name...');
      fireEvent.change(input, { target: { value: 'My View' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(defaultProps.onSaveView).toHaveBeenCalledWith('My View');
    });

    it('should cancel on Escape key', () => {
      render(<SavedViewsPanel {...defaultProps} hasActiveFilters />);
      fireEvent.click(screen.getByText('Save view'));
      const input = screen.getByPlaceholderText('View name...');
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.queryByPlaceholderText('View name...')).not.toBeInTheDocument();
    });

    it('should disable save button when name is empty', () => {
      render(<SavedViewsPanel {...defaultProps} hasActiveFilters />);
      fireEvent.click(screen.getByText('Save view'));
      expect(screen.getByText('Save')).toBeDisabled();
    });
  });

  describe('Views list', () => {
    it('should render saved views', () => {
      render(<SavedViewsPanel {...defaultProps} savedViews={[mockView]} />);
      expect(screen.getByText('My View')).toBeInTheDocument();
    });

    it('should highlight active view', () => {
      render(<SavedViewsPanel {...defaultProps} savedViews={[mockView]} activeViewId="view-1" />);
      // Active view button should have blue styling
      const viewButton = screen.getByText('My View');
      expect(viewButton).toHaveClass('text-blue-300');
    });

    it('should call onLoadView when view clicked', () => {
      render(<SavedViewsPanel {...defaultProps} savedViews={[mockView]} />);
      fireEvent.click(screen.getByText('My View'));
      expect(defaultProps.onLoadView).toHaveBeenCalledWith('view-1');
    });

    it('should have accessible list', () => {
      render(<SavedViewsPanel {...defaultProps} savedViews={[mockView]} />);
      expect(screen.getByRole('list', { name: 'Saved views' })).toBeInTheDocument();
    });
  });

  describe('View options menu', () => {
    it('should show options button on hover', () => {
      render(<SavedViewsPanel {...defaultProps} savedViews={[mockView]} />);
      const optionsBtn = screen.getByLabelText('Options for My View');
      expect(optionsBtn).toBeInTheDocument();
    });

    it('should show delete option in menu', () => {
      render(<SavedViewsPanel {...defaultProps} savedViews={[mockView]} />);
      fireEvent.click(screen.getByLabelText('Options for My View'));
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('should call onDeleteView when delete clicked', () => {
      render(<SavedViewsPanel {...defaultProps} savedViews={[mockView]} />);
      fireEvent.click(screen.getByLabelText('Options for My View'));
      fireEvent.click(screen.getByText('Delete'));
      expect(defaultProps.onDeleteView).toHaveBeenCalledWith('view-1');
    });

    it('should show rename option in menu', () => {
      render(<SavedViewsPanel {...defaultProps} savedViews={[mockView]} />);
      fireEvent.click(screen.getByLabelText('Options for My View'));
      expect(screen.getByText('Rename')).toBeInTheDocument();
    });

    it('should show edit input when rename clicked', () => {
      render(<SavedViewsPanel {...defaultProps} savedViews={[mockView]} />);
      fireEvent.click(screen.getByLabelText('Options for My View'));
      fireEvent.click(screen.getByText('Rename'));
      expect(screen.getByLabelText('Edit view name')).toBeInTheDocument();
    });
  });

  describe('Share URL', () => {
    it('should show share button when filters are active', () => {
      render(<SavedViewsPanel {...defaultProps} hasActiveFilters />);
      expect(screen.getByTitle('Copy shareable URL')).toBeInTheDocument();
    });

    it('should not show share button when no active filters', () => {
      render(<SavedViewsPanel {...defaultProps} />);
      expect(screen.queryByTitle('Copy shareable URL')).not.toBeInTheDocument();
    });

    it('should call onCopyShareableUrl when share clicked', () => {
      render(<SavedViewsPanel {...defaultProps} hasActiveFilters />);
      fireEvent.click(screen.getByTitle('Copy shareable URL'));
      expect(defaultProps.onCopyShareableUrl).toHaveBeenCalled();
    });
  });
});
