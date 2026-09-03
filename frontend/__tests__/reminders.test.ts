/**
 * lib/reminders.ts is the pure model behind the reminder LIST feature (see its
 * own docblock): it is the single place that turns an untrusted JSON blob from
 * `user_settings` into a valid, capped list of reminders, and back. No native
 * deps, so this suite needs zero jest mocks — a plain import is enough.
 *
 * `parseReminders` is TOTAL (never throws): the bulk of this file locks every
 * degrade path its own docblock promises, because that promise is exactly what
 * keeps a corrupted settings row from crashing the Settings screen.
 */

import {
  MAX_REMINDERS,
  DEFAULT_REMINDER_TIME,
  DEFAULT_REMINDER_LABEL,
  REMINDER_LABEL_MAX_LENGTH,
  LEGACY_REMINDER_LABEL,
  Reminder,
  isValidReminderTime,
  normalizeReminderTime,
  sanitizeReminderLabel,
  reminderDisplayLabel,
  makeReminderId,
  parseReminders,
  serializeReminders,
  canAddReminder,
  addReminder,
  updateReminder,
  removeReminder,
  enabledReminders,
  sortRemindersByTime,
  legacyReminderToList,
} from '@/lib/reminders';

const makeReminder = (overrides: Partial<Reminder> = {}): Reminder => ({
  id: 'reminder-1',
  label: 'Morning check-in',
  time: '08:00',
  enabled: true,
  ...overrides,
});

describe('isValidReminderTime', () => {
  it('accepts strict zero-padded HH:MM', () => {
    expect(isValidReminderTime('00:00')).toBe(true);
    expect(isValidReminderTime('08:05')).toBe(true);
    expect(isValidReminderTime('23:59')).toBe(true);
  });

  it('rejects non-strings', () => {
    expect(isValidReminderTime(undefined)).toBe(false);
    expect(isValidReminderTime(null)).toBe(false);
    expect(isValidReminderTime(800)).toBe(false);
    expect(isValidReminderTime({})).toBe(false);
  });

  it('rejects unpadded, out-of-range, and malformed strings', () => {
    for (const bad of ['9:05', '24:00', '12:60', '', '8:00 PM', '08:0', '08:005', 'abc', '08-05']) {
      expect(isValidReminderTime(bad)).toBe(false);
    }
  });
});

describe('normalizeReminderTime', () => {
  it('zero-pads a lenient single-digit hour', () => {
    expect(normalizeReminderTime('9:05')).toBe('09:05');
  });

  it('passes an already-canonical time through unchanged', () => {
    expect(normalizeReminderTime('14:45')).toBe('14:45');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeReminderTime('  09:05  ')).toBe('09:05');
  });

  it('falls back to DEFAULT_REMINDER_TIME for out-of-range or garbage input', () => {
    for (const bad of ['24:00', '12:60', 'not a time', '', undefined, null, 123, {}]) {
      expect(normalizeReminderTime(bad)).toBe(DEFAULT_REMINDER_TIME);
    }
  });
});

describe('sanitizeReminderLabel', () => {
  it('trims whitespace', () => {
    expect(sanitizeReminderLabel('  Evening reflection  ')).toBe('Evening reflection');
  });

  it('clamps to REMINDER_LABEL_MAX_LENGTH', () => {
    const long = 'x'.repeat(REMINDER_LABEL_MAX_LENGTH + 20);
    const clamped = sanitizeReminderLabel(long);
    expect(clamped.length).toBe(REMINDER_LABEL_MAX_LENGTH);
    expect(clamped).toBe('x'.repeat(REMINDER_LABEL_MAX_LENGTH));
  });

  it('collapses non-strings to the empty string', () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(sanitizeReminderLabel(bad)).toBe('');
    }
  });
});

describe('reminderDisplayLabel', () => {
  it('returns the label when set', () => {
    expect(reminderDisplayLabel(makeReminder({ label: 'Morning check-in' }))).toBe('Morning check-in');
  });

  it('falls back to DEFAULT_REMINDER_LABEL for an empty or whitespace-only label', () => {
    expect(reminderDisplayLabel(makeReminder({ label: '' }))).toBe(DEFAULT_REMINDER_LABEL);
    expect(reminderDisplayLabel(makeReminder({ label: '   ' }))).toBe(DEFAULT_REMINDER_LABEL);
  });
});

describe('makeReminderId', () => {
  it('returns reminder-1 for an empty list', () => {
    expect(makeReminderId([])).toBe('reminder-1');
  });

  it('returns one past the highest numeric suffix in use', () => {
    const list = [makeReminder({ id: 'reminder-1' }), makeReminder({ id: 'reminder-2' })];
    expect(makeReminderId(list)).toBe('reminder-3');
  });

  it('is order-independent — the max wins even out of order', () => {
    const list = [
      makeReminder({ id: 'reminder-5' }),
      makeReminder({ id: 'reminder-1' }),
      makeReminder({ id: 'reminder-3' }),
    ];
    expect(makeReminderId(list)).toBe('reminder-6');
  });

  it('ignores foreign-shaped ids that do not match the reminder- prefix', () => {
    const list = [makeReminder({ id: 'legacy-x' }), makeReminder({ id: 'reminder-2' })];
    expect(makeReminderId(list)).toBe('reminder-3');
  });

  it('never returns an id already present in the list', () => {
    const list = [makeReminder({ id: 'reminder-1' }), makeReminder({ id: 'reminder-2' }), makeReminder({ id: 'reminder-3' })];
    const id = makeReminderId(list);
    expect(list.some(r => r.id === id)).toBe(false);
  });
});

describe('parseReminders — total function, every degrade path', () => {
  it('returns [] for non-string input', () => {
    expect(parseReminders(undefined)).toEqual([]);
    expect(parseReminders(null)).toEqual([]);
    expect(parseReminders(42)).toEqual([]);
    expect(parseReminders({})).toEqual([]);
  });

  it('returns [] for empty or whitespace-only strings', () => {
    expect(parseReminders('')).toEqual([]);
    expect(parseReminders('   ')).toEqual([]);
  });

  it('returns [] for invalid JSON', () => {
    expect(parseReminders('{not json')).toEqual([]);
    expect(parseReminders('[1, 2,')).toEqual([]);
  });

  it('returns [] for valid JSON that is not an array', () => {
    expect(parseReminders('{"id":"reminder-1"}')).toEqual([]);
    expect(parseReminders('"just a string"')).toEqual([]);
    expect(parseReminders('42')).toEqual([]);
  });

  it('returns [] for a JSON array of primitives (no usable id)', () => {
    expect(parseReminders('[1, 2, 3]')).toEqual([]);
    expect(parseReminders('["a", "b"]')).toEqual([]);
    expect(parseReminders('[null, true, false]')).toEqual([]);
  });

  it('drops elements with no id or a non-string id', () => {
    const raw = JSON.stringify([
      { label: 'no id' },
      { id: 42, label: 'numeric id' },
      { id: null, label: 'null id' },
      { id: 'reminder-1', label: 'kept' },
    ]);
    const parsed = parseReminders(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('reminder-1');
    expect(parsed[0].label).toBe('kept');
  });

  it('first wins on a duplicate id', () => {
    const raw = JSON.stringify([
      { id: 'reminder-1', label: 'first', time: '08:00', enabled: true },
      { id: 'reminder-1', label: 'second', time: '09:00', enabled: false },
    ]);
    const parsed = parseReminders(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].label).toBe('first');
    expect(parsed[0].time).toBe('08:00');
    expect(parsed[0].enabled).toBe(true);
  });

  it('normalizes an invalid time to DEFAULT_REMINDER_TIME', () => {
    const raw = JSON.stringify([{ id: 'reminder-1', time: 'garbage' }]);
    expect(parseReminders(raw)[0].time).toBe(DEFAULT_REMINDER_TIME);
  });

  it('defaults a missing label to the empty string', () => {
    const raw = JSON.stringify([{ id: 'reminder-1' }]);
    expect(parseReminders(raw)[0].label).toBe('');
  });

  it.each([
    ['the string "true"', 'true'],
    [1, 1],
    [undefined, undefined],
    ['null', null],
  ])('coerces enabled=%s to false — only literal boolean true survives', (_desc, value) => {
    const raw = JSON.stringify([{ id: 'reminder-1', enabled: value }]);
    expect(parseReminders(raw)[0].enabled).toBe(false);
  });

  it('keeps enabled:true as true', () => {
    const raw = JSON.stringify([{ id: 'reminder-1', enabled: true }]);
    expect(parseReminders(raw)[0].enabled).toBe(true);
  });

  it('truncates to exactly MAX_REMINDERS when more entries are stored', () => {
    const entries = Array.from({ length: MAX_REMINDERS + 5 }, (_, i) => ({
      id: `reminder-${i + 1}`,
      label: `r${i + 1}`,
      time: '08:00',
      enabled: true,
    }));
    const parsed = parseReminders(JSON.stringify(entries));
    expect(parsed).toHaveLength(MAX_REMINDERS);
    expect(parsed[0].id).toBe('reminder-1');
    expect(parsed[MAX_REMINDERS - 1].id).toBe(`reminder-${MAX_REMINDERS}`);
  });

  it('ignores unknown extra fields — the parsed object has exactly the 4 known keys', () => {
    const raw = JSON.stringify([
      { id: 'reminder-1', label: 'x', time: '08:00', enabled: true, days: [1, 2, 3], sound: 'chime' },
    ]);
    const parsed = parseReminders(raw);
    expect(Object.keys(parsed[0]).sort()).toEqual(['enabled', 'id', 'label', 'time']);
  });
});

describe('serializeReminders / parseReminders round-trip', () => {
  it('round-trips a full list unchanged', () => {
    const list: Reminder[] = [
      makeReminder({ id: 'reminder-1', label: 'Morning', time: '08:00', enabled: true }),
      makeReminder({ id: 'reminder-2', label: '', time: '20:00', enabled: false }),
    ];
    expect(parseReminders(serializeReminders(list))).toEqual(list);
  });

  it('writes ONLY the 4 known fields, dropping any extra property a caller smuggles in', () => {
    const withExtra = { ...makeReminder(), sound: 'chime' } as unknown as Reminder;
    const json = serializeReminders([withExtra]);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(Object.keys(parsed[0]).sort()).toEqual(['enabled', 'id', 'label', 'time']);
    expect(json).not.toContain('sound');
  });
});

describe('canAddReminder / addReminder', () => {
  it('canAddReminder is true below the cap and false at it', () => {
    expect(canAddReminder([])).toBe(true);
    const full = Array.from({ length: MAX_REMINDERS }, (_, i) => makeReminder({ id: `reminder-${i + 1}` }));
    expect(canAddReminder(full)).toBe(false);
  });

  it('appends a reminder with a fresh id', () => {
    const list = [makeReminder({ id: 'reminder-1' })];
    const next = addReminder(list, { label: 'New one', time: '10:00' });
    expect(next).toHaveLength(2);
    expect(next[1].id).toBe('reminder-2');
    expect(next[0]).toEqual(list[0]); // untouched
  });

  it('defaults enabled to true and time to DEFAULT_REMINDER_TIME when unspecified', () => {
    const next = addReminder([], {});
    expect(next[0].enabled).toBe(true);
    expect(next[0].time).toBe(DEFAULT_REMINDER_TIME);
    expect(next[0].label).toBe('');
  });

  it('sanitizes the label and normalizes the time on the way in', () => {
    const next = addReminder([], { label: '  Trim me  ', time: '9:05' });
    expect(next[0].label).toBe('Trim me');
    expect(next[0].time).toBe('09:05');
  });

  it('respects an explicit enabled:false', () => {
    const next = addReminder([], { enabled: false });
    expect(next[0].enabled).toBe(false);
  });

  it('at the cap, returns the SAME array reference and never exceeds MAX_REMINDERS', () => {
    const full = Array.from({ length: MAX_REMINDERS }, (_, i) => makeReminder({ id: `reminder-${i + 1}` }));
    const result = addReminder(full, { label: 'overflow' });
    expect(result).toBe(full);
    expect(result).toHaveLength(MAX_REMINDERS);
  });
});

describe('updateReminder', () => {
  it('patches only the named reminder, leaving the others untouched', () => {
    const list = [
      makeReminder({ id: 'reminder-1', label: 'A' }),
      makeReminder({ id: 'reminder-2', label: 'B' }),
    ];
    const next = updateReminder(list, 'reminder-1', { label: 'A2' });
    expect(next[0].label).toBe('A2');
    expect(next[1]).toEqual(list[1]);
  });

  it('re-validates a patched invalid time', () => {
    const list = [makeReminder({ id: 'reminder-1', time: '08:00' })];
    const next = updateReminder(list, 'reminder-1', { time: 'garbage' });
    expect(next[0].time).toBe(DEFAULT_REMINDER_TIME);
  });

  it('returns the SAME array reference for an unknown id', () => {
    const list = [makeReminder({ id: 'reminder-1' })];
    const result = updateReminder(list, 'reminder-missing', { label: 'x' });
    expect(result).toBe(list);
  });

  it('a partial patch does not clobber unpatched fields', () => {
    const list = [makeReminder({ id: 'reminder-1', label: 'Keep', time: '08:00', enabled: true })];
    const next = updateReminder(list, 'reminder-1', { enabled: false });
    expect(next[0].label).toBe('Keep');
    expect(next[0].time).toBe('08:00');
    expect(next[0].enabled).toBe(false);
  });
});

describe('removeReminder', () => {
  it('removes the reminder by id', () => {
    const list = [makeReminder({ id: 'reminder-1' }), makeReminder({ id: 'reminder-2' })];
    const next = removeReminder(list, 'reminder-1');
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('reminder-2');
  });

  it('returns the SAME array reference for an unknown id', () => {
    const list = [makeReminder({ id: 'reminder-1' })];
    const result = removeReminder(list, 'reminder-missing');
    expect(result).toBe(list);
  });
});

describe('enabledReminders', () => {
  it('filters to only enabled reminders', () => {
    const list = [
      makeReminder({ id: 'reminder-1', enabled: true }),
      makeReminder({ id: 'reminder-2', enabled: false }),
      makeReminder({ id: 'reminder-3', enabled: true }),
    ];
    expect(enabledReminders(list).map(r => r.id)).toEqual(['reminder-1', 'reminder-3']);
  });

  it('returns [] for an all-disabled list', () => {
    const list = [makeReminder({ id: 'reminder-1', enabled: false })];
    expect(enabledReminders(list)).toEqual([]);
  });
});

describe('sortRemindersByTime', () => {
  it('sorts ascending by time', () => {
    const list = [
      makeReminder({ id: 'reminder-1', time: '20:00' }),
      makeReminder({ id: 'reminder-2', time: '08:00' }),
      makeReminder({ id: 'reminder-3', time: '14:30' }),
    ];
    expect(sortRemindersByTime(list).map(r => r.id)).toEqual(['reminder-2', 'reminder-3', 'reminder-1']);
  });

  it('breaks ties on equal time by id, ascending', () => {
    const list = [
      makeReminder({ id: 'reminder-3', time: '08:00' }),
      makeReminder({ id: 'reminder-1', time: '08:00' }),
      makeReminder({ id: 'reminder-2', time: '08:00' }),
    ];
    expect(sortRemindersByTime(list).map(r => r.id)).toEqual(['reminder-1', 'reminder-2', 'reminder-3']);
  });

  it('does not mutate the input array', () => {
    const list = [
      makeReminder({ id: 'reminder-1', time: '20:00' }),
      makeReminder({ id: 'reminder-2', time: '08:00' }),
    ];
    const originalOrder = list.map(r => r.id);
    sortRemindersByTime(list);
    expect(list.map(r => r.id)).toEqual(originalOrder);
  });
});

describe('legacyReminderToList', () => {
  it('always returns exactly one reminder, labelled LEGACY_REMINDER_LABEL, id reminder-1', () => {
    const list = legacyReminderToList(true, '07:30');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('reminder-1');
    expect(list[0].label).toBe(LEGACY_REMINDER_LABEL);
  });

  it('accepts the real boolean true/false', () => {
    expect(legacyReminderToList(true, '07:30')[0].enabled).toBe(true);
    expect(legacyReminderToList(false, '07:30')[0].enabled).toBe(false);
  });

  it('accepts the STRING "true"/"false" — how the value is stored in user_settings', () => {
    expect(legacyReminderToList('true', '07:30')[0].enabled).toBe(true);
    expect(legacyReminderToList('false', '07:30')[0].enabled).toBe(false);
  });

  it('preserves the legacy time', () => {
    expect(legacyReminderToList(true, '07:30')[0].time).toBe('07:30');
  });

  it('falls back to DEFAULT_REMINDER_TIME for undefined or garbage time', () => {
    expect(legacyReminderToList(true, undefined)[0].time).toBe(DEFAULT_REMINDER_TIME);
    expect(legacyReminderToList(true, 'garbage')[0].time).toBe(DEFAULT_REMINDER_TIME);
  });

  it('a user who had the reminder OFF keeps their time with enabled:false — no state lost', () => {
    const list = legacyReminderToList('false', '06:15');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ enabled: false, time: '06:15' });
  });
});
