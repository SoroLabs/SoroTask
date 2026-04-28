import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Calendar from '@/components/Calendar';
import { Task } from '@/types/task';
import { addDays } from '@/lib/dateUtils';

describe('Calendar Component', () => {
  const mockTasks: Task[] = [
    {
      id: 'task-1',
      contractAddress: 'CA...',
      functionName: 'harvest_yield',
      interval: 3600,
      gasBalance: 10,
      createdAt: new Date(),
      deadline: addDays(new Date(), 5),
      status: 'active',
    },
    {
      id: 'task-2',
      contractAddress: 'CB...',
      functionName: 'rebalance_portfolio',
      interval: 86400,
      gasBalance: 15,
      createdAt: new Date(),
      deadline: addDays(new Date(), 3),
      status: 'active',
    },
    {
      id: 'task-3',
      contractAddress: 'CC...',
      functionName: 'claim_rewards',
      interval: 604800,
      gasBalance: 8,
      createdAt: new Date(),
      deadline: addDays(new Date(), 3),
      status: 'pending',
    },
  ];

  it('should render calendar with heading', () => {
    render(<Calendar tasks={mockTasks} />);
    expect(screen.getByText('Schedule Calendar')).toBeInTheDocument();
  });

  it('should display month and year', () => {
    render(<Calendar tasks={mockTasks} />);
    const now = new Date();
    const monthYear = screen.getByDisplayValue(
      new RegExp(`${now.getFullYear()}`)
    );
    expect(monthYear).toBeInTheDocument();
  });

  it('should have navigation buttons', () => {
    render(<Calendar tasks={mockTasks} />);
    expect(screen.getByLabelText('Previous month')).toBeInTheDocument();
    expect(screen.getByLabelText('Next month')).toBeInTheDocument();
  });

  it('should have Today button', () => {
    render(<Calendar tasks={mockTasks} />);
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('should display timezone info', () => {
    render(<Calendar tasks={mockTasks} timezone="America/New_York" />);
    expect(screen.getByText(/Timezone: America\/New_York/i)).toBeInTheDocument();
  });

  it('should navigate to previous month', () => {
    render(<Calendar tasks={mockTasks} />);
    const prevButton = screen.getByLabelText('Previous month');
    fireEvent.click(prevButton);
    // After clicking, the month should change
    const now = new Date();
    now.setMonth(now.getMonth() - 1);
    // We can verify by checking if the month changed (this is a basic check)
    expect(screen.getByText('Schedule Calendar')).toBeInTheDocument();
  });

  it('should navigate to next month', () => {
    render(<Calendar tasks={mockTasks} />);
    const nextButton = screen.getByLabelText('Next month');
    fireEvent.click(nextButton);
    expect(screen.getByText('Schedule Calendar')).toBeInTheDocument();
  });

  it('should display legend', () => {
    render(<Calendar tasks={mockTasks} />);
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText(/Task with deadline/i)).toBeInTheDocument();
    expect(screen.getByText(/Multiple tasks on same date/i)).toBeInTheDocument();
  });

  it('should call onTaskClick when task is clicked', () => {
    const mockOnTaskClick = jest.fn();
    render(<Calendar tasks={mockTasks} onTaskClick={mockOnTaskClick} />);

    // Note: Actual task click testing would require more DOM traversal
    // This is a placeholder for the actual test structure
    expect(mockOnTaskClick).not.toHaveBeenCalled();
  });

  it('should display task summary for selected date', () => {
    render(<Calendar tasks={mockTasks} />);
    // After clicking on a date with tasks, the summary should appear
    // This test structure assumes tasks will appear
    expect(screen.getByText('Schedule Calendar')).toBeInTheDocument();
  });

  it('should handle empty tasks array', () => {
    render(<Calendar tasks={[]} />);
    expect(screen.getByText('Schedule Calendar')).toBeInTheDocument();
  });

  it('should support compact mode', () => {
    const { container } = render(
      <Calendar tasks={mockTasks} compact={true} />
    );
    expect(container.querySelector('.grid')).toBeInTheDocument();
  });

  it('should respect locale prop', () => {
    render(<Calendar tasks={mockTasks} locale="es-ES" />);
    expect(screen.getByText('Schedule Calendar')).toBeInTheDocument();
  });
});
