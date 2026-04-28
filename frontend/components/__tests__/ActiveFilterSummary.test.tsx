import { render, screen, fireEvent } from '@testing-library/react';
import { ActiveFilterSummary } from '@/components/ActiveFilterSummary';
import type { ActiveFilter } from '@/types/search';

describe('ActiveFilterSummary', () => {
  const mockFilters: ActiveFilter[] = [
    { id: 'filter-0', field: 'query', label: 'Search', displayValue: 'harvest' },
    { id: 'filter-1', field: 'status', label: 'Status', displayValue: 'active, paused' },
  ];

  const mockOnRemove = jest.fn();
  const mockOnClearAll = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render nothing when no active filters', () => {
    const { container } = render(
      <ActiveFilterSummary activeFilters={[]} onRemoveFilter={mockOnRemove} onClearAll={mockOnClearAll} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('should render filter chips', () => {
    render(
      <ActiveFilterSummary activeFilters={mockFilters} onRemoveFilter={mockOnRemove} onClearAll={mockOnClearAll} />
    );
    expect(screen.getByText('harvest')).toBeInTheDocument();
    expect(screen.getByText('active, paused')).toBeInTheDocument();
  });

  it('should show filter labels', () => {
    render(
      <ActiveFilterSummary activeFilters={mockFilters} onRemoveFilter={mockOnRemove} onClearAll={mockOnClearAll} />
    );
    expect(screen.getByText('Search:')).toBeInTheDocument();
    expect(screen.getByText('Status:')).toBeInTheDocument();
  });

  it('should call onRemoveFilter when remove button clicked', () => {
    render(
      <ActiveFilterSummary activeFilters={mockFilters} onRemoveFilter={mockOnRemove} onClearAll={mockOnClearAll} />
    );
    fireEvent.click(screen.getByLabelText('Remove Search filter'));
    expect(mockOnRemove).toHaveBeenCalledWith('filter-0');
  });

  it('should show clear all button when multiple filters', () => {
    render(
      <ActiveFilterSummary activeFilters={mockFilters} onRemoveFilter={mockOnRemove} onClearAll={mockOnClearAll} />
    );
    expect(screen.getByText('Clear all')).toBeInTheDocument();
  });

  it('should not show clear all button for single filter', () => {
    render(
      <ActiveFilterSummary
        activeFilters={[mockFilters[0]]}
        onRemoveFilter={mockOnRemove}
        onClearAll={mockOnClearAll}
      />
    );
    expect(screen.queryByText('Clear all')).not.toBeInTheDocument();
  });

  it('should call onClearAll when clear all clicked', () => {
    render(
      <ActiveFilterSummary activeFilters={mockFilters} onRemoveFilter={mockOnRemove} onClearAll={mockOnClearAll} />
    );
    fireEvent.click(screen.getByText('Clear all'));
    expect(mockOnClearAll).toHaveBeenCalled();
  });

  it('should have accessible group label', () => {
    render(
      <ActiveFilterSummary activeFilters={mockFilters} onRemoveFilter={mockOnRemove} onClearAll={mockOnClearAll} />
    );
    expect(screen.getByRole('group', { name: 'Active filters' })).toBeInTheDocument();
  });
});
