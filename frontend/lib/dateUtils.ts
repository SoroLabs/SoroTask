/**
 * Date utility functions for calendar operations
 */

/**
 * Format a date as 'YYYY-MM-DD'
 */
export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse a date key 'YYYY-MM-DD' back to a Date object
 */
export function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Get all days in a month as Date objects
 */
export function getDaysInMonth(year: number, month: number): Date[] {
  const date = new Date(year, month - 1, 1);
  const days: Date[] = [];

  while (date.getMonth() === month - 1) {
    days.push(new Date(date));
    date.setDate(date.getDate() + 1);
  }

  return days;
}

/**
 * Get the first day of week for month (0 = Sunday, 6 = Saturday)
 */
export function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

/**
 * Get start and end of week for a given date
 */
export function getWeekBoundaries(date: Date): { start: Date; end: Date } {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day; // Adjust when day is Sunday

  const start = new Date(d.setDate(diff));
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

/**
 * Check if two dates are the same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Check if a date is today
 */
export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

/**
 * Check if a date is in the past
 */
export function isPastDate(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

/**
 * Check if a date is in the future
 */
export function isFutureDate(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date > today;
}

/**
 * Format date with optional timezone consideration
 */
export function formatDate(
  date: Date,
  options?: {
    locale?: string;
    timezone?: string;
    format?: 'short' | 'long' | 'full';
  }
): string {
  const locale = options?.locale || 'en-US';

  const formatOptions: Intl.DateTimeFormatOptions =
    options?.format === 'full'
      ? {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone: options?.timezone,
        }
      : options?.format === 'long'
        ? {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: options?.timezone,
          }
        : {
            month: 'short',
            day: 'numeric',
            timeZone: options?.timezone,
          };

  return new Intl.DateTimeFormat(locale, formatOptions).format(date);
}

/**
 * Get month name
 */
export function getMonthName(
  month: number,
  options?: { locale?: string; format?: 'long' | 'short' }
): string {
  const date = new Date(2000, month - 1, 1);
  const locale = options?.locale || 'en-US';
  const format = options?.format || 'long';

  return new Intl.DateTimeFormat(locale, {
    month: format,
  }).format(date);
}

/**
 * Get day name
 */
export function getDayName(
  dayOfWeek: number, // 0-6, Sunday-Saturday
  options?: { locale?: string; format?: 'long' | 'short' | 'narrow' }
): string {
  const date = new Date(2000, 0, 2 + dayOfWeek); // Start from Sunday
  const locale = options?.locale || 'en-US';
  const format = options?.format || 'short';

  return new Intl.DateTimeFormat(locale, {
    weekday: format,
  }).format(date);
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Add months to a date
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Get difference between two dates in days
 */
export function getDaysDifference(date1: Date, date2: Date): number {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.floor((date1.getTime() - date2.getTime()) / oneDay);
}

/**
 * Check if a date is within a date range
 */
export function isDateInRange(
  date: Date,
  startDate: Date,
  endDate: Date
): boolean {
  return date >= startDate && date <= endDate;
}

/**
 * Get calendar grid for month view (42 cells with padding)
 */
export function getMonthCalendarGrid(year: number, month: number): Date[][] {
  const firstDay = getFirstDayOfMonth(year, month);
  const daysInMonth = getDaysInMonth(year, month);
  const calendarGrid: Date[][] = [];

  let week: Date[] = [];

  // Add padding for days before month starts
  for (let i = 0; i < firstDay; i++) {
    const prevDate = new Date(year, month - 1, -i);
    week.unshift(prevDate);
  }

  // Add days of the month
  for (const day of daysInMonth) {
    if (week.length === 7) {
      calendarGrid.push(week);
      week = [];
    }
    week.push(day);
  }

  // Add padding for remaining cells
  while (week.length < 7 && week.length > 0) {
    const nextDate = new Date(
      year,
      month,
      (calendarGrid.length * 7 + week.length - firstDay - daysInMonth.length) + 1
    );
    week.push(nextDate);
  }

  if (week.length > 0) {
    calendarGrid.push(week);
  }

  return calendarGrid;
}
