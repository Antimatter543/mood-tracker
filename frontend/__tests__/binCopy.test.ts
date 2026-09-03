/**
 * Unit tests for the recycle bin's copy helpers.
 *
 * These matter more than "it's just strings" suggests: the countdown the user
 * reads has to agree with what `purgeExpiredBinEntries` will actually DO, and
 * both are elapsed-24h-period arithmetic on a UTC instant. A helper that keyed
 * off local calendar days would drift out of step with the sweep — the boundary
 * cases below are what pin that down.
 */
import {
  daysSinceDeleted,
  daysUntilPurge,
  describeDeletedAge,
  describePurgeCountdown,
  describeBinRow,
} from '@/components/timeline/binCopy';

const DAY = 86_400_000;
const NOW = new Date('2026-08-01T12:00:00.000Z');
/** An instant `days` (plus optional hours) before NOW. */
const ago = (days: number, hours = 0): string =>
  new Date(NOW.getTime() - days * DAY - hours * 3_600_000).toISOString();

const RETENTION = 30;

describe('daysSinceDeleted', () => {
  it('floors to whole 24h periods', () => {
    expect(daysSinceDeleted(ago(0), NOW)).toBe(0);
    expect(daysSinceDeleted(ago(0, 23), NOW)).toBe(0); // 23h elapsed is still "today"
    expect(daysSinceDeleted(ago(1), NOW)).toBe(1);
    expect(daysSinceDeleted(ago(1, 23), NOW)).toBe(1);
    expect(daysSinceDeleted(ago(29, 23), NOW)).toBe(29);
    expect(daysSinceDeleted(ago(30), NOW)).toBe(30);
  });

  it('clamps a FUTURE instant to 0 rather than going negative', () => {
    // A device clock that moved backwards, or a backup restored from a phone an
    // hour ahead: "deleted in -1 days" is nonsense, "today" is not.
    const future = new Date(NOW.getTime() + 5 * DAY).toISOString();
    expect(daysSinceDeleted(future, NOW)).toBe(0);
  });

  it('returns null (not NaN) for an unparseable instant', () => {
    expect(daysSinceDeleted('not-a-date', NOW)).toBeNull();
    expect(daysSinceDeleted('', NOW)).toBeNull();
  });
});

describe('daysUntilPurge', () => {
  it('counts down from the retention window and floors at 0', () => {
    expect(daysUntilPurge(ago(0), NOW, RETENTION)).toBe(30);
    expect(daysUntilPurge(ago(1), NOW, RETENTION)).toBe(29);
    expect(daysUntilPurge(ago(29), NOW, RETENTION)).toBe(1);
    // Day 30 is exactly the sweep's cutoff — 0 left, purged on next open.
    expect(daysUntilPurge(ago(30), NOW, RETENTION)).toBe(0);
    // Already past due (the sweep hasn't run yet) must not go negative.
    expect(daysUntilPurge(ago(45), NOW, RETENTION)).toBe(0);
  });

  it('returns null for an unparseable instant', () => {
    expect(daysUntilPurge('nope', NOW, RETENTION)).toBeNull();
  });
});

describe('describeDeletedAge', () => {
  it('uses today / yesterday / N days ago', () => {
    expect(describeDeletedAge(ago(0), NOW)).toBe('Deleted today');
    expect(describeDeletedAge(ago(1), NOW)).toBe('Deleted yesterday');
    expect(describeDeletedAge(ago(2), NOW)).toBe('Deleted 2 days ago');
    expect(describeDeletedAge(ago(29), NOW)).toBe('Deleted 29 days ago');
  });

  it('degrades to vague copy rather than rendering NaN', () => {
    expect(describeDeletedAge('garbage', NOW)).toBe('Deleted recently');
  });
});

describe('describePurgeCountdown', () => {
  it('singularises one day and names the terminal state', () => {
    expect(describePurgeCountdown(ago(0), NOW, RETENTION)).toBe('30 days left');
    expect(describePurgeCountdown(ago(29), NOW, RETENTION)).toBe('1 day left');
    expect(describePurgeCountdown(ago(30), NOW, RETENTION)).toBe('Deletes on next open');
    expect(describePurgeCountdown(ago(31), NOW, RETENTION)).toBe('Deletes on next open');
  });

  it('is null when the instant is unparseable', () => {
    expect(describePurgeCountdown('garbage', NOW, RETENTION)).toBeNull();
  });
});

describe('describeBinRow', () => {
  it('joins the age and the countdown', () => {
    expect(describeBinRow(ago(0), NOW, RETENTION)).toBe('Deleted today · 30 days left');
    expect(describeBinRow(ago(3), NOW, RETENTION)).toBe('Deleted 3 days ago · 27 days left');
  });

  it('falls back to the age alone when the countdown is unavailable', () => {
    expect(describeBinRow('garbage', NOW, RETENTION)).toBe('Deleted recently');
  });

  it('never shows a countdown that outlives the retention window', () => {
    // Class-level: for every day in (and past) the window, "days left" is always
    // within [0, RETENTION] — no off-by-one can put "31 days left" on screen.
    for (let d = 0; d <= RETENTION + 5; d++) {
      const left = daysUntilPurge(ago(d), NOW, RETENTION);
      expect(left).not.toBeNull();
      expect(left as number).toBeGreaterThanOrEqual(0);
      expect(left as number).toBeLessThanOrEqual(RETENTION);
    }
  });
});
