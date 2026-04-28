export interface DateParsingConfig {
  locale: string;
  timezone: string;
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday, 1 = Monday, etc.
  referenceDate: Date;
  format24Hour: boolean;
}

export const getDefaultDateConfig = (): DateParsingConfig => {
  return {
    locale: typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    weekStartsOn: 1, // Monday (ISO 8601)
    referenceDate: new Date(),
    format24Hour: Intl.DateTimeFormat().resolvedOptions().hour12 === false
  };
};

export const formatDateForDisplay = (
  date: Date, 
  config: DateParsingConfig,
  includeTime: boolean = false
): string => {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: config.timezone
  };

  if (includeTime) {
    options.hour = config.format24Hour ? '2-digit' : 'numeric';
    options.minute = '2-digit';
    options.hour12 = !config.format24Hour;
  }

  return date.toLocaleDateString(config.locale, options);
};

export const parseTimezoneOffset = (timezone: string): number => {
  try {
    const now = new Date();
    const utcTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60000));
    const targetTime = new Date(utcTime.toLocaleString('en-US', { timeZone: timezone }));
    return (targetTime.getTime() - utcTime.getTime()) / (1000 * 60 * 60);
  } catch {
    return 0; // Fallback to UTC
  }
};

export const isAmbiguousDate = (input: string, parsedDate: Date, config: DateParsingConfig): boolean => {
  const lowerInput = input.toLowerCase().trim();
  
  // Check for potentially ambiguous terms
  const ambiguousPatterns = [
    /next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/,
    /this\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/,
    /in\s+\d+\s+days?/,
    /\d+\s+days?\s+from\s+now/
  ];

  return ambiguousPatterns.some(pattern => pattern.test(lowerInput));
};

export const getConfidenceLevel = (
  input: string, 
  parsedDate: Date | null, 
  config: DateParsingConfig
): 'high' | 'medium' | 'low' => {
  if (!parsedDate) return 'low';

  const lowerInput = input.toLowerCase().trim();
  
  // High confidence for specific dates and common terms
  if (lowerInput.match(/^\d{1,2}\/\d{1,2}(\/\d{4})?$/)) return 'high';
  if (['today', 'tomorrow', 'yesterday'].includes(lowerInput)) return 'high';
  
  // Medium confidence for relative terms
  if (lowerInput.includes('next ') || lowerInput.includes('this ')) return 'medium';
  if (lowerInput.includes('in ') || lowerInput.includes('from now')) return 'medium';
  
  // Low confidence for unclear or complex expressions
  return 'low';
};
