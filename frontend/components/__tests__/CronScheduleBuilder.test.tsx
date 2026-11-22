import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CronScheduleBuilder, formatSecondsToReadable } from '../CronScheduleBuilder';

describe('CronScheduleBuilder Component', () => {
  it('formats seconds into readable strings correctly', () => {
    expect(formatSecondsToReadable(0)).toBe('0 seconds');
    expect(formatSecondsToReadable(3600)).toBe('1h');
    expect(formatSecondsToReadable(86400)).toBe('1d');
    expect(formatSecondsToReadable(900)).toBe('15m');
    expect(formatSecondsToReadable(90061)).toBe('1d 1h 1m 1s');
  });

  it('renders default hourly preset and preview', () => {
    render(<CronScheduleBuilder initialSeconds={3600} initialTimezone="UTC" />);
    expect(screen.getByText('Recurring Schedule Builder')).toBeInTheDocument();
    expect(screen.getByText('Next 5 Estimated Executions')).toBeInTheDocument();
  });

  it('updates when switching presets', () => {
    const onScheduleChange = jest.fn();
    render(<CronScheduleBuilder onScheduleChange={onScheduleChange} />);

    const select = screen.getByLabelText(/Frequency Preset/i);
    fireEvent.change(select, { target: { value: 'daily' } });

    expect(onScheduleChange).toHaveBeenCalledWith(86400, '0 0 * * *', 'UTC');
  });

  it('allows custom seconds input', () => {
    const onScheduleChange = jest.fn();
    render(<CronScheduleBuilder onScheduleChange={onScheduleChange} />);

    const select = screen.getByLabelText(/Frequency Preset/i);
    fireEvent.change(select, { target: { value: 'custom_seconds' } });

    const input = screen.getByLabelText(/Interval \(in seconds\)/i);
    fireEvent.change(input, { target: { value: '1200' } });

    expect(onScheduleChange).toHaveBeenCalledWith(1200, expect.any(String), 'UTC');
  });
});
