import React from 'react';

interface TimeDisplayProps {
  seconds: number;
  className?: string;
}

export function TimeDisplay({ seconds, className = '' }: TimeDisplayProps) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const format = (num: number) => num.toString().padStart(2, '0');

  return (
    <span className={className}>
      {hours > 0 ? `${hours}:${format(minutes)}:${format(secs)}` : `${minutes}:${format(secs)}`}
    </span>
  );
}