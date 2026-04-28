import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimerControls } from '../components/TimerControls';

// Mock the context
const mockDispatch = jest.fn();
jest.mock('../context/TimeTrackingContext', () => ({
  useTimeTracking: () => ({
    dispatch: mockDispatch,
  }),
}));

describe('TimerControls', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
  });

  it('shows start button when not active', () => {
    render(<TimerControls taskId="task-1" isActive={false} isPaused={false} />);
    const startButton = screen.getByText('Start');
    expect(startButton).toBeInTheDocument();
  });

  it('shows pause and stop buttons when active and not paused', () => {
    render(<TimerControls taskId="task-1" isActive={true} isPaused={false} />);
    expect(screen.getByText('Pause')).toBeInTheDocument();
    expect(screen.getByText('Stop')).toBeInTheDocument();
  });

  it('shows resume and stop buttons when paused', () => {
    render(<TimerControls taskId="task-1" isActive={true} isPaused={true} />);
    expect(screen.getByText('Resume')).toBeInTheDocument();
    expect(screen.getByText('Stop')).toBeInTheDocument();
  });

  it('dispatches START_TIMER when start is clicked', () => {
    render(<TimerControls taskId="task-1" isActive={false} isPaused={false} />);
    fireEvent.click(screen.getByText('Start'));
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'START_TIMER',
      payload: { taskId: 'task-1' },
    });
  });

  it('dispatches PAUSE_TIMER when pause is clicked', () => {
    render(<TimerControls taskId="task-1" isActive={true} isPaused={false} />);
    fireEvent.click(screen.getByText('Pause'));
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'PAUSE_TIMER' });
  });

  it('dispatches STOP_TIMER when stop is clicked', () => {
    render(<TimerControls taskId="task-1" isActive={true} isPaused={false} />);
    fireEvent.click(screen.getByText('Stop'));
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'STOP_TIMER' });
  });
});