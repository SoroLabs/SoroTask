import React, { useEffect, useRef } from 'react';
import { MentionableEntity } from '../../types/mentions';

interface SuggestionsPopoverProps {
  suggestions: MentionableEntity[];
  selectedIndex: number;
  onSelect: (entity: MentionableEntity) => void;
  onClose: () => void;
  position: { top: number; left: number };
  isLoading?: boolean;
  error?: string;
}

export function SuggestionsPopover({
  suggestions,
  selectedIndex,
  onSelect,
  onClose,
  position,
  isLoading = false,
  error,
}: SuggestionsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    if (popoverRef.current) {
      const selectedElement = popoverRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (suggestions.length === 0 && !isLoading && !error) {
    return null;
  }

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl max-h-64 overflow-y-auto min-w-64"
      style={{ top: position.top, left: position.left }}
    >
      {isLoading && (
        <div className="p-3 text-center text-neutral-400">
          <div className="animate-spin inline-block w-4 h-4 border-2 border-neutral-600 border-t-neutral-400 rounded-full mr-2"></div>
          Loading...
        </div>
      )}

      {error && (
        <div className="p-3 text-center text-red-400">
          {error}
        </div>
      )}

      {!isLoading && !error && suggestions.map((suggestion, index) => (
        <div
          key={suggestion.id}
          className={`p-3 cursor-pointer hover:bg-neutral-700 transition-colors ${
            index === selectedIndex ? 'bg-neutral-700' : ''
          }`}
          onClick={() => onSelect(suggestion)}
        >
          <div className="flex items-center gap-3">
            {suggestion.avatar ? (
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-medium text-sm">
                {suggestion.avatar}
              </div>
            ) : (
              <div className="w-8 h-8 bg-neutral-600 rounded-full flex items-center justify-center">
                <span className="text-neutral-400 text-sm">
                  {suggestion.type === 'user' ? '👤' :
                   suggestion.type === 'task' ? '📋' : '📄'}
                </span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="font-medium text-neutral-200 truncate">
                {suggestion.displayName}
              </div>
              {suggestion.metadata && (
                <div className="text-xs text-neutral-400 truncate">
                  {suggestion.type === 'task' && suggestion.metadata.contract && `Contract: ${suggestion.metadata.contract}`}
                  {suggestion.type === 'contract' && suggestion.metadata.address && `Address: ${suggestion.metadata.address}`}
                </div>
              )}
            </div>
            <div className="text-xs text-neutral-500 uppercase">
              {suggestion.type}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}