import React from 'react';
import { render, screen } from '@testing-library/react';
import { ExecutionTraceViewer } from './ExecutionTraceViewer';
import {
  ExecutionTrace,
  ExecutionStepType,
} from '@/src/types/taskExecution';

const mockTrace: ExecutionTrace = {
  task_id: '1',
  keeper: 'GA4Q4W6J5X7K5Z6Q7Y4W6J5X7K5Z6Q7Y4W6J5X7K5',
  timestamp: '1719360000',
  steps: [
    { step: ExecutionStepType.ValidateAuth, result: 'Passed', detail: 0 },
    { step: ExecutionStepType.LoadTask, result: 'Passed', detail: 0 },
    { step: ExecutionStepType.CheckActive, result: 'Passed', detail: 0 },
    { step: ExecutionStepType.CheckWhitelist, result: 'Passed', detail: 0 },
    { step: ExecutionStepType.CheckInterval, result: 'Passed', detail: 0 },
    { step: ExecutionStepType.CheckDependencies, result: 'Passed', detail: 0 },
    { step: ExecutionStepType.EvaluateResolver, result: 'Failed', detail: 0 },
  ],
  final_outcome: 'Failed',
};

describe('ExecutionTraceViewer', () => {
  it('renders empty state when trace is null', () => {
    render(<ExecutionTraceViewer trace={null} />);
    expect(screen.getByText('No execution trace available')).toBeInTheDocument();
  });

  it('renders loading state when isLoading is true', () => {
    const { container } = render(<ExecutionTraceViewer trace={null} isLoading />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders trace header with keeper and outcome', () => {
    render(<ExecutionTraceViewer trace={mockTrace} />);
    expect(screen.getByText('Execution Trace')).toBeInTheDocument();
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
  });

  it('renders all steps from the trace', () => {
    render(<ExecutionTraceViewer trace={mockTrace} />);
    expect(screen.getByText('Validate Authorization')).toBeInTheDocument();
    expect(screen.getByText('Load Task Configuration')).toBeInTheDocument();
    expect(screen.getByText('Check Task Active')).toBeInTheDocument();
    expect(screen.getByText('Check Keeper Whitelist')).toBeInTheDocument();
    expect(screen.getByText('Check Execution Interval')).toBeInTheDocument();
    expect(screen.getByText('Check Dependencies')).toBeInTheDocument();
    expect(screen.getByText('Evaluate Resolver Condition')).toBeInTheDocument();
  });

  it('highlights the failed step', () => {
    render(<ExecutionTraceViewer trace={mockTrace} />);
    const failedElements = screen.getAllByText('Failed');
    expect(failedElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Execution Failed')).toBeInTheDocument();
  });

  it('shows passed status for successful steps', () => {
    render(<ExecutionTraceViewer trace={mockTrace} />);
    const passedElements = screen.getAllByText('Passed');
    expect(passedElements.length).toBeGreaterThanOrEqual(6);
  });

  it('renders steps count in header', () => {
    render(<ExecutionTraceViewer trace={mockTrace} />);
    expect(screen.getAllByText('7').length).toBeGreaterThan(0);
  });

  it('renders legend with Passed, Failed, Skipped', () => {
    render(<ExecutionTraceViewer trace={mockTrace} />);
    expect(screen.getAllByText('Passed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Skipped').length).toBeGreaterThan(0);
  });
});
