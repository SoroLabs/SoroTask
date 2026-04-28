import React, { useState, useRef, useCallback, useEffect } from 'react';
import { MentionableEntity } from '../types/mentions';
import { useMentions } from '../context/mentions/MentionsContext';
import { SuggestionsPopover } from './SuggestionsPopover';

interface MentionsInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
  disabled?: boolean;
}

export function MentionsInput({
  value,
  onChange,
  placeholder,
  className = '',
  rows = 3,
  disabled = false,
}: MentionsInputProps) {
  const { triggers, searchEntities } = useMentions();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState<MentionableEntity[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [currentTrigger, setCurrentTrigger] = useState<{
    char: string;
    type: MentionableEntity['type'];
    start: number;
  } | null>(null);

  const getCaretCoordinates = useCallback(() => {
    if (!textareaRef.current) return { top: 0, left: 0 };

    const textarea = textareaRef.current;
    const { selectionStart } = textarea;

    // Create a temporary div to measure text
    const div = document.createElement('div');
    const style = window.getComputedStyle(textarea);

    // Copy styles
    [
      'fontSize', 'fontFamily', 'fontWeight', 'letterSpacing', 'lineHeight',
      'paddingTop', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth',
      'boxSizing', 'whiteSpace', 'wordWrap', 'wordBreak'
    ].forEach(prop => {
      div.style[prop as any] = style[prop as any];
    });

    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.width = textarea.offsetWidth + 'px';
    div.style.height = 'auto';
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordWrap = 'break-word';

    // Get text before cursor
    const textBeforeCursor = value.substring(0, selectionStart);
    div.textContent = textBeforeCursor;

    document.body.appendChild(div);

    const span = document.createElement('span');
    span.textContent = value.substring(selectionStart) || '.';
    div.appendChild(span);

    const rect = span.getBoundingClientRect();
    const textareaRect = textarea.getBoundingClientRect();

    document.body.removeChild(div);

    return {
      top: rect.top - textareaRect.top + textarea.scrollTop + 20,
      left: rect.left - textareaRect.left + textarea.scrollLeft,
    };
  }, [value]);

  const detectTrigger = useCallback((text: string, cursorPos: number) => {
    for (const trigger of triggers) {
      const beforeCursor = text.substring(0, cursorPos);
      const triggerIndex = beforeCursor.lastIndexOf(trigger.char);

      if (triggerIndex !== -1) {
        const afterTrigger = beforeCursor.substring(triggerIndex + 1);
        // Check if it's a valid trigger (not preceded by non-whitespace)
        const charBeforeTrigger = triggerIndex > 0 ? beforeCursor[triggerIndex - 1] : ' ';

        if (charBeforeTrigger === ' ' || charBeforeTrigger === '\n' || triggerIndex === 0) {
          // Check if there's whitespace after the trigger start
          const spaceAfter = afterTrigger.indexOf(' ');
          const queryEnd = spaceAfter === -1 ? afterTrigger.length : spaceAfter;
          const query = afterTrigger.substring(0, queryEnd);

          return {
            char: trigger.char,
            type: trigger.type,
            start: triggerIndex,
            query,
            end: triggerIndex + 1 + query.length,
          };
        }
      }
    }
    return null;
  }, [triggers]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart || 0;

    onChange(newValue);

    const trigger = detectTrigger(newValue, cursorPos);
    if (trigger && trigger.query.length > 0) {
      setCurrentTrigger(trigger);
      setIsLoading(true);
      setError(undefined);
      setPopoverPosition(getCaretCoordinates());

      searchEntities(trigger.type, trigger.query)
        .then(results => {
          setSuggestions(results);
          setSelectedIndex(0);
          setIsLoading(false);
        })
        .catch(err => {
          console.error('Search failed:', err);
          setError('Failed to load suggestions');
          setSuggestions([]);
          setIsLoading(false);
        });
    } else {
      setCurrentTrigger(null);
      setSuggestions([]);
      setPopoverPosition(null);
    }
  }, [onChange, detectTrigger, getCaretCoordinates, searchEntities]);

  const insertMention = useCallback((entity: MentionableEntity) => {
    if (!currentTrigger || !textareaRef.current) return;

    const beforeTrigger = value.substring(0, currentTrigger.start);
    const afterTrigger = value.substring(currentTrigger.end);
    const mentionText = `${currentTrigger.char}${entity.displayName}`;

    const newValue = beforeTrigger + mentionText + ' ' + afterTrigger;
    onChange(newValue);

    setCurrentTrigger(null);
    setSuggestions([]);
    setPopoverPosition(null);

    // Set cursor position after the mention
    setTimeout(() => {
      if (textareaRef.current) {
        const newCursorPos = currentTrigger.start + mentionText.length + 1;
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        textareaRef.current.focus();
      }
    }, 0);
  }, [currentTrigger, value, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!popoverPosition || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % suggestions.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => prev === 0 ? suggestions.length - 1 : prev - 1);
        break;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        if (suggestions[selectedIndex]) {
          insertMention(suggestions[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setCurrentTrigger(null);
        setSuggestions([]);
        setPopoverPosition(null);
        break;
    }
  }, [popoverPosition, suggestions, selectedIndex, insertMention]);

  const handleClose = useCallback(() => {
    setCurrentTrigger(null);
    setSuggestions([]);
    setPopoverPosition(null);
  }, []);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={`w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none resize-none ${className}`}
      />
      {popoverPosition && (
        <SuggestionsPopover
          suggestions={suggestions}
          selectedIndex={selectedIndex}
          onSelect={insertMention}
          onClose={handleClose}
          position={popoverPosition}
          isLoading={isLoading}
          error={error}
        />
      )}
    </div>
  );
}