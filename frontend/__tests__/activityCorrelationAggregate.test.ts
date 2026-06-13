/**
 * aggregateActivityCorrelation — builds per-activity with/without rows from RAW
 * joined rows, keying every entry to its LOCAL day (replacing the old SQL
 * `date(e.date)` UTC grouping). Runs under the Brisbane pin (UTC+10).
 */
import {
  aggregateActivityCorrelation,
  computeActivityCorrelation,
  type ActivityCorrelationRawRow,
} from '@/components/visualisations/transforms/activityCorrelation';

const localMidnight = (y: number, m0: number, d: number) =>
  new Date(y, m0, d, 0, 0, 0).toISOString();

// Helper: an entry row joined to one activity (or none).
let nextId = 1;
const row = (
  iso: string,
  mood: number,
  activity: string | null,
): ActivityCorrelationRawRow => ({
  entry_id: nextId++,
  date: iso,
  mood,
  activity_id: activity ? 1 : null,
  activity_name: activity,
});
// Two activities sharing an entry need the SAME entry_id; use this for that.
const rowMulti = (
  id: number,
  iso: string,
  mood: number,
  activityId: number,
  activityName: string,
): ActivityCorrelationRawRow => ({
  entry_id: id,
  date: iso,
  mood,
  activity_id: activityId,
  activity_name: activityName,
});

describe('aggregateActivityCorrelation', () => {
  beforeEach(() => {
    nextId = 1;
  });

  it('splits days into with/without and averages the per-day means', () => {
    // "Yoga" on the 11th (mood 9) and 12th (mood 7); a no-activity entry on the
    // 13th (mood 3). Yoga: with = days {11,12} avg (9,7)=8; without = {13} = 3.
    const rows = [
      row(localMidnight(2026, 5, 11), 9, 'Yoga'),
      row(localMidnight(2026, 5, 12), 7, 'Yoga'),
      row(localMidnight(2026, 5, 13), 3, null),
    ];
    const out = aggregateActivityCorrelation(rows);
    const yoga = out.find((r) => r.activity_name === 'Yoga')!;
    expect(yoga.avg_with).toBe(8); // (9 + 7) / 2 per-day means
    expect(yoga.avg_without).toBe(3);
    expect(yoga.count_with).toBe(2);
    expect(yoga.count_without).toBe(1);
  });

  it('keys days LOCALLY so a backdated entry counts on its local day', () => {
    // Backdated Thursday-local-midnight entry (Wed in UTC) with an activity.
    // The activity-day set must contain 2026-06-11 (Thu), not 2026-06-10 (Wed).
    const rows = [
      row(localMidnight(2026, 5, 11), 10, 'Run'), // Thu local / Wed UTC
      row(localMidnight(2026, 5, 12), 4, null), // Fri, no activity
    ];
    const out = aggregateActivityCorrelation(rows);
    const run = out.find((r) => r.activity_name === 'Run')!;
    // Run's "with" day is the local Thursday (mood 10); "without" is Friday (4).
    expect(run.avg_with).toBe(10);
    expect(run.avg_without).toBe(4);
    expect(run.count_with).toBe(1);
    expect(run.count_without).toBe(1);
  });

  it('de-dupes an entry that carries multiple activities (day_avg counts it once)', () => {
    // One entry on the 11th (mood 8) with BOTH Yoga and Run; one no-activity
    // entry on the 12th (mood 2). day_avg for the 11th must be 8 (not 16/2).
    const rows = [
      rowMulti(100, localMidnight(2026, 5, 11), 8, 1, 'Yoga'),
      rowMulti(100, localMidnight(2026, 5, 11), 8, 2, 'Run'),
      row(localMidnight(2026, 5, 12), 2, null),
    ];
    const out = aggregateActivityCorrelation(rows);
    const yoga = out.find((r) => r.activity_name === 'Yoga')!;
    const run = out.find((r) => r.activity_name === 'Run')!;
    // Both have the 11th as their only "with" day (avg 8) and the 12th as
    // "without" (avg 2).
    expect(yoga.avg_with).toBe(8);
    expect(yoga.avg_without).toBe(2);
    expect(run.avg_with).toBe(8);
    expect(run.avg_without).toBe(2);
  });

  it('flows through computeActivityCorrelation gate end-to-end', () => {
    // Build 6 with-days and 6 without-days for "Walk" so it clears MIN_SAMPLES.
    const rows: ActivityCorrelationRawRow[] = [];
    for (let d = 1; d <= 6; d++) rows.push(row(localMidnight(2026, 5, d), 8, 'Walk'));
    for (let d = 7; d <= 12; d++) rows.push(row(localMidnight(2026, 5, d), 4, null));
    const { meaningful } = computeActivityCorrelation(aggregateActivityCorrelation(rows));
    const walk = meaningful.find((r) => r.activity_name === 'Walk');
    expect(walk).toBeDefined();
    expect(walk!.delta).toBeCloseTo(4, 5); // 8 - 4
    expect(walk!.isMeaningful).toBe(true);
  });

  it('never throws on degenerate input', () => {
    expect(aggregateActivityCorrelation([])).toEqual([]);
    expect(
      aggregateActivityCorrelation([
        { entry_id: 1, date: 'bad', mood: 5, activity_id: 1, activity_name: 'X' } as any,
      ]),
    ).toEqual([]);
  });
});
