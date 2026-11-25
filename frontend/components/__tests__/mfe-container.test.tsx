import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MFEContainer } from '../mfe-container';

describe('MFEContainer', () => {
  const defaultProps = {
    url: 'https://trusted-mfe.sorotask.com',
    title: 'Test MFE',
    originWhitelist: ['https://trusted-mfe.sorotask.com'],
  };

  it('renders iframe with correct attributes', () => {
    render(<MFEContainer {...defaultProps} />);
    
    const iframe = screen.getByTitle('Test MFE') as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.src).toBe('https://trusted-mfe.sorotask.com/');
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms allow-popups');
  });

  it('displays loading state initially and removes it on load', async () => {
    const { container } = render(<MFEContainer {...defaultProps} />);
    
    // Check loading spinner is present
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    
    // Simulate iframe load
    const iframe = screen.getByTitle('Test MFE');
    await act(async () => {
      fireEvent.load(iframe);
    });
    
    // Spinner should be gone
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
  });

  it('displays fallback on MFE_ERROR message', async () => {
    render(<MFEContainer {...defaultProps} fallback={<div data-testid="fallback">Error State</div>} />);
    
    const messageEvent = new MessageEvent('message', {
      data: { type: 'MFE_ERROR' },
      origin: 'https://trusted-mfe.sorotask.com',
    });
    
    await act(async () => {
      window.dispatchEvent(messageEvent);
    });
    
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    expect(screen.queryByTitle('Test MFE')).not.toBeInTheDocument();
  });

  it('ignores messages from untrusted origins', async () => {
    const onMessage = jest.fn();
    render(<MFEContainer {...defaultProps} onMessage={onMessage} />);
    
    const messageEvent = new MessageEvent('message', {
      data: { type: 'TEST' },
      origin: 'https://malicious.com',
    });
    
    await act(async () => {
      window.dispatchEvent(messageEvent);
    });
    
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('processes messages from trusted origins', async () => {
    const onMessage = jest.fn();
    render(<MFEContainer {...defaultProps} onMessage={onMessage} />);
    
    const messageEvent = new MessageEvent('message', {
      data: { type: 'TEST' },
      origin: 'https://trusted-mfe.sorotask.com',
    });
    
    await act(async () => {
      window.dispatchEvent(messageEvent);
    });
    
    expect(onMessage).toHaveBeenCalledWith({ type: 'TEST' });
  });

  it('triggers fallback on timeout if no heartbeat is received', async () => {
    jest.useFakeTimers();
    render(
      <MFEContainer
        {...defaultProps}
        initTimeoutMs={3000}
        fallback={<div data-testid="fallback">Error State</div>}
      />
    );
    
    expect(screen.getByTitle('Test MFE')).toBeInTheDocument();
    
    // Fast-forward time past timeout
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    expect(screen.queryByTitle('Test MFE')).not.toBeInTheDocument();
    
    jest.useRealTimers();
  });

  it('clears timeout and hides loading state when HEARTBEAT is received', async () => {
    jest.useFakeTimers();
    const { container } = render(
      <MFEContainer
        {...defaultProps}
        initTimeoutMs={3000}
      />
    );
    
    // Send MFE_READY message
    const messageEvent = new MessageEvent('message', {
      data: { type: 'MFE_READY' },
      origin: 'https://trusted-mfe.sorotask.com',
    });
    
    await act(async () => {
      window.dispatchEvent(messageEvent);
    });
    
    // Fast-forward time past timeout
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    
    // Should NOT be in error state because heartbeat cleared the timeout
    expect(screen.getByTitle('Test MFE')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
    
    jest.useRealTimers();
  });
});
