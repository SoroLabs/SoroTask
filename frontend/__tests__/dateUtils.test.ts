import {
  formatDateKey,
  parseDateKey,
  getDaysInMonth,
  getFirstDayOfMonth,
  isSameDay,
  isToday,
  isPastDate,
  isFutureDate,
  formatDate,
  getMonthName,
  getDayName,
  addDays,
  addMonths,
  getDaysDifference,
  isDateInRange,
  getMonthCalendarGrid,
} from '@/lib/dateUtils';

describe('dateUtils', () => {
  describe('formatDateKey', () => {
    it('should format date as YYYY-MM-DD', () => {
      const date = new Date(2024, 0, 5); // January 5, 2024
      expect(formatDateKey(date)).toBe('2024-01-05');
    });

    it('should pad single digit months and days', () => {
      const date = new Date(2024, 2, 3); // March 3, 2024
      expect(formatDateKey(date)).toBe('2024-03-03');
    });
  });

  describe('parseDateKey', () => {
    it('should parse YYYY-MM-DD to Date', () => {
      const result = parseDateKey('2024-01-15');
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0);
      expect(result.getDate()).toBe(15);
    });
  });

  describe('getDaysInMonth', () => {
    it('should return correct number of days for January', () => {
      const days = getDaysInMonth(2024, 1);
      expect(days.length).toBe(31);
    });

    it('should return correct number of days for February in leap year', () => {
      const days = getDaysInMonth(2024, 2);
      expect(days.length).toBe(29);
    });

    it('should return correct number of days for February in non-leap year', () => {
      const days = getDaysInMonth(2023, 2);
      expect(days.length).toBe(28);
    });
  });

  describe('isSameDay', () => {
    it('should return true for same day', () => {
      const date1 = new Date(2024, 0, 15);
      const date2 = new Date(2024, 0, 15);
      expect(isSameDay(date1, date2)).toBe(true);
    });

    it('should return false for different days', () => {
      const date1 = new Date(2024, 0, 15);
      const date2 = new Date(2024, 0, 16);
      expect(isSameDay(date1, date2)).toBe(false);
    });
  });

  describe('addDays', () => {
    it('should add days correctly', () => {
      const date = new Date(2024, 0, 15);
      const result = addDays(date, 5);
      expect(result.getDate()).toBe(20);
    });

    it('should handle month boundaries', () => {
      const date = new Date(2024, 0, 28);
      const result = addDays(date, 5);
      expect(result.getMonth()).toBe(1);
      expect(result.getDate()).toBe(2);
    });
  });

  describe('addMonths', () => {
    it('should add months correctly', () => {
      const date = new Date(2024, 0, 15);
      const result = addMonths(date, 3);
      expect(result.getMonth()).toBe(3);
    });

    it('should handle year boundaries', () => {
      const date = new Date(2024, 10, 15);
      const result = addMonths(date, 3);
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(1);
    });
  });

  describe('getDaysDifference', () => {
    it('should calculate correct difference between dates', () => {
      const date1 = new Date(2024, 0, 20);
      const date2 = new Date(2024, 0, 15);
      expect(getDaysDifference(date1, date2)).toBe(5);
    });

    it('should handle negative differences', () => {
      const date1 = new Date(2024, 0, 15);
      const date2 = new Date(2024, 0, 20);
      expect(getDaysDifference(date1, date2)).toBe(-5);
    });
  });

  describe('isDateInRange', () => {
    it('should return true for date within range', () => {
      const start = new Date(2024, 0, 10);
      const end = new Date(2024, 0, 20);
      const date = new Date(2024, 0, 15);
      expect(isDateInRange(date, start, end)).toBe(true);
    });

    it('should return false for date outside range', () => {
      const start = new Date(2024, 0, 10);
      const end = new Date(2024, 0, 20);
      const date = new Date(2024, 0, 25);
      expect(isDateInRange(date, start, end)).toBe(false);
    });
  });

  describe('getMonthCalendarGrid', () => {
    it('should return grid of 6 weeks', () => {
      const grid = getMonthCalendarGrid(2024, 1);
      expect(grid.length).toBe(6);
    });

    it('should have 7 days per week', () => {
      const grid = getMonthCalendarGrid(2024, 1);
      grid.forEach((week) => {
        expect(week.length).toBe(7);
      });
    });
  });

  describe('formatDate', () => {
    it('should format date with locale', () => {
      const date = new Date(2024, 0, 15);
      const result = formatDate(date, {
        locale: 'en-US',
        format: 'short',
      });
      expect(result).toContain('15');
      expect(result).toContain('Jan');
    });
  });

  describe('getMonthName', () => {
    it('should return long month name', () => {
      const name = getMonthName(1, { locale: 'en-US', format: 'long' });
      expect(name).toBe('January');
    });

    it('should return short month name', () => {
      const name = getMonthName(1, { locale: 'en-US', format: 'short' });
      expect(name).toBe('Jan');
    });
  });

  describe('getDayName', () => {
    it('should return day name for index', () => {
      const name = getDayName(0, { locale: 'en-US', format: 'long' });
      expect(name).toBe('Sunday');
    });
  });
});
