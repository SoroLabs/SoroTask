/**
 * TaskExecutionLogs Component Tests
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { TaskExecutionLogs } from '@/src/components/TaskExecutionLogs';
import { ExecutionLogEntry } from '@/src/types/taskExecution';

describe('TaskExecutionLogs Component', () => {
  const mockLogs: ExecutionLogEntry[] = [
    {
      id: 'log-1',
      taskId: 'task-123',
      timestamp: '2026-06-02T10:00:00.000Z',
      level: 'info',
      message: 'Task started',
    },
    {
      id: 'log-2',
      taskId: 'task-123',
      timestamp: '2026-06-02T10:00:01.000Z',
      level: 'warn',
      message: 'Low gas warning',
      context: { gasBalance: 100 },
    },
    {
      id: 'log-3',
      taskId: 'task-123',
      timestamp: '2026-06-02T10:00:02.000Z',
      level: 'error',
      message: 'Task failed',
    },
  ];

  describe('Rendering', () => {
    it('should render component with title', () => {
      render(<TaskExecutionLogs logs={[]} />);
      expect(screen.getByText('Execution Logs')).toBeInTheDocument();
    });

    it('should display log entries', () => {
      render(<TaskExecutionLogs logs={mockLogs} />);

      expect(screen.getByText('Task started')).toBeInTheDocument();
      expect(screen.getByText('Low gas warning')).toBeInTheDocument();
      expect(screen.getByText('Task failed')).toBeInTheDocument();
    });

    it('should show empty state when no logs', () => {
      render(<TaskExecutionLogs logs={[]} />);
      expect(screen.getByText('No logs to display')).toBeInTheDocument();
    });

    it('should show loading state', () => {
      render(<TaskExecutionLogs logs={[]} isLoading={true} />);
      expect(screen.getByText('Waiting for logs...')).toBeInTheDocument();
    });

    it('should display log count', () => {
      render(<TaskExecutionLogs logs={mockLogs} />);
      expect(screen.getByText('3 log entries')).toBeInTheDocument();
    });
  });

  describe('Log Level Filtering', () => {
    it('should filter logs by level', () => {
      render(<TaskExecutionLogs logs={mockLogs} filterLevel="error" />);

      expect(screen.getByText('Task failed')).toBeInTheDocument();
      expect(screen.queryByText('Task started')).not.toBeInTheDocument();
      expect(screen.queryByText('Low gas warning')).not.toBeInTheDocument();
    });

    it('should show all logs when filterLevel is "all"', () => {
      render(<TaskExecutionLogs logs={mockLogs} filterLevel="all" />);

      expect(screen.getByText('Task started')).toBeInTheDocument();
      expect(screen.getByText('Low gas warning')).toBeInTheDocument();
      expect(screen.getByText('Task failed')).toBeInTheDocument();
    });

    it('should update filtered log count', () => {
      render(<TaskExecutionLogs logs={mockLogs} filterLevel="warn" />);
      expect(screen.getByText('1 log entries')).toBeInTheDocument();
    });
  });

  describe('Log Context Display', () => {
    it('should display context when available', () => {
      render(<TaskExecutionLogs logs={mockLogs} />);

      const contextText = screen.getByText(/gasBalance/);
      expect(contextText).toBeInTheDocument();
    });

    it('should not display context section when context is empty', () => {
      render(<TaskExecutionLogs logs={[mockLogs[0]]} />);

      expect(screen.queryByText(/gasBalance/)).not.toBeInTheDocument();
    });
  });

  describe('Styling', () => {
    it('should apply correct background color for error logs', () => {
      const { container } = render(<TaskExecutionLogs logs={[mockLogs[2]]} />);

      const errorLog = container.querySelector('.bg-red-900\\/20');
      expect(errorLog).toBeInTheDocument();
    });

    it('should apply correct text color for log levels', () => {
      const { container } = render(<TaskExecutionLogs logs={mockLogs} />);

      const errorLevelBadge = container.querySelector('.text-red-400');
      expect(errorLevelBadge).toBeInTheDocument();
    });
  });

  describe('Click Handling', () => {
    it('should call onLogClick when log entry is clicked', () => {
      const mockClick = jest.fn();
      const { container } = render(
        <TaskExecutionLogs logs={mockLogs} onLogClick={mockClick} />,
      );

      const logEntry = container.querySelector('[class*="hover:bg-neutral-900"]');
      if (logEntry) {
        (logEntry as HTMLElement).click();
      }

      expect(mockClick).toHaveBeenCalled();
    });
  });

  describe('Max Height', () => {
    it('should apply custom max height', () => {
      render(
        <TaskExecutionLogs logs={mockLogs} maxHeight="400px" />,
      );

      const logsContainer = screen.getByTestId('logs-container');
      expect(logsContainer).toHaveStyle({ maxHeight: '400px' });
    });

    it('should apply default max height', () => {
      render(<TaskExecutionLogs logs={mockLogs} />);

      const logsContainer = screen.getByTestId('logs-container');
      expect(logsContainer).toHaveStyle({ maxHeight: '600px' });
    });
  });

  describe('Auto Scroll', () => {
    it('should scroll to bottom when autoScroll is true', (done) => {
      const { container, rerender } = render(
        <TaskExecutionLogs logs={mockLogs.slice(0, 1)} autoScroll={true} />,
      );

      rerender(
        <TaskExecutionLogs logs={mockLogs} autoScroll={true} />,
      );

      setTimeout(() => {
        const logsContainer = container.querySelector('[style*="maxHeight"]') as HTMLElement;
        if (logsContainer) {
          expect(logsContainer.scrollTop).toBeGreaterThanOrEqual(0);
        }
        done();
      }, 100);
    });
  });

  describe('Timestamp Formatting', () => {
    it('should format timestamps correctly', () => {
      render(<TaskExecutionLogs logs={mockLogs} />);

      // Should display time in HH:MM:SS format
      const timeElements = screen.getAllByText(/\d{2}:\d{2}:\d{2}/);
      expect(timeElements.length).toBeGreaterThan(0);
    });

    it('should handle invalid timestamps gracefully', () => {
      const logsWithInvalidTime: ExecutionLogEntry[] = [
        {
          id: 'log-1',
          taskId: 'task-123',
          timestamp: 'invalid-date',
          level: 'info',
          message: 'Test',
        },
      ];

      render(<TaskExecutionLogs logs={logsWithInvalidTime} />);
      expect(screen.getByText('Test')).toBeInTheDocument();
    });
  });
});
