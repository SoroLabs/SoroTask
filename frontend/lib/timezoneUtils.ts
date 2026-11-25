/**
 * Timezone utility functions — standardized for UTC blockchain scheduling
 */

/**
 * Get the user's current timezone
 */
export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Standardize any date input to a strict UTC ISO-8601 string
 */
export function toUTCISOString(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date input: ${String(date)}`);
  }
  return d.toISOString();
}

/**
 * Parse a UTC ISO-8601 string or numeric timestamp safely
 */
export function parseUTCTimestamp(timestamp: string | number): Date {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid UTC timestamp: ${String(timestamp)}`);
  }
  return d;
}

/**
 * Format dual timestamp showing both Local time and UTC time
 */
export function formatDualTimestamp(
  date: Date | string | number,
  timezone: string = getUserTimezone(),
  locale: string = 'en-US'
): { local: string; utc: string; formatted: string } {
  const d = date instanceof Date ? date : new Date(date);
  const isValid = !isNaN(d.getTime());
  if (!isValid) {
    return { local: 'Invalid Date', utc: 'Invalid Date', formatted: 'Invalid Date' };
  }

  const utcStr = d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  let localStr = d.toLocaleString();
  try {
    localStr = new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    localStr = d.toLocaleString(locale);
  }

  const offset = getTimezoneOffset(timezone, d);
  const formatted = `${localStr} (${offset}) / ${utcStr}`;

  return {
    local: `${localStr} (${offset})`,
    utc: utcStr,
    formatted,
  };
}

/**
 * Detect if Daylight Savings Time (DST) is currently active for a timezone & date
 */
export function isDSTActive(
  date: Date = new Date(),
  timezone: string = getUserTimezone()
): boolean {
  try {
    const jan = new Date(date.getFullYear(), 0, 1);
    const jul = new Date(date.getFullYear(), 6, 1);

    const janOffset = getOffsetMinutes(jan, timezone);
    const julOffset = getOffsetMinutes(jul, timezone);

    const currentOffset = getOffsetMinutes(date, timezone);
    const stdOffset = Math.min(janOffset, julOffset);

    return currentOffset > stdOffset;
  } catch {
    return false;
  }
}

function getOffsetMinutes(date: Date, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value || '';
    const match = tzPart.match(/GMT([+-]\d{2}):?(\d{2})?/);
    if (!match) return 0;
    const hours = parseInt(match[1], 10);
    const minutes = match[2] ? parseInt(match[2], 10) : 0;
    return hours * 60 + (hours < 0 ? -minutes : minutes);
  } catch {
    return 0;
  }
}

/**
 * Get Daylight Savings Time warning message for task scheduling
 */
export function getDSTWarning(
  date: Date = new Date(),
  timezone: string = getUserTimezone()
): { isDST: boolean; warning: string | null } {
  const dst = isDSTActive(date, timezone);
  if (dst) {
    return {
      isDST: true,
      warning:
        'Daylight Savings Time is active in your selected timezone. Recurring task execution hours on-chain remain strictly fixed in UTC.',
    };
  }
  return {
    isDST: false,
    warning: null,
  };
}

/**
 * Get available timezones
 */
export function getAvailableTimezones(): string[] {
  return [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Moscow',
    'Asia/Dubai',
    'Asia/Kolkata',
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

    const dateStr = new Intl.DateTimeFormat(locale, formatOptions).format(date);
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
