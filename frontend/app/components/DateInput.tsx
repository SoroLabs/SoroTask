'use client';

import React, { useState, useEffect, useCallback } from 'react';

// Mock chrono-node implementation for demonstration
// In production, this would be: import * as chrono from 'chrono-node';
const mockChrono = {
  parseDate: (text: string, ref?: Date): Date | null => {
    const now = ref || new Date();
    const lowerText = text.toLowerCase().trim();
    
    // Handle common natural language date expressions
    if (lowerText === 'tomorrow' || lowerText === 'tmrw') {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow;
    }
    
    if (lowerText === 'today') {
      return now;
    }
    
    if (lowerText === 'yesterday' || lowerText === 'yst') {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return yesterday;
    }
    
    // Handle "in X days"
    const inDaysMatch = lowerText.match(/in (\d+) days?/);
    if (inDaysMatch) {
      const days = parseInt(inDaysMatch[1]);
      const future = new Date(now);
      future.setDate(future.getDate() + days);
      return future;
    }
    
    // Handle "X days from now"
    const daysFromMatch = lowerText.match(/(\d+) days? from now/);
    if (daysFromMatch) {
      const days = parseInt(daysFromMatch[1]);
      const future = new Date(now);
      future.setDate(future.getDate() + days);
      return future;
    }
    
    // Handle "next [day]"
    const nextDayMatch = lowerText.match(/next (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (nextDayMatch) {
      const dayName = nextDayMatch[1];
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = daysOfWeek.indexOf(dayName);
      const currentDay = now.getDay();
      const daysUntilTarget = (targetDay - currentDay + 7) % 7 || 7; // If today, go to next week
      const nextDate = new Date(now);
      nextDate.setDate(nextDate.getDate() + daysUntilTarget);
      return nextDate;
    }
    
    // Handle "this [day]"
    const thisDayMatch = lowerText.match(/this (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (thisDayMatch) {
      const dayName = thisDayMatch[1];
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = daysOfWeek.indexOf(dayName);
      const currentDay = now.getDay();
      const daysUntilTarget = (targetDay - currentDay + 7) % 7;
      const thisDate = new Date(now);
      thisDate.setDate(thisDate.getDate() + daysUntilTarget);
      return thisDate;
    }
    
    // Handle date formats like MM/DD, MM/DD/YYYY
    const dateMatch = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
    if (dateMatch) {
      const month = parseInt(dateMatch[1]) - 1;
      const day = parseInt(dateMatch[2]);
      const year = dateMatch[3] ? parseInt(dateMatch[3]) : now.getFullYear();
      const date = new Date(year, month, day);
      return date;
    }
    
    return null;
  }
};

interface ParseResult {
  date: Date | null;
  confidence: 'high' | 'medium' | 'low';
  isAmbiguous: boolean;
  suggestions?: string[];
}

interface DateInputProps {
  value: string;
  onChange: (value: string, parsedDate?: Date) => void;
  placeholder?: string;
  className?: string;
  label?: string;
  required?: boolean;
}

export default function DateInput({ 
  value, 
  onChange, 
  placeholder = "e.g., 'tomorrow', 'next Friday', 'in 3 days'", 
  className = '',
  label,
  required = false
}: DateInputProps) {
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  const parseDateInput = useCallback((input: string): ParseResult => {
    if (!input.trim()) {
      return { date: null, confidence: 'low', isAmbiguous: false };
    }

    const parsedDate = mockChrono.parseDate(input);
    
    if (!parsedDate) {
      return { 
        date: null, 
        confidence: 'low', 
        isAmbiguous: true,
        suggestions: ['Try: "tomorrow", "next Friday", "in 3 days", "12/25"']
      };
    }

    // Determine confidence based on input type
    const lowerInput = input.toLowerCase().trim();
    let confidence: 'high' | 'medium' | 'low' = 'medium';
    let isAmbiguous = false;

    // High confidence for specific dates
    if (lowerInput.match(/^\d{1,2}\/\d{1,2}(\/\d{4})?$/)) {
      confidence = 'high';
    }
    // Medium confidence for relative terms
    else if (['today', 'tomorrow', 'yesterday'].includes(lowerInput)) {
      confidence = 'high';
    }
    else if (lowerInput.includes('next ') || lowerInput.includes('this ')) {
      confidence = 'medium';
      isAmbiguous = true; // Could be this week or next week
    }
    else if (lowerInput.includes('in ') || lowerInput.includes('from now')) {
      confidence = 'medium';
    }
    else {
      confidence = 'low';
      isAmbiguous = true;
    }

    return { date: parsedDate, confidence, isAmbiguous };
  }, []);

  useEffect(() => {
    const result = parseDateInput(value);
    setParseResult(result);
  }, [value, parseDateInput]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue, parseResult?.date || undefined);
  };

  const formatDateDisplay = (date: Date): string => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'high': return 'text-green-400';
      case 'medium': return 'text-yellow-400';
      case 'low': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getConfidenceBg = (confidence: string) => {
    switch (confidence) {
      case 'high': return 'bg-green-500/10 border-green-500/20';
      case 'medium': return 'bg-yellow-500/10 border-yellow-500/20';
      case 'low': return 'bg-red-500/10 border-red-500/20';
      default: return 'bg-gray-500/10 border-gray-500/20';
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-neutral-400">
          {label}
          {required && <span className="text-red-400 ml-1">*</span>}
        </label>
      )}
      
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          className={`w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm ${
            parseResult?.date ? 'border-green-500/50' : ''
          }`}
        />
        
        {parseResult?.date && (
          <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          </div>
        )}
      </div>

      {/* Live validation feedback */}
      {value && parseResult && (
        <div className={`p-3 rounded-lg border text-sm ${
          getConfidenceBg(parseResult.confidence)
        }`}>
          {parseResult.date ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-neutral-300">Parsed as:</span>
                <span className={`text-xs font-medium ${getConfidenceColor(parseResult.confidence)}`}>
                  {parseResult.confidence.toUpperCase()} CONFIDENCE
                </span>
              </div>
              <div className="font-medium text-neutral-100">
                {formatDateDisplay(parseResult.date)}
              </div>
              
              {parseResult.isAmbiguous && (
                <div className="text-xs text-yellow-400 mt-2">
                  ⚠️ This date could be ambiguous. Please verify it's correct.
                </div>
              )}
              
              <div className="text-xs text-neutral-400 mt-1">
                Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="text-red-400">
                Unable to parse this date format
              </div>
              {parseResult.suggestions && (
                <div className="text-xs text-neutral-400">
                  Suggestions: {parseResult.suggestions.join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Help text when focused */}
      {isFocused && !value && (
        <div className="text-xs text-neutral-500 space-y-1">
          <div>Try phrases like:</div>
          <div className="font-mono bg-neutral-800/50 rounded px-2 py-1">
            tomorrow, next Friday, in 3 days, 12/25, this Monday
          </div>
        </div>
      )}
    </div>
  );
}
