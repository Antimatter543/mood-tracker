/**
 * REGRESSION: the exact bug Anti reported (AEST / UTC+10).
 *
 *   "If it's Friday and I add a mood entry for Thursday (the form sets it to
 *    12am), the home page chart shows the green dot on WEDNESDAY, and my streak
 *    says 1 instead of 2."
 *
 * Root cause: a backdated entry is normalised to LOCAL midnight (Thursday 00:00
 * AEST = Wednesday 14:00 UTC). The visualisation SQL day-bucketed with SQLite's
 * `date(date)` / `strftime`, which run in UTC -> the entry bucketed onto
 * WEDNESDAY, and the streak feed (also UTC-keyed) saw only one day.
 *
 * Fix: day-keying moved out of SQL into one JS authority (localDateString /
 * aggregateDailyAverages). These tests assert the entry lands on the correct
 * LOCAL day and the streak counts both backdated days.
 *
 * This suite runs under the Brisbane TZ pin (jest.tz.js, UTC+10). It would FAIL
 * against the old UTC keying: the helper `utcDayKey` below reproduces exactly
 * what `date(date)` did, and we assert the correct local key DIFFERS from it for
 * the backdated instant — so the test is a true guard, not a vacuous one.
 */
import { aggregateDailyAverages } from '@/components/visualisations/transforms/dailyAverages';
import { localDateString } from '@/databases/dateHelpers';
import { currentStreak } from '@/components/visualisations/transforms/streak';

// What SQLite's `date(date)` produced: the UTC calendar day of the instant.
const utcDayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);

describe('backdated entry lands on the correct LOCAL day (the reported chart bug)', () => {
  // "Today" = Friday 2026-06-12; the user backdates an entry to Thursday at the
  // form's default of local midnight. In AEST that instant is Wednesday in UTC.
  const thursdayLocalMidnight = new Date(2026, 5, 11, 0, 0, 0); // Jun 11 (Thu) 00:00 local
  const thursdayInstant = thursdayLocalMidnight.toISOString();

  it('the instant really is the previous UTC day (this is the trap)', () => {
    // Sanity: confirm the scenario — local Thursday midnight stores as UTC
    // Wednesday. If this weren't true, the test couldn't catch the bug.
    expect(thursdayInstant).toBe('2026-06-10T14:00:00.000Z');
    expect(utcDayKey(thursdayInstant)).toBe('2026-06-10'); // WEDNESDAY (old buggy key)
    expect(localDateString(thursdayInstant)).toBe('2026-06-11'); // THURSDAY (correct)
  });

  it('aggregateDailyAverages buckets it on Thursday 2026-06-11, not Wednesday', () => {
    const daily = aggregateDailyAverages([{ date: thursdayInstant, mood: 7 }]);
    expect(daily).toHaveLength(1);
    expect(daily[0].day).toBe('2026-06-11'); // Thursday — the green dot's day
    expect(daily[0].day).not.toBe('2026-06-10'); // would FAIL under old UTC keying
    expect(daily[0].avg).toBe(7);
    expect(daily[0].count).toBe(1);
  });

  it('multiple entries on the same local Thursday average together (not split across days)', () => {
    const daily = aggregateDailyAverages([
      { date: new Date(2026, 5, 11, 0, 0, 0).toISOString(), mood: 6 }, // backdated midnight
      { date: new Date(2026, 5, 11, 21, 30, 0).toISOString(), mood: 8 }, // same day, evening
    ]);
    expect(daily).toHaveLength(1);
    expect(daily[0].day).toBe('2026-06-11');
    expect(daily[0].avg).toBe(7); // (6 + 8) / 2
    expect(daily[0].count).toBe(2);
  });
});

describe('streak counts the backdated day (the reported "1 instead of 2" bug)', () => {
  // Today = Friday 2026-06-12. Two entries: one today, one backdated to
  // Thursday at local midnight. Mapped through localDateString (as the app now
  // does) the streak must be 2.
  const todayLocal = '2026-06-12'; // Friday
  // Friday AFTERNOON (2pm Brisbane = 04:00 UTC) so today's entry is Friday in
  // BOTH local and UTC — it's the backdated Thursday entry alone that mis-keys.
  const todayInstant = new Date(2026, 5, 12, 14, 0, 0).toISOString();
  const yesterdayBackdated = new Date(2026, 5, 11, 0, 0, 0).toISOString(); // Thu local midnight

  it('streak is 2 when entries are today + yesterday-backdated-at-local-midnight', () => {
    const localDays = [todayInstant, yesterdayBackdated].map(localDateString);
    expect(localDays).toEqual(['2026-06-12', '2026-06-11']);
    expect(currentStreak(localDays, todayLocal)).toBe(2);
  });

  it('would have been 1 under the old UTC keying (proves the guard bites)', () => {
    // The old streak feed keyed via date(date) = UTC day. Friday-afternoon
    // today keys to Friday(12), but the Thursday backdated instant keys to
    // Wednesday(10) — leaving a Thursday(11) GAP before today, so the streak
    // collapses to just today = 1. Reproduce that to prove the contrast.
    const utcDays = [todayInstant, yesterdayBackdated].map(utcDayKey);
    expect(utcDays).toEqual(['2026-06-12', '2026-06-10']); // gap at the 11th
    expect(currentStreak(utcDays, todayLocal)).toBe(1); // the buggy answer
  });

  it('duplicate local days (multiple entries one day) still streak correctly', () => {
    // currentStreak tolerates duplicates, so mapping raw instants (no dedupe)
    // is safe — verify with two entries on the same backdated Thursday.
    const localDays = [
      todayInstant,
      yesterdayBackdated,
      new Date(2026, 5, 11, 20, 0, 0).toISOString(), // 2nd Thu entry
    ].map(localDateString);
    expect(currentStreak(localDays, todayLocal)).toBe(2);
  });
});
