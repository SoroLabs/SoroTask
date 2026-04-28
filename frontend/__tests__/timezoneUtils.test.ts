import {
  getUserTimezone,
  isValidTimezone,
  getAvailableTimezones,
  getTimezoneOffset,
  formatTimeInTimezone,
  formatDateWithTimezone,
} from '@/lib/timezoneUtils';

describe('timezoneUtils', () => {
  describe('isValidTimezone', () => {
    it('should return true for valid timezone', () => {
      expect(isValidTimezone('America/New_York')).toBe(true);
      expect(isValidTimezone('Europe/London')).toBe(true);
      expect(isValidTimezone('UTC')).toBe(true);
    });

    it('should return false for invalid timezone', () => {
      expect(isValidTimezone('Invalid/Timezone')).toBe(false);
      expect(isValidTimezone('Foo/Bar')).toBe(false);
    });
  });

  describe('getAvailableTimezones', () => {
    it('should return array of timezone strings', () => {
      const timezones = getAvailableTimezones();
      expect(Array.isArray(timezones)).toBe(true);
      expect(timezones.length).toBeGreaterThan(0);
      expect(timezones.includes('America/New_York')).toBe(true);
      expect(timezones.includes('Europe/London')).toBe(true);
    });
  });

  describe('getTimezoneOffset', () => {
    it('should return offset string for valid timezone', () => {
      const offset = getTimezoneOffset('America/New_York');
      expect(typeof offset).toBe('string');
      expect(offset).toMatch(/UTC|GMT/i);
    });

    it('should return UTC for invalid timezone', () => {
      const offset = getTimezoneOffset('Invalid/Timezone');
      expect(offset).toContain('UTC');
    });
  });

  describe('formatTimeInTimezone', () => {
    it('should format time in specified timezone', () => {
      const date = new Date(2024, 0, 15, 12, 30, 45);
      const time = formatTimeInTimezone(date, 'America/New_York', 'en-US');
      expect(typeof time).toBe('string');
      expect(time).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    });
  });

  describe('formatDateWithTimezone', () => {
    it('should format date with timezone info', () => {
      const date = new Date(2024, 0, 15);
      const result = formatDateWithTimezone(date, {
        timezone: 'America/New_York',
        locale: 'en-US',
      });
      expect(typeof result).toBe('string');
      expect(result).toContain('Jan');
      expect(result).toContain('15');
      expect(result).toMatch(/UTC|GMT/i);
    });

    it('should include time when specified', () => {
      const date = new Date(2024, 0, 15, 10, 30);
      const result = formatDateWithTimezone(date, {
        timezone: 'America/New_York',
        locale: 'en-US',
        includeTime: true,
      });
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });
  });

  describe('getUserTimezone', () => {
    it('should return a valid timezone string', () => {
      const tz = getUserTimezone();
      expect(typeof tz).toBe('string');
      expect(isValidTimezone(tz)).toBe(true);
    });
  });
});
