import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SearchFilterPanel } from '@/components/SearchFilterPanel';
import type { TaskFilters } from '@/types/search';

// Use fake timers for debounce
jest.useFakeTimers();

describe('SearchFilterPanel', () => {
  const mockOnFilterChange = jest.fn();
  const mockOnClearAll = jest.fn();

  const defaultProps = {
    filters: {} as TaskFilters,
    onFilterChange: mockOnFilterChange,
    onClearAll: mockOnClearAll,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe('Search input', () => {
    it('should render search input', () => {
      render(<SearchFilterPanel {...defaultProps} />);
      expect(screen.getByPlaceholderText('Search tasks...')).toBeInTheDocument();
    });

    it('should have accessible label', () => {
      render(<SearchFilterPanel {...defaultProps} />);
      expect(screen.getByLabelText('Search tasks')).toBeInTheDocument();
    });

    it('should debounce search input', async () => {
      render(<SearchFilterPanel {...defaultProps} />);
      const input = screen.getByPlaceholderText('Search tasks...');
      fireEvent.change(input, { target: { value: 'harvest' } });
      expect(mockOnFilterChange).not.toHaveBeenCalled();
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(mockOnFilterChange).toHaveBeenCalledWith('query', 'harvest');
    });

    it('should show clear button when search has value', () => {
      render(<SearchFilterPanel {...defaultProps} filters={{ query: 'test' }} />);
      expect(screen.getByLabelText('Clear search')).toBeInTheDocument();
    });

    it('should not show clear button when search is empty', () => {
      render(<SearchFilterPanel {...defaultProps} />);
      expect(screen.queryByLabelText('Clear search')).not.toBeInTheDocument();
    });

    it('should clear search when clear button clicked', () => {
      render(<SearchFilterPanel {...defaultProps} filters={{ query: 'test' }} />);
      fireEvent.click(screen.getByLabelText('Clear search'));
      expect(mockOnFilterChange).toHaveBeenCalledWith('query', undefined);
    });
  });

  describe('Status filter', () => {
    it('should render status dropdown', () => {
      render(<SearchFilterPanel {...defaultProps} />);
      expect(screen.getByText('Status')).toBeInTheDocument();
    });

    it('should open status dropdown on click', () => {
      render(<SearchFilterPanel {...defaultProps} />);
      fireEvent.click(screen.getByText('Status'));
      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getByText('Paused')).toBeInTheDocument();
      expect(screen.getByText('Completed')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
    });

    it('should call onFilterChange when status selected', () => {
      render(<SearchFilterPanel {...defaultProps} />);
      fireEvent.click(screen.getByText('Status'));
      fireEvent.click(screen.getByText('Active'));
      expect(mockOnFilterChange).toHaveBeenCalledWith('status', ['active']);
    });

    it('should show count badge when statuses selected', () => {
      render(<SearchFilterPanel {...defaultProps} filters={{ status: ['active', 'paused'] }} />);
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  describe('Priority filter', () => {
    it('should render priority dropdown', () => {
      render(<SearchFilterPanel {...defaultProps} />);
      expect(screen.getByText('Priority')).toBeInTheDocument();
    });

    it('should open priority dropdown on click', () => {
      render(<SearchFilterPanel {...defaultProps} />);
      fireEvent.click(screen.getByText('Priority'));
      expect(screen.getByText('Critical')).toBeInTheDocument();
      expect(screen.getByText('High')).toBeInTheDocument();
      expect(screen.getByText('Medium')).toBeInTheDocument();
      expect(screen.getByText('Low')).toBeInTheDocument();
    });
  });

  describe('Assignee filter', () => {
    it('should render assignee dropdown', () => {
      render(<SearchFilterPanel {...defaultProps} />);
      expect(screen.getByText('Assignee')).toBeInTheDocument();
    });
  });

  describe('Label filter', () => {
    it('should render label dropdown', () => {
      render(<SearchFilterPanel {...defaultProps} />);
      expect(screen.getByText('Label')).toBeInTheDocument();
    });
  });

  describe('Date range filter', () => {
    it('should render date from input', () => {
      render(<SearchFilterPanel {...defaultProps} />);
      expect(screen.getByLabelText('Due date from')).toBeInTheDocument();
    });

    it('should call onFilterChange when date from changes', () => {
      render(<SearchFilterPanel {...defaultProps} />);
      fireEvent.change(screen.getByLabelText('Due date from'), {
        target: { value: '2024-01-15' },
      });
      expect(mockOnFilterChange).toHaveBeenCalledWith('dueDateFrom', '2024-01-15');
    });

    it('should show date to input when date from is set', () => {
      render(<SearchFilterPanel {...defaultProps} filters={{ dueDateFrom: '2024-01-15' }} />);
      expect(screen.getByLabelText('Due date to')).toBeInTheDocument();
    });

    it('should not show date to input when date from is not set', () => {
      render(<SearchFilterPanel {...defaultProps} />);
      expect(screen.queryByLabelText('Due date to')).not.toBeInTheDocument();
    });
  });

  describe('Clear all', () => {
    it('should show clear all button when any filter is active', () => {
      render(<SearchFilterPanel {...defaultProps} filters={{ query: 'test' }} />);
      act(() => {
        jest.advanceTimersByTime(300);
      });
      // The clear all button appears when hasAnyFilter is true
      // Since query is set in filters prop, it should show
      expect(screen.getByText('Clear all')).toBeInTheDocument();
    });

    it('should not show clear all button when no filters', () => {
      render(<SearchFilterPanel {...defaultProps} />);
      expect(screen.queryByText('Clear all')).not.toBeInTheDocument();
    });

    it('should call onClearAll when clear all clicked', () => {
      render(<SearchFilterPanel {...defaultProps} filters={{ status: ['active'] }} />);
      fireEvent.click(screen.getByText('Clear all'));
      expect(mockOnClearAll).toHaveBeenCalled();
    });
  });

  describe('Multi-select deselection', () => {
    it('should deselect option when clicked again', () => {
      render(<SearchFilterPanel {...defaultProps} filters={{ status: ['active'] }} />);
      fireEvent.click(screen.getByText('Status'));
      fireEvent.click(screen.getByText('Active'));
      expect(mockOnFilterChange).toHaveBeenCalledWith('status', undefined);
    });
  });
});
