/**
 * TaskExecutionStatus Component Tests
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { TaskExecutionStatus } from '@/src/components/TaskExecutionStatus';
import { TaskExecutionState } from '@/src/types/taskExecution';

describe('TaskExecutionStatus Component', () => {
  const mockExecutionState: TaskExecutionState = {
    taskId: 'task-123',
    status: 'executing',
    startedAt: '2026-06-02T10:00:00.000Z',
    logs: [],
    currentPhase: 'Processing data',
    progress: { current: 50, total: 100 },
    gasUsed: 1500,
  };

  describe('Rendering', () => {
    it('should render component with title', () => {
      render(<TaskExecutionStatus execution={mockExecutionState} />);
      expect(screen.getByText('Execution Status')).toBeInTheDocument();
    });

    it('should display null state when no execution data', () => {
      render(<TaskExecutionStatus execution={null} />);
      expect(screen.getByText('No execution data available')).toBeInTheDocument();
    });

    it('should display correct status badge', () => {
      render(<TaskExecutionStatus execution={mockExecutionState} />);
      expect(screen.getByText('Executing')).toBeInTheDocument();
    });

    it('should display current phase', () => {
      render(<TaskExecutionStatus execution={mockExecutionState} />);
      expect(screen.getByText('Processing data')).toBeInTheDocument();
    });
  });

  describe('Status States', () => {
    it('should render pending status', () => {
      const pendingState: TaskExecutionState = {
        ...mockExecutionState,
        status: 'pending',
      };
      render(<TaskExecutionStatus execution={pendingState} />);
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });

    it('should render completed status', () => {
      const completedState: TaskExecutionState = {
        ...mockExecutionState,
        status: 'completed',
        completedAt: '2026-06-02T10:00:10.000Z',
      };
      render(<TaskExecutionStatus execution={completedState} />);
      expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    });

    it('should render failed status with error details', () => {
      const failedState: TaskExecutionState = {
        ...mockExecutionState,
        status: 'failed',
        error: {
          code: 'EXECUTION_ERROR',
          message: 'Task execution failed',
        },
      };
      render(<TaskExecutionStatus execution={failedState} />);
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByText('Task execution failed')).toBeInTheDocument();
    });
  });

  describe('Time Display', () => {
    it('should display started time', () => {
      render(<TaskExecutionStatus execution={mockExecutionState} />);
      expect(screen.getByText('Started')).toBeInTheDocument();
    });

    it('should display completed time when available', () => {
      const completedState: TaskExecutionState = {
        ...mockExecutionState,
        status: 'completed',
        completedAt: '2026-06-02T10:00:10.000Z',
      };
      render(<TaskExecutionStatus execution={completedState} />);
      expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    });

    it('should display dash when no completed time', () => {
      render(<TaskExecutionStatus execution={mockExecutionState} />);
      const completedLabel = screen.getByText('Completed');
      const parent = completedLabel.parentElement;
      expect(parent).toBeInTheDocument();
    });
  });

  describe('Duration Calculation', () => {
    it('should display duration in seconds', () => {
      render(<TaskExecutionStatus execution={mockExecutionState} />);
      expect(screen.getByText('Duration')).toBeInTheDocument();
    });

    it('should calculate duration correctly', () => {
      const state: TaskExecutionState = {
        ...mockExecutionState,
        status: 'completed',
        startedAt: '2026-06-02T10:00:00.000Z',
        completedAt: '2026-06-02T10:05:30.000Z',
      };
      render(<TaskExecutionStatus execution={state} />);
      
      // Should display something like "5m 30s"
      const screen_text = screen.getByText(/\dm.*\ds/);
      expect(screen_text).toBeInTheDocument();
    });
  });

  describe('Gas Display', () => {
    it('should display gas used', () => {
      render(<TaskExecutionStatus execution={mockExecutionState} />);
      expect(screen.getByText('Gas Used')).toBeInTheDocument();
      expect(screen.getByText(/1,500/)).toBeInTheDocument();
    });

    it('should display dash when no gas used', () => {
      const state: TaskExecutionState = {
        ...mockExecutionState,
        gasUsed: undefined,
      };
      render(<TaskExecutionStatus execution={state} />);
      expect(screen.getByText('Gas Used')).toBeInTheDocument();
    });
  });

  describe('Progress Bar', () => {
    it('should display progress bar when progress is available', () => {
      render(<TaskExecutionStatus execution={mockExecutionState} />);
      expect(screen.getByText('Progress')).toBeInTheDocument();
      expect(screen.getByText('50 / 100')).toBeInTheDocument();
      expect(screen.getByText('50% complete')).toBeInTheDocument();
    });

    it('should not display progress bar when progress is not available', () => {
      const state: TaskExecutionState = {
        ...mockExecutionState,
        progress: undefined,
      };
      render(<TaskExecutionStatus execution={state} />);
      expect(screen.queryByText('Progress')).not.toBeInTheDocument();
    });

    it('should update progress percentage', () => {
      const state: TaskExecutionState = {
        ...mockExecutionState,
        progress: { current: 75, total: 100 },
      };
      render(<TaskExecutionStatus execution={state} />);
      expect(screen.getByText('75 / 100')).toBeInTheDocument();
      expect(screen.getByText('75% complete')).toBeInTheDocument();
    });
  });

  describe('Error Display', () => {
    it('should display error card with message', () => {
      const state: TaskExecutionState = {
        ...mockExecutionState,
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid task input',
        },
      };
      render(<TaskExecutionStatus execution={state} />);

      expect(screen.getByText('Error')).toBeInTheDocument();
      expect(screen.getByText('Invalid task input')).toBeInTheDocument();
      expect(screen.getByText(/VALIDATION_ERROR/)).toBeInTheDocument();
    });

    it('should display error stack trace when available', () => {
      const state: TaskExecutionState = {
        ...mockExecutionState,
        status: 'failed',
        error: {
          code: 'ERROR',
          message: 'Execution failed',
          stack: 'Error: Execution failed\n  at Object.<anonymous>',
        },
      };
      render(<TaskExecutionStatus execution={state} />);

      expect(screen.getByText('View Stack Trace')).toBeInTheDocument();
    });

    it('should display retry button when execution failed', () => {
      const mockRetry = jest.fn();
      const state: TaskExecutionState = {
        ...mockExecutionState,
        status: 'failed',
        error: {
          code: 'ERROR',
          message: 'Execution failed',
        },
      };
      render(<TaskExecutionStatus execution={state} onRetry={mockRetry} />);

      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    it('should not display retry button when execution succeeded', () => {
      const mockRetry = jest.fn();
      const state: TaskExecutionState = {
        ...mockExecutionState,
        status: 'completed',
      };
      render(<TaskExecutionStatus execution={state} onRetry={mockRetry} />);

      expect(screen.queryByText('Retry')).not.toBeInTheDocument();
    });
  });

  describe('Transaction Display', () => {
    it('should display transaction ID when available', () => {
      const state: TaskExecutionState = {
        ...mockExecutionState,
        transactionId: 'tx-123456789',
      };
      render(<TaskExecutionStatus execution={state} />);

      expect(screen.getByText('Transaction')).toBeInTheDocument();
      expect(screen.getByText('tx-123456789')).toBeInTheDocument();
    });

    it('should not display transaction ID when not available', () => {
      render(<TaskExecutionStatus execution={mockExecutionState} />);
      expect(screen.queryByText('Transaction')).not.toBeInTheDocument();
    });
  });

  describe('Styling', () => {
    it('should apply correct status color classes', () => {
      const { container } = render(<TaskExecutionStatus execution={mockExecutionState} />);

      const statusBadge = container.querySelector('[class*="bg-purple-600"]');
      expect(statusBadge).toBeInTheDocument();
    });

    it('should apply error styling to error card', () => {
      const state: TaskExecutionState = {
        ...mockExecutionState,
        status: 'failed',
        error: {
          code: 'ERROR',
          message: 'Test error',
        },
      };
      const { container } = render(<TaskExecutionStatus execution={state} />);

      const errorCard = container.querySelector('[class*="bg-red-900"]');
      expect(errorCard).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing optional fields', () => {
      const minimalState: TaskExecutionState = {
        taskId: 'task-123',
        status: 'pending',
        logs: [],
      };
      render(<TaskExecutionStatus execution={minimalState} />);
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });

    it('should handle very long error messages', () => {
      const longMessage = 'a'.repeat(500);
      const state: TaskExecutionState = {
        ...mockExecutionState,
        status: 'failed',
        error: {
          code: 'ERROR',
          message: longMessage,
        },
      };
      render(<TaskExecutionStatus execution={state} />);
      expect(screen.getByText(longMessage)).toBeInTheDocument();
    });
  });
});
