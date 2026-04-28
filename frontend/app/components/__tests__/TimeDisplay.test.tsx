import React from 'react';
import { render, screen } from '@testing-library/react';
import { TimeDisplay } from '../components/TimeDisplay';

describe('TimeDisplay', () => {
  it('displays minutes and seconds for less than an hour', () => {
    render(<TimeDisplay seconds={125} />);
    expect(screen.getByText('2:05')).toBeInTheDocument();
  });

  it('displays hours, minutes and seconds for more than an hour', () => {
    render(<TimeDisplay seconds={3665} />);
    expect(screen.getByText('1:01:05')).toBeInTheDocument();
  });

  it('pads single digit minutes and seconds', () => {
    render(<TimeDisplay seconds={65} />);
    expect(screen.getByText('1:05')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<TimeDisplay seconds={60} className="custom-class" />);
    const element = screen.getByText('1:00');
    expect(element).toHaveClass('custom-class');
  });
});