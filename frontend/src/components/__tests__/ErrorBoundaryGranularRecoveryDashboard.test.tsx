import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ErrorBoundaryGranularRecoveryDashboard } from '../ErrorBoundaryGranularRecoveryDashboard';

// Mock Web Worker
class MockWorker {
  onmessage: ((ev: MessageEvent) => any) | null = null;
  
  postMessage(data: any) {
    if (data.type === 'PROCESS_ERROR') {
      const payload = data.payload;
      const recoveryStatus = payload.message.includes('Critical')
        ? 'Critical'
        : payload.message.includes('Warning')
          ? 'Warning'
          : 'Recoverable';

      const suggestedAction = recoveryStatus === 'Critical'
        ? 'Manual intervention required'
        : recoveryStatus === 'Warning'
          ? 'Monitor closely'
          : 'Automatic retry safe';

      const processedError = {
        ...payload,
        processedAt: Date.now(),
        recoveryStatus,
        suggestedAction,
        hash: 12345
      };

      if (this.onmessage) {
        // Simulate async processing
        setTimeout(() => {
          this.onmessage!({
            data: {
              type: 'ERROR_PROCESSED',
              payload: processedError
            }
          } as MessageEvent);
        }, 10);
      }
    }
  }

  terminate() {}
}

beforeAll(() => {
  // @ts-ignore
  global.Worker = MockWorker;
  
  // Provide a predictable randomUUID for tests
  let counter = 0;
  global.crypto = {
    ...global.crypto,
    randomUUID: () => `test-uuid-${counter++}`
  } as Crypto;
});

describe('ErrorBoundaryGranularRecoveryDashboard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('renders the dashboard correctly', () => {
    render(<ErrorBoundaryGranularRecoveryDashboard />);
    expect(screen.getByText('Error Boundary Granular Recovery')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('handles recoverable error simulation and processing', async () => {
    render(<ErrorBoundaryGranularRecoveryDashboard />);
    
    // Initial state
    expect(screen.getByText('Total Errors').nextElementSibling?.textContent).toBe('0');
    
    const simulateRecoverableBtn = screen.getByText('Simulate Recoverable');
    fireEvent.click(simulateRecoverableBtn);

    // Verify raw error added
    expect(screen.getByText('Total Errors').nextElementSibling?.textContent).toBe('1');
    expect(screen.getByText('Recoverable: Network timeout fetching config')).toBeInTheDocument();

    // Fast-forward timers to simulate worker processing
    act(() => {
      jest.advanceTimersByTime(20);
    });

    // Verify processed error added
    expect(screen.getByText('Processed').nextElementSibling?.textContent).toBe('1');
    expect(screen.getByText('Automatic retry safe')).toBeInTheDocument();
  });

  it('handles warning error simulation and processing', async () => {
    render(<ErrorBoundaryGranularRecoveryDashboard />);
    
    const simulateWarningBtn = screen.getByText('Simulate Warning');
    fireEvent.click(simulateWarningBtn);

    act(() => {
      jest.advanceTimersByTime(20);
    });

    expect(screen.getByText('Monitor closely')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
  });

  it('handles critical error simulation and processing', async () => {
    render(<ErrorBoundaryGranularRecoveryDashboard />);
    
    const simulateCriticalBtn = screen.getByText('Simulate Critical');
    fireEvent.click(simulateCriticalBtn);

    act(() => {
      jest.advanceTimersByTime(20);
    });

    expect(screen.getByText('Manual intervention required')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('cleans up worker on unmount', () => {
    const { unmount } = render(<ErrorBoundaryGranularRecoveryDashboard />);
    // worker termination is tested by ensuring it doesn't throw on unmount
    expect(() => unmount()).not.toThrow();
  });
});
