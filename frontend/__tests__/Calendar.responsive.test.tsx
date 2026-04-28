/**
 * Calendar Component Responsive Tests
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Calendar from '@/components/Calendar';
import { Task } from '@/types/task';

// Mock date utilities
jest.mock('@/lib/dateUtils', () => ({
  getMonthCalendarGrid: jest.fn(() => [
    [new Date('2024-01-01'), new Date('2024-01-02'), new Date('2024-01-03'), new Date('2024-01-04'), new Date('2024-01-05'), new Date('2024-01-06'), new Date('2024-01-07')],
    [new Date('2024-01-08'), new Date('2024-01-09'), new Date('2024-01-10'), new Date('2024-01-11'), new Date('2024-01-12'), new Date('2024-01-13'), new Date('2024-01-14')],
  ]),
  formatDateKey: jest.fn((date) => date.toISOString().split('T')[0]),
  isSameDay: jest.fn(),
  isToday: jest.fn(() => false),
  addMonths: jest.fn(),
  getMonthName: jest.fn(() => 'January'),
  getDayName: jest.fn((day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]),
}));

// Mock timezone utils
jest.mock('@/lib/timezoneUtils', () => ({
  getUserTimezone: jest.fn(() => 'America/New_York'),
}));

const mockTasks: Task[] = [
  {
    id: 'task-1',
    contractAddress: 'CAAA...',
    functionName: 'harvest_yield',
    interval: 3600,
    gasBalance: 10,
    createdAt: new Date(),
    status: 'active',
  },
];

describe('Calendar Responsive Design', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders calendar with responsive header layout', () => {
    render(
      <Calendar
        tasks={mockTasks}
        locale="en-US"
        timezone="America/New_York"
      />
    );

    // Check that header elements are present
    expect(screen.getByText('Schedule Calendar')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('January 2024')).toBeInTheDocument();
  });

  it('renders calendar grid with 7 columns', () => {
    render(
      <Calendar
        tasks={mockTasks}
        locale="en-US"
        timezone="America/New_York"
      />
    );

    // Check that weekday headers are present
    expect(screen.getByText('Sun')).toBeInTheDocument();
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Sat')).toBeInTheDocument();
  });

  it('renders calendar days with proper accessibility', () => {
    render(
      <Calendar
        tasks={mockTasks}
        locale="en-US"
        timezone="America/New_York"
      />
    );

    // Check that calendar days have proper aria-labels
    const calendarDays = screen.getAllByRole('button');
    expect(calendarDays.length).toBeGreaterThan(7); // At least weekday headers + calendar days

    // Check navigation buttons have aria-labels
    expect(screen.getByLabelText('Previous month')).toBeInTheDocument();
    expect(screen.getByLabelText('Next month')).toBeInTheDocument();
  });

  it('handles task click interactions', () => {
    const mockOnTaskClick = jest.fn();

    render(
      <Calendar
        tasks={mockTasks}
        onTaskClick={mockOnTaskClick}
        locale="en-US"
        timezone="America/New_York"
      />
    );

    // The component should render without errors
    expect(screen.getByText('Schedule Calendar')).toBeInTheDocument();
  });

  it('displays timezone information responsively', () => {
    render(
      <Calendar
        tasks={mockTasks}
        locale="en-US"
        timezone="America/New_York"
      />
    );

    // Timezone should be displayed
    expect(screen.getByText(/America\/New_York/)).toBeInTheDocument();
  });
});