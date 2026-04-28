import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SuggestionsPopover } from '../components/SuggestionsPopover';
import { MentionableEntity } from '../types/mentions';

const mockEntities: MentionableEntity[] = [
  { id: 'user-1', type: 'user', displayName: 'Alice Johnson', avatar: 'AJ' },
  { id: 'user-2', type: 'user', displayName: 'Bob Smith', avatar: 'BS' },
];

describe('SuggestionsPopover', () => {
  const mockOnSelect = jest.fn();
  const mockOnClose = jest.fn();

  beforeEach(() => {
    mockOnSelect.mockClear();
    mockOnClose.mockClear();
  });

  it('renders suggestions with avatars and metadata', () => {
    render(
      <SuggestionsPopover
        suggestions={mockEntities}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        position={{ top: 100, left: 50 }}
      />
    );

    expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
    expect(screen.getByText('USER')).toBeInTheDocument();
  });

  it('highlights selected suggestion', () => {
    render(
      <SuggestionsPopover
        suggestions={mockEntities}
        selectedIndex={1}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        position={{ top: 100, left: 50 }}
      />
    );

    const bobItem = screen.getByText('Bob Smith').closest('div');
    expect(bobItem).toHaveClass('bg-neutral-700');
  });

  it('calls onSelect when suggestion is clicked', () => {
    render(
      <SuggestionsPopover
        suggestions={mockEntities}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        position={{ top: 100, left: 50 }}
      />
    );

    fireEvent.click(screen.getByText('Alice Johnson'));
    expect(mockOnSelect).toHaveBeenCalledWith(mockEntities[0]);
  });

  it('shows loading state', () => {
    render(
      <SuggestionsPopover
        suggestions={[]}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        position={{ top: 100, left: 50 }}
        isLoading={true}
      />
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows error state', () => {
    render(
      <SuggestionsPopover
        suggestions={[]}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        position={{ top: 100, left: 50 }}
        error="Failed to load"
      />
    );

    expect(screen.getByText('Failed to load')).toBeInTheDocument();
  });

  it('does not render when no suggestions and not loading/error', () => {
    const { container } = render(
      <SuggestionsPopover
        suggestions={[]}
        selectedIndex={0}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        position={{ top: 100, left: 50 }}
      />
    );

    expect(container.firstChild).toBeNull();
  });
});