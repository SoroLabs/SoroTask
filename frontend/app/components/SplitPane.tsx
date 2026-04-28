'use client';

import React, { useState, useRef, useCallback } from 'react';

interface SplitPaneProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultSplit?: number; // percentage (0-100)
  minLeftWidth?: number;
  minRightWidth?: number;
  className?: string;
  onSplitChange?: (percentage: number) => void;
}

export function SplitPane({
  left,
  right,
  defaultSplit = 50,
  minLeftWidth = 300,
  minRightWidth = 300,
  className = '',
  onSplitChange
}: SplitPaneProps) {
  const [split, setSplit] = useState(defaultSplit);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const newSplit = ((e.clientX - rect.left) / rect.width) * 100;

    // Respect minimum widths
    const minLeftPercent = (minLeftWidth / rect.width) * 100;
    const minRightPercent = (minRightWidth / rect.width) * 100;

    const clampedSplit = Math.max(minLeftPercent, Math.min(100 - minRightPercent, newSplit));
    setSplit(clampedSplit);
    onSplitChange?.(clampedSplit);
  }, [isDragging, minLeftWidth, minRightWidth]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div ref={containerRef} className={`flex h-full ${className}`}>
      <div
        className="flex-shrink-0 overflow-hidden"
        style={{ width: `${split}%` }}
      >
        {left}
      </div>

      <div
        className="flex-shrink-0 w-1 bg-neutral-700 hover:bg-neutral-600 cursor-col-resize relative group"
        onMouseDown={handleMouseDown}
      >
        <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-neutral-600 group-hover:bg-neutral-500 transition-colors" />
      </div>

      <div
        className="flex-1 overflow-hidden"
        style={{ width: `${100 - split}%` }}
      >
        {right}
      </div>
    </div>
  );
}