/**
 * Timezone utility functions
 */

/**
 * Get the user's current timezone
 */
export function getUserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Get available timezones
 */
export function getAvailableTimezones(): string[] {
  // Common timezones for quick access
  return [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'Europe/Tokyo',
    'Asia/Shanghai',
    'Asia/Hong_Kong',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
  ];
}

/**
 * Convert date to different timezone
 * Returns a date string in the format of the target timezone
 */
export function convertDateToTimezone(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    // Invalid timezone, return UTC
    return date.toISOString();
  }
}

/**
 * Get UTC offset for a timezone
 */
export function getTimezoneOffset(
  timezone: string,
  date: Date = new Date()
): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    });

    const parts = formatter.formatToParts(date);
    const timeZoneName = parts.find((part) => part.type === 'timeZoneName');

    return timeZoneName?.value || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Format time in specific timezone
 */
export function formatTimeInTimezone(
  date: Date,
  timezone: string,
  locale: string = 'en-US'
): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return date.toLocaleTimeString(locale);
  }
}

/**
 * Check if a timezone is valid
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current time in a specific timezone
 */
export function getCurrentTimeInTimezone(timezone: string): Date {
  const now = new Date();
  const utcDate = now.toLocaleString('en-US', { timeZone: 'UTC' });
  const targetDate = now.toLocaleString('en-US', { timeZone: timezone });

  const utcTime = new Date(utcDate).getTime();
  const targetTime = new Date(targetDate).getTime();
  const offset = targetTime - utcTime;

  return new Date(now.getTime() + offset);
}

/**
 * Format date with timezone display
 */
export function formatDateWithTimezone(
  date: Date,
  options?: {
    timezone?: string;
    locale?: string;
    includeTime?: boolean;
  }
): string {
  const timezone = options?.timezone || 'UTC';
  const locale = options?.locale || 'en-US';
  const includeTime = options?.includeTime ?? false;

  try {
    const formatOptions: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    };

    if (includeTime) {
      formatOptions.hour = '2-digit';
      formatOptions.minute = '2-digit';
    }

    const dateStr = new Intl.DateTimeFormat(locale, formatOptions).format(
      date
    );
    const offsetStr = getTimezoneOffset(timezone, date);

    return `${dateStr} (${offsetStr})`;
  } catch {
    return date.toLocaleString(locale);
  }
}

/**
 * List common timezone regions
 */
export function getTimezonesByRegion(region: string): string[] {
  const regions: Record<string, string[]> = {
    'North America': [
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Anchorage',
    ],
    'South America': [
      'America/Toronto',
      'America/Mexico_City',
      'America/Sao_Paulo',
      'America/Buenos_Aires',
    ],
    Europe: [
      'Europe/London',
      'Europe/Paris',
      'Europe/Berlin',
      'Europe/Moscow',
      'Europe/Istanbul',
    ],
    Africa: [
      'Africa/Cairo',
      'Africa/Lagos',
      'Africa/Johannesburg',
      'Africa/Nairobi',
    ],
    Asia: [
      'Asia/Dubai',
      'Asia/Kolkata',
      'Asia/Bangkok',
      'Asia/Hong_Kong',
      'Asia/Shanghai',
      'Asia/Tokyo',
      'Asia/Seoul',
    ],
    'Pacific/Oceania': [
      'Australia/Sydney',
      'Australia/Melbourne',
      'Pacific/Auckland',
      'Pacific/Fiji',
    ],
  };

  return regions[region] || [];
}
