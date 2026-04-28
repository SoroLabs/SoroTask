import React from 'react';

interface RelativeTimeDisplayProps {
  timestamp: Date;
}

export function RelativeTimeDisplay({ timestamp }: RelativeTimeDisplayProps) {
  const now = new Date();
  const diffMs = now.getTime() - timestamp.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let displayText: string;
  if (diffMinutes < 1) {
    displayText = 'just now';
  } else if (diffMinutes < 60) {
    displayText = `${diffMinutes}m ago`;
  } else if (diffHours < 24) {
    displayText = `${diffHours}h ago`;
  } else if (diffDays < 7) {
    displayText = `${diffDays}d ago`;
  } else {
    displayText = timestamp.toLocaleDateString();
  }

  return (
    <span className="text-xs text-gray-500" title={timestamp.toLocaleString()}>
      {displayText}
    </span>
  );
}