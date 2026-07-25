import {
  dayEntriesSummary,
  type CorrelationRow,
} from '@/components/visualisations/transforms/daySummary';

// Brisbane pin (UTC+10). ACTIVITY_CORRELATION emits one row per entry×activity,
// plus a single activity_id=NULL row for an activity-less entry.
const rows: CorrelationRow[] = [
  // Entry 1 @ 09:00 local Jul 15 (23:00Z Jul 14) — two activities.
  { entry_id: 1, date: '2026-07-14T23:00:00.000Z', mood: 8, activity_id: 3, activity_name: 'Running' },
  { entry_id: 1, date: '2026-07-14T23:00:00.000Z', mood: 8, activity_id: 5, activity_name: 'Coffee' },
  // Entry 2 @ 20:00 local Jul 15 (10:00Z Jul 15) — no activities.
  { entry_id: 2, date: '2026-07-15T10:00:00.000Z', mood: 4, activity_id: null, activity_name: null },
  // Entry 3 on a DIFFERENT local day (Jul 16) — excluded from the Jul 15 summary.
  { entry_id: 3, date: '2026-07-16T02:00:00.000Z', mood: 6, activity_id: 3, activity_name: 'Running' },
];

describe('dayEntriesSummary', () => {
  it('groups by entry, collects each entry\'s activities, for the local day only', () => {
    const s = dayEntriesSummary(rows, '2026-07-15');
    expect(s.day).toBe('2026-07-15');
    expect(s.count).toBe(2); // entries 1 & 2 (entry 3 is Jul 16)
    expect(s.avgMood).toBe(6); // (8 + 4) / 2
    expect(s.entries.map((e) => e.id)).toEqual([1, 2]); // chronological
    expect(s.entries[0].activities).toEqual(['Running', 'Coffee']);
    expect(s.entries[1].activities).toEqual([]); // activity-less entry
  });

  it('excludes entries whose LOCAL day differs (windowed-query boundary)', () => {
    const s = dayEntriesSummary(rows, '2026-07-16');
    expect(s.count).toBe(1);
    expect(s.entries[0].id).toBe(3);
    expect(s.avgMood).toBe(6);
  });

  it('a day with no rows -> empty summary, avgMood null (never throws)', () => {
    expect(dayEntriesSummary([], '2026-07-15')).toEqual({
      day: '2026-07-15',
      count: 0,
      avgMood: null,
      entries: [],
    });
  });

  it('skips degenerate rows without throwing', () => {
    const s = dayEntriesSummary(
      [{ entry_id: 9, date: 'bogus', mood: 5, activity_id: null, activity_name: null }],
      '2026-07-15',
    );
    expect(s.count).toBe(0);
  });
});
