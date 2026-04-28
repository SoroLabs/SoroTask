/**
 * CalendarDay Component Responsive Tests
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CalendarDay from '@/components/CalendarDay';
import { Task } from '@/types/task';

// Mock date utilities
jest.mock('@/lib/dateUtils', () => ({
  isPastDate: jest.fn(() => false),
}));

const mockTask: Task = {
  id: 'task-1',
  contractAddress: 'CAAA...',
  functionName: 'harvest_yield',
  interval: 3600,
  gasBalance: 10,
  createdAt: new Date(),
  status: 'active',
};

const mockDate = new Date('2024-01-15');

describe('CalendarDay Responsive Design', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders calendar day with proper touch targets', () => {
    render(
      <CalendarDay
        date={mockDate}
        tasks={[mockTask]}
        isCurrentMonth={true}
        isToday={false}
        isSelected={false}
      />
    );

    // Check that the day number is displayed
    expect(screen.getByText('15')).toBeInTheDocument();

    // Check that task is displayed
    expect(screen.getByText('harvest_yield')).toBeInTheDocument();
  });

  it('handles single task display', () => {
    render(
      <CalendarDay
        date={mockDate}
        tasks={[mockTask]}
        isCurrentMonth={true}
        isToday={false}
        isSelected={false}
      />
    );

    // Should show the task function name
    expect(screen.getByText('harvest_yield')).toBeInTheDocument();
  });

  it('handles multiple tasks with expand button', () => {
    const multipleTasks = [mockTask, { ...mockTask, id: 'task-2', functionName: 'rebalance' }, { ...mockTask, id: 'task-3', functionName: 'claim' }];

    render(
      <CalendarDay
        date={mockDate}
        tasks={multipleTasks}
        isCurrentMonth={true}
        isToday={false}
        isSelected={false}
      />
    );

    // Should show "+2 more" button
    expect(screen.getByText('+2 more')).toBeInTheDocument();

    // Should show only first 2 tasks
    expect(screen.getByText('harvest_yield')).toBeInTheDocument();
    expect(screen.queryByText('claim')).not.toBeInTheDocument();
  });

  it('handles expand click interaction', () => {
    const multipleTasks = [mockTask, { ...mockTask, id: 'task-2' }, { ...mockTask, id: 'task-3' }];
    const mockOnExpand = jest.fn();

    render(
      <CalendarDay
        date={mockDate}
        tasks={multipleTasks}
        isCurrentMonth={true}
        isToday={false}
        isSelected={false}
        onExpandClick={mockOnExpand}
      />
    );

    const expandButton = screen.getByText('+2 more');
    fireEvent.click(expandButton);

    expect(mockOnExpand).toHaveBeenCalled();
  });

  it('handles task click interaction', () => {
    const mockOnTaskClick = jest.fn();

    render(
      <CalendarDay
        date={mockDate}
        tasks={[mockTask]}
        isCurrentMonth={true}
        isToday={false}
        isSelected={false}
        onTaskClick={mockOnTaskClick}
      />
    );

    const taskElement = screen.getByText('harvest_yield');
    fireEvent.click(taskElement);

    expect(mockOnTaskClick).toHaveBeenCalledWith(mockTask);
  });

  it('applies correct styling for different states', () => {
    const { rerender } = render(
      <CalendarDay
        date={mockDate}
        tasks={[mockTask]}
        isCurrentMonth={true}
        isToday={true}
        isSelected={false}
      />
    );

    // Today should have special styling
    const dayButton = screen.getByRole('button');
    expect(dayButton).toHaveClass('ring-2');

    rerender(
      <CalendarDay
        date={mockDate}
        tasks={[mockTask]}
        isCurrentMonth={true}
        isToday={false}
        isSelected={true}
      />
    );

    // Selected should have different background
    expect(dayButton).toHaveClass('bg-neutral-700/50');
  });

  it('shows proper accessibility labels', () => {
    render(
      <CalendarDay
        date={mockDate}
        tasks={[mockTask]}
        isCurrentMonth={true}
        isToday={false}
        isSelected={false}
      />
    );

    const dayButton = screen.getByRole('button');
    expect(dayButton).toHaveAttribute('aria-label', expect.stringContaining('15'));
    expect(dayButton).toHaveAttribute('aria-label', expect.stringContaining('1 tasks'));
  });
});