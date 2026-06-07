import {
  pickReminderCopy,
  parseReminderTime,
  formatReminderTime,
  nextTriggerDate,
  hasLoggedToday,
} from '@/lib/notifications';

jest.mock('expo-notifications');

describe('pickReminderCopy', () => {
  it('returns start message for streak 0', () => {
    const { title } = pickReminderCopy(0);
    expect(title).toMatch(/check in/i);
  });

  it('mentions streak count for streak >= 2', () => {
    const { title } = pickReminderCopy(5);
    expect(title).toContain('5');
  });

  it('returns a title and body for all streak values', () => {
    for (const streak of [0, 1, 3, 7, 14, 30, 100]) {
      const result = pickReminderCopy(streak);
      expect(typeof result.title).toBe('string');
      expect(result.title.length).toBeGreaterThan(0);
      expect(typeof result.body).toBe('string');
      expect(result.body.length).toBeGreaterThan(0);
    }
  });

  it('treats negative streaks like a fresh start', () => {
    expect(pickReminderCopy(-1).title).toMatch(/check in/i);
  });
});

describe('parseReminderTime', () => {
  it('parses valid HH:MM', () => {
    expect(parseReminderTime('08:30')).toEqual({ hour: 8, minute: 30 });
    expect(parseReminderTime('20:00')).toEqual({ hour: 20, minute: 0 });
  });

  it('falls back to 20:00 on invalid input', () => {
    expect(parseReminderTime('invalid')).toEqual({ hour: 20, minute: 0 });
    expect(parseReminderTime('25:00')).toEqual({ hour: 20, minute: 0 });
    expect(parseReminderTime('12:75')).toEqual({ hour: 20, minute: 0 });
    expect(parseReminderTime('')).toEqual({ hour: 20, minute: 0 });
  });

  it('handles single-digit hours', () => {
    expect(parseReminderTime('9:05')).toEqual({ hour: 9, minute: 5 });
  });
});

describe('formatReminderTime', () => {
  it('zero-pads hour and minute', () => {
    expect(formatReminderTime(8, 5)).toBe('08:05');
    expect(formatReminderTime(20, 0)).toBe('20:00');
  });

  it('round-trips through parse', () => {
    const hhmm = '14:45';
    const { hour, minute } = parseReminderTime(hhmm);
    expect(formatReminderTime(hour, minute)).toBe(hhmm);
  });
});

describe('nextTriggerDate', () => {
  it('returns today when target time is in the future', () => {
    // 10:00 now, reminder at 20:00
    const now = new Date('2025-06-07T10:00:00');
    const result = nextTriggerDate(20, 0, now);
    expect(result.getDate()).toBe(now.getDate());
    expect(result.getHours()).toBe(20);
    expect(result.getMinutes()).toBe(0);
  });

  it('returns tomorrow when target time has already passed', () => {
    // 21:00 now, reminder at 20:00 — already passed
    const now = new Date('2025-06-07T21:00:00');
    const result = nextTriggerDate(20, 0, now);
    expect(result.getDate()).toBe(now.getDate() + 1);
  });

  it('returns tomorrow when exactly equal (at the boundary)', () => {
    const now = new Date('2025-06-07T20:00:00');
    const result = nextTriggerDate(20, 0, now);
    // Equal means we've passed, so schedule tomorrow
    expect(result.getDate()).toBe(now.getDate() + 1);
  });
});

describe('hasLoggedToday', () => {
  it('returns true when todayKey is in entryDates', () => {
    expect(hasLoggedToday('2025-06-07', ['2025-06-05', '2025-06-07'])).toBe(true);
  });

  it('returns false when todayKey is absent', () => {
    expect(hasLoggedToday('2025-06-07', ['2025-06-05', '2025-06-06'])).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(hasLoggedToday('2025-06-07', [])).toBe(false);
  });
});
