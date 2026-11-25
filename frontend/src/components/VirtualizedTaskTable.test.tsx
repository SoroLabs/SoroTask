import React from 'react';
import { render, screen } from '@testing-library/react';
import { VirtualizedTaskTable, Task } from './VirtualizedTaskTable';

// Mock TanStack Virtualizer for DOM testing env
jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: jest.fn().mockReturnValue({
    getTotalSize: () => 520,
    getVirtualItems: () => [
      { key: '0', index: 0, start: 0, size: 52 },
      { key: '1', index: 1, start: 52, size: 52 },
    ],
  }),
}));

const MOCK_TASKS: Task[] = [
  {
    id: '1',
    title: 'Optimize Soroban Contract Call',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    assignee: 'm-yahay',
    createdAt: '2026-07-20T10:00:00Z',
  },
  {
    id: '2',
    title: 'Update Balance Reconciliation Cron',
    status: 'COMPLETED',
    priority: 'MEDIUM',
    assignee: 'm-yahay',
    createdAt: '2026-07-21T14:30:00Z',
  },
];

describe('VirtualizedTaskTable Component', () => {
  it('renders table headers correctly', () => {
    render(<VirtualizedTaskTable tasks={MOCK_TASKS} />);

    expect(screen.getByText('Task Title')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Priority')).toBeInTheDocument();
    expect(screen.getByText('Assignee')).toBeInTheDocument();
  });

  it('renders virtualized visible items', () => {
    render(<VirtualizedTaskTable tasks={MOCK_TASKS} />);

    expect(screen.getByText('Optimize Soroban Contract Call')).toBeInTheDocument();
    expect(screen.getByText('Update Balance Reconciliation Cron')).toBeInTheDocument();
  });
});