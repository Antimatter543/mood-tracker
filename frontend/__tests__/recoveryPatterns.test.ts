import {
  analyseRecoveryPatterns,
  groupRecoveryRows,
  sparklineDatePoints,
  LOW_STRETCH_EXPLAINER,
  DIP_THRESHOLD,
  NONRECOVERY_THRESHOLD,
  RECOVERY_THRESHOLD,
  MIN_RECOVERY_DAYS,
  MIN_NONRECOVERY_DAYS,
  type MoodActivityRow,
  type RecoveryRawRow,
} from '@/components/visualisations/transforms/recoveryPatterns';
import { localDateTimeString } from '@/databases/dateHelpers';
import { makeActivity } from '@/testing/builders';
import type { Activity } from '@/components/types';

let nextId = 1;

// Helper: build rows oldest first (matches the SQL's ORDER BY e.date, e.id).
const series = (...pairs: [string, number][]): MoodActivityRow[] =>
  pairs.map(([date, mood]) => ({ id: nextId++, date: date, mood: mood, activities: []}));

describe('analyseRecoveryPatterns', () => {
  it('handles empty input gracefully (was a crash risk)', () => {
    const r = analyseRecoveryPatterns([]);
    expect(r.currentEpisode).toBeNull();
    expect(r.historicalEpisodes).toEqual([]);
    expect(r.episodeCount).toBe(0);
    expect(r.recoveredCount).toBe(0);
    expect(r.avgRecoveredDays).toBeNull();
  });

  it('handles single-entry input without crashing', () => {
    const r = analyseRecoveryPatterns(series(['2025-06-15', 2]));
    expect(r.historicalEpisodes).toEqual([]);
    // The stretch starts and stays open.
    expect(r.currentEpisode?.durationDays).toBe(1);
    expect(r.currentEpisode?.endDate).toBeNull();
    expect(r.episodeCount).toBe(1);
  });

  it('does not start an episode when mood stays above DIP_THRESHOLD', () => {
    const r = analyseRecoveryPatterns(
      series(['2025-06-01', 7], ['2025-06-02', 8], ['2025-06-03', 6]),
    );
    expect(r.currentEpisode).toBeNull();
    expect(r.historicalEpisodes).toEqual([]);
  });

  it('starts an episode when mood dips below DIP_THRESHOLD', () => {
    const r = analyseRecoveryPatterns(
      series(['2025-06-01', 3]),
    );
    expect(r.currentEpisode).not.toBeNull();
    expect(r.currentEpisode?.worstMood).toBe(3);
    expect(r.currentEpisode?.recovered).toBe(false);
  });

  it('closes an episode when sustained recovery occurs', () => {
    // Two days at >= RECOVERY_THRESHOLD (6) confirms sustained recovery.
    const r = analyseRecoveryPatterns(
      series(
        ['2025-06-01', 3], // dip
        ['2025-06-02', 5], // climbing
        ['2025-06-03', 7], // recovery candidate; need next day >= 6
        ['2025-06-04', 8], // sustained
      ),
    );
    expect(r.historicalEpisodes.length).toBe(1);
    expect(r.historicalEpisodes[0].recovered).toBe(true);
    expect(r.episodeCount).toBe(1);
    expect(r.recoveredCount).toBe(1);
  });

  it('does not close an episode if next day relapses', () => {
    const r = analyseRecoveryPatterns(
      series(
        ['2025-06-01', 3], // dip
        ['2025-06-02', 7], // recovery candidate
        ['2025-06-03', 4], // relapse — not sustained
        ['2025-06-04', 5],
      ),
    );
    // Should keep building the episode rather than mark it closed.
    expect(r.historicalEpisodes).toEqual([]);
    expect(r.currentEpisode).not.toBeNull();
  });

  it('keeps an episode open at the end of the series when no sustained recovery yet', () => {
    const r = analyseRecoveryPatterns(
      series(
        ['2025-06-01', 3],
        ['2025-06-02', 4],
        ['2025-06-03', 5],
      ),
    );
    expect(r.currentEpisode).not.toBeNull();
    expect(r.historicalEpisodes).toEqual([]);
  });

  it('averages duration across completed episodes', () => {
    const r = analyseRecoveryPatterns(
      series(
        // ep 1
        ['2025-06-01', 3],
        ['2025-06-02', 7], ['2025-06-03', 7],
        // ep 2
        ['2025-06-10', 2],
        ['2025-06-11', 6], ['2025-06-12', 6],
      ),
    );
    expect(r.historicalEpisodes.length).toBe(2);
    // Both stretches span three calendar days.
    expect(r.avgRecoveredDays).toBe(3);
  });

  it('ignores NaN mood values without crashing', () => {
    const rows = series(['2025-06-01', NaN], ['2025-06-02', 5]);
    expect(() => analyseRecoveryPatterns(rows)).not.toThrow();
  });

  it('stores the worst mood during the period', () => {
    const r = analyseRecoveryPatterns(
      series(
        // ep 1
        ['2025-06-01T09:00:00', 3],
        ['2025-06-01T18:00:00', 2],
        ['2025-06-01T21:00:00', 1],
        ['2025-06-02T12:00:00', 7],
        ['2025-06-02T21:00:00', 7],
        ['2025-06-03T12:00:00', 8],
        // ep 2
        ['2025-06-07T09:00:00', 3],
        ['2025-06-07T18:00:00', 0],
        ['2025-06-07T21:00:00', 3],
        ['2025-06-08T12:00:00', 4],
        ['2025-06-09T12:00:00', 5],
        ['2025-06-10T21:00:00', 7],
        ['2025-06-11T09:00:00', 9],
      ),
    );
    expect(r.historicalEpisodes.length).toBe(2);
    expect(r.historicalEpisodes.at(0)?.worstMood).toBe(0);
    expect(r.historicalEpisodes.at(0)?.currentMood).toBe(9);
    expect(r.historicalEpisodes.at(1)?.worstMood).toBe(1);
    expect(r.historicalEpisodes.at(1)?.currentMood).toBe(8);
  });


  it('doesn\'t count days with dip towards recovery time', () => {
    const r = analyseRecoveryPatterns(
      series(
        ['2025-06-01T09:00:00', 3],
        ['2025-06-01T18:00:00', 0],
        ['2025-06-01T21:00:00', 3],
        ['2025-06-02T12:00:00', 4],
        ['2025-06-03T12:00:00', 5],
        ['2025-06-04T21:00:00', 7],
        ['2025-06-05T09:00:00', 9],

        ['2025-06-10T09:00:00', 3],
        ['2025-06-10T18:00:00', 2],
        ['2025-06-10T21:00:00', 1],
        ['2025-06-11T12:00:00', 5],
        ['2025-06-11T18:00:00', 4],
        ['2025-06-11T21:00:00', 7],
        ['2025-06-12T12:00:00', 8],
      ),
    );
    expect(r.historicalEpisodes.length).toBe(1);
    expect(r.historicalEpisodes.at(0)?.durationDays).toBe(5);
    expect(r.historicalEpisodes.at(0)?.worstMood).toBe(0);

    expect(r.currentEpisode).not.toBeNull();
    expect(r.currentEpisode!.endDate).toBeNull();
    expect(r.currentEpisode!.worstMood).toBe(1)
    expect(r.currentEpisode!.recovered).toBe(false)
  });

  it('doesn\'t count day as recovery, if the day has a dip', () => {
    let r = analyseRecoveryPatterns(
      series(
        ['2025-06-01T09:00:00', 3],
        ['2025-06-01T18:00:00', 0],
        ['2025-06-01T21:00:00', 3],
        ['2025-06-02T12:00:00', 4],
        ['2025-06-03T12:00:00', 5],
        ['2025-06-04T21:00:00', 7],
        ['2025-06-05T09:00:00', 9],
        ['2025-06-05T12:00:00', 4],
      ),
    );
    expect(r.historicalEpisodes.length).toBe(0);
    expect(r.currentEpisode).not.toBeNull();
    expect(r.currentEpisode!.endDate).toBeNull();
    expect(r.currentEpisode!.worstMood).toBe(0)
    expect(r.currentEpisode!.entries.length).toBe(8)
    expect(r.currentEpisode!.recovered).toBe(false)

    r = analyseRecoveryPatterns(
      series(
        ['2025-06-01T09:00:00', 3],
        ['2025-06-01T18:00:00', 0],
        ['2025-06-01T21:00:00', 3],
        ['2025-06-02T12:00:00', 4],
        ['2025-06-03T12:00:00', 5],
        ['2025-06-04T21:00:00', 7],
        ['2025-06-05T12:00:00', 9],
        ['2025-06-05T18:00:00', 4],
      ),
    );
    expect(r.historicalEpisodes.length).toBe(0);
    expect(r.currentEpisode).not.toBeNull();
    expect(r.currentEpisode!.endDate).toBeNull();
    expect(r.currentEpisode!.worstMood).toBe(0)
    expect(r.currentEpisode!.entries.length).toBe(8)
    expect(r.currentEpisode!.recovered).toBe(false)
  });

  it('doesn\'t count day as recovery, if the following day has a dip', () => {
    const r = analyseRecoveryPatterns(
      series(
        ['2025-06-01T09:00:00', 3],
        ['2025-06-01T18:00:00', 0],
        ['2025-06-01T21:00:00', 3],
        ['2025-06-02T12:00:00', 4],
        ['2025-06-03T12:00:00', 5],
        ['2025-06-04T21:00:00', 7],
        ['2025-06-05T09:00:00', 9],
        ['2025-06-06T12:00:00', 4],
      ),
    );
    expect(r.historicalEpisodes.length).toBe(0);
    expect(r.currentEpisode).not.toBeNull();
    expect(r.currentEpisode!.endDate).toBeNull();
    expect(r.currentEpisode!.worstMood).toBe(0)
    expect(r.currentEpisode!.entries.length).toBe(8)
    expect(r.currentEpisode!.recovered).toBe(false)
  });

  it('calculates duration as days, not as number of entries for date time entries', () => {
    const r = analyseRecoveryPatterns(
      series(
        // ep 1
        ['2025-06-01T09:00:00', 3],
        ['2025-06-01T18:00:00', 2],
        ['2025-06-01T21:00:00', 1],
        ['2025-06-02T12:00:00', 5],
        ['2025-06-02T18:00:00', 7],
        ['2025-06-02T21:00:00', 7],
        ['2025-06-03T12:00:00', 8],
        // ep 2
        ['2025-06-07T09:00:00', 3],
        ['2025-06-07T18:00:00', 0],
        ['2025-06-07T21:00:00', 3],
        ['2025-06-08T12:00:00', 4],
        ['2025-06-09T12:00:00', 5],
        ['2025-06-10T18:00:00', 7],
        ['2025-06-10T21:00:00', 7],
        ['2025-06-11T12:00:00', 9],
      ),
    );
    expect(r.historicalEpisodes.length).toBe(2);
    expect(r.historicalEpisodes.at(0)?.durationDays).toBe(5);
    expect(r.historicalEpisodes.at(0)?.worstMood).toBe(0);
    expect(r.historicalEpisodes.at(0)?.currentMood).toBe(9);
    expect(r.historicalEpisodes.at(1)?.durationDays).toBe(3);
    expect(r.historicalEpisodes.at(1)?.worstMood).toBe(1);
    expect(r.historicalEpisodes.at(1)?.currentMood).toBe(8);
  });

  it('calculates duration correctly for date only entries', () => {
    const r = analyseRecoveryPatterns(
      series(
        // ep 1
        ['2025-06-01', 3],
        ['2025-06-02', 7], ['2025-06-03', 7],
        // ep 2
        ['2025-06-09', 2],
        ['2025-06-10', 4],
        ['2025-06-11', 6], ['2025-06-12', 6],
      ),
    );
    expect(r.historicalEpisodes.length).toBe(2);
    expect(r.historicalEpisodes.at(0)?.durationDays).toBe(4);
    expect(r.historicalEpisodes.at(1)?.durationDays).toBe(3);
    expect(r.avgRecoveredDays).toBe(3.5);
  });
});

// Rows with activities attached: [date, mood, activities].
const tagged = (...rows: [string, number, Activity[]][]): MoodActivityRow[] =>
  rows.map(([date, mood, activities]) => ({ id: nextId++, date, mood, activities }));

const names = (set: Set<Activity>) => [...set].map((a) => a.name).sort();

describe('how a low stretch ends (day-count rules)', () => {
  it('d1: four days at 5 end the stretch as steady at 5+ on the fourth', () => {
    const r = analyseRecoveryPatterns(
      series(['2025-06-01', 3], ['2025-06-02', 5], ['2025-06-03', 5], ['2025-06-04', 5], ['2025-06-05', 5]),
    );
    expect(r.currentEpisode).toBeNull();
    expect(r.historicalEpisodes).toHaveLength(1);
    const ep = r.historicalEpisodes[0];
    expect(ep.recovered).toBe(false);
    expect(ep.endDate).toBe('2025-06-05');
    expect(ep.durationDays).toBe(5);
    expect(r.recoveredCount).toBe(0);
    expect(r.avgRecoveredDays).toBeNull();
  });

  it('g2: three entries at 5 on two days do not end it (days, not entries or span)', () => {
    const r = analyseRecoveryPatterns(
      series(['2025-06-01', 3], ['2025-06-02', 5], ['2025-06-05', 5]),
    );
    expect(r.historicalEpisodes).toEqual([]);
    expect(r.currentEpisode).not.toBeNull();
  });

  it('several 5s on ONE day count as one day', () => {
    const r = analyseRecoveryPatterns(
      series(
        ['2025-06-01T09:00:00', 3],
        ['2025-06-02T08:00:00', 5], ['2025-06-02T12:00:00', 5],
        ['2025-06-02T16:00:00', 5], ['2025-06-02T20:00:00', 5],
      ),
    );
    expect(r.historicalEpisodes).toEqual([]);
    expect(r.currentEpisode).not.toBeNull();
  });

  it('g1: 6+ on two separate days with nothing lower between is back to 6+', () => {
    const r = analyseRecoveryPatterns(
      series(['2025-06-01', 3], ['2025-06-02', 6], ['2025-06-09', 6]),
    );
    expect(r.historicalEpisodes).toHaveLength(1);
    expect(r.historicalEpisodes[0].recovered).toBe(true);
    expect(r.historicalEpisodes[0].endDate).toBe('2025-06-09');
    expect(r.historicalEpisodes[0].durationDays).toBe(9);
  });

  it('two 6+ entries on ONE day are not back to 6+', () => {
    const r = analyseRecoveryPatterns(
      series(['2025-06-01T09:00:00', 3], ['2025-06-02T09:00:00', 7], ['2025-06-02T20:00:00', 8]),
    );
    expect(r.historicalEpisodes).toEqual([]);
    expect(r.currentEpisode).not.toBeNull();
  });

  it('b: a dip after a 5 is counted, and the stretch is back to 6+ on D5', () => {
    const r = analyseRecoveryPatterns(
      series(['2025-06-01', 3], ['2025-06-02', 5], ['2025-06-03', 3], ['2025-06-04', 6], ['2025-06-05', 7]),
    );
    expect(r.historicalEpisodes).toHaveLength(1);
    const ep = r.historicalEpisodes[0];
    expect(ep.dips).toBe(1);
    expect(ep.recovered).toBe(true);
    expect(ep.endDate).toBe('2025-06-05');
    expect(ep.durationDays).toBe(5);
    expect(ep.worstMood).toBe(3);
  });

  it('lists ended stretches newest first and counts the current one', () => {
    const r = analyseRecoveryPatterns(
      series(
        ['2025-06-01', 3], ['2025-06-02', 7], ['2025-06-03', 7],
        ['2025-06-10', 2], ['2025-06-11', 6], ['2025-06-12', 6],
        ['2025-06-20', 4],
      ),
    );
    expect(r.historicalEpisodes.map((e) => e.startDate)).toEqual(['2025-06-10', '2025-06-01']);
    expect(r.currentEpisode?.startDate).toBe('2025-06-20');
    expect(r.episodeCount).toBe(3);
    expect(r.recoveredCount).toBe(2);
  });
});

describe('activity lists', () => {
  const X = makeActivity({ id: 101, name: 'X' });
  const Y = makeActivity({ id: 102, name: 'Y' });
  const Z = makeActivity({ id: 103, name: 'Z' });

  it('i1: a fall from 9 to 6 is not a lift (X is on neither list)', () => {
    const r = analyseRecoveryPatterns(
      tagged(['2025-06-01', 3, [X]], ['2025-06-02', 9, [Y]], ['2025-06-03', 6, [X]]),
    );
    expect(r.historicalEpisodes).toHaveLength(1);
    const ep = r.historicalEpisodes[0];
    expect(names(ep.recoveringActivities)).toEqual([]);
    expect(names(ep.worseningActivities)).toEqual([]);
  });

  it('i2: an activity logged on one entry is not listed', () => {
    const r = analyseRecoveryPatterns(
      tagged(['2025-06-01', 3, []], ['2025-06-02', 7, [Z]], ['2025-06-03', 7, []]),
    );
    expect(names(r.historicalEpisodes[0].recoveringActivities)).toEqual([]);
  });

  it('lists an activity logged on two lifting entries (positive control)', () => {
    const r = analyseRecoveryPatterns(
      tagged(['2025-06-01', 3, []], ['2025-06-02', 7, [Z]], ['2025-06-03', 7, [Z]]),
    );
    expect(names(r.historicalEpisodes[0].recoveringActivities)).toEqual(['Z']);
    expect(names(r.historicalEpisodes[0].worseningActivities)).toEqual([]);
  });

  it('lists an activity logged as moods dropped', () => {
    const r = analyseRecoveryPatterns(
      tagged(['2025-06-01', 4, [Y]], ['2025-06-02', 3, [Y]], ['2025-06-03', 2, [Y]]),
    );
    expect(names(r.currentEpisode!.worseningActivities)).toEqual(['Y']);
    expect(names(r.currentEpisode!.recoveringActivities)).toEqual([]);
  });

  it('counts an activity once per entry even if attached twice', () => {
    const r = analyseRecoveryPatterns(
      tagged(['2025-06-01', 3, []], ['2025-06-02', 7, [Z, Z]], ['2025-06-03', 7, []]),
    );
    expect(names(r.historicalEpisodes[0].recoveringActivities)).toEqual([]);
  });
});

describe('unparseable dates', () => {
  it('h1: a bad date on the last row is skipped, not thrown', () => {
    const rows = series(['2025-06-01', 3], ['2025-06-02', 5], ['not-a-date', 7]);
    let r!: ReturnType<typeof analyseRecoveryPatterns>;
    expect(() => { r = analyseRecoveryPatterns(rows); }).not.toThrow();
    expect(r.currentEpisode?.entries).toHaveLength(2);
  });

  it('h2: a bad date on a low mood is skipped, not thrown', () => {
    const rows = series(['2025-06-01', 7], ['garbage', 2], ['2025-06-03', 7]);
    let r!: ReturnType<typeof analyseRecoveryPatterns>;
    expect(() => { r = analyseRecoveryPatterns(rows); }).not.toThrow();
    expect(r.episodeCount).toBe(0);
  });

  it('h5: SQLite-style "YYYY-MM-DD HH:MM:SS" stamps are read as local times', () => {
    const r = analyseRecoveryPatterns(
      series(['2025-06-01 09:00:00', 3], ['2025-06-02 09:00:00', 7], ['2025-06-03 09:00:00', 7]),
    );
    expect(r.historicalEpisodes).toHaveLength(1);
    expect(r.historicalEpisodes[0].durationDays).toBe(3);
  });
});

describe('LOW_STRETCH_EXPLAINER says what the code does', () => {
  const WORDS: Record<number, string> = { 2: 'two', 3: 'three', 4: 'four', 5: 'five' };

  it('names every threshold and day count the loop uses', () => {
    expect(LOW_STRETCH_EXPLAINER).toContain(`${DIP_THRESHOLD} or lower`);
    expect(LOW_STRETCH_EXPLAINER).toContain(`${RECOVERY_THRESHOLD} or more`);
    expect(LOW_STRETCH_EXPLAINER).toContain(`${NONRECOVERY_THRESHOLD} or more`);
    expect(LOW_STRETCH_EXPLAINER).toContain(`${WORDS[MIN_RECOVERY_DAYS]} days`);
    expect(LOW_STRETCH_EXPLAINER).toContain(`${WORDS[MIN_NONRECOVERY_DAYS]} days`);
    expect(LOW_STRETCH_EXPLAINER).toContain('90 days');
  });

  it('uses none of the retired words', () => {
    expect(LOW_STRETCH_EXPLAINER).not.toMatch(/episode|success|%|recovered|worsening|ongoing/i);
  });
});

describe('groupRecoveryRows', () => {
  const raw = (over: Partial<RecoveryRawRow>): RecoveryRawRow => ({
    id: 1, date: '2025-06-01T02:00:00.000Z', mood: 5,
    aId: null, aName: null, aGroup: null, aIconFamily: null, aIconName: null, aPosition: null,
    ...over,
  });
  const act = (id: number, name: string) => ({
    aId: id, aName: name, aGroup: 2, aIconFamily: 'Feather' as const, aIconName: 'book', aPosition: 3,
  });

  it('folds one row per activity into one entry per id, sharing Activity objects', () => {
    const rows = groupRecoveryRows([
      raw({ id: 1, ...act(10, 'Reading') }),
      raw({ id: 1, ...act(11, 'Walk') }),
      raw({ id: 2, date: '2025-06-02T02:00:00.000Z', mood: 7 }),
      raw({ id: 3, date: '2025-06-03T02:00:00.000Z', ...act(10, 'Reading') }),
    ]);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(rows[0].activities.map((a) => a.name)).toEqual(['Reading', 'Walk']);
    expect(rows[1].activities).toEqual([]);
    expect(rows[2].activities[0]).toBe(rows[0].activities[0]);
    expect(rows[0].activities[0]).toEqual({
      id: 10, name: 'Reading', group_id: 2, icon_family: 'Feather', icon_name: 'book', position: 3,
    });
    expect(rows[0].date).toBe(localDateTimeString('2025-06-01T02:00:00.000Z'));
  });

  it('skips a row whose date does not parse instead of throwing', () => {
    const rows = groupRecoveryRows([
      raw({ id: 1, date: 'nope' }),
      raw({ id: 2 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual([2]);
  });
});

describe('sparklineDatePoints', () => {
  it('puts a single point in the middle', () => {
    expect(sparklineDatePoints([{ date: '2025-06-01T09:00:00', mood: 5 }], 200, 100)).toEqual([
      { x: 100, y: 50 },
    ]);
  });

  it('spreads two points across the full width by time', () => {
    const pts = sparklineDatePoints(
      [{ date: '2025-06-01T09:00:00', mood: 0 }, { date: '2025-06-03T09:00:00', mood: 10 }],
      200, 100,
    );
    expect(pts).toEqual([{ x: 0, y: 100 }, { x: 200, y: 0 }]);
  });

  it('never returns NaN when every entry shares one instant', () => {
    const pts = sparklineDatePoints(
      [{ date: '2025-06-01T09:00:00', mood: 3 }, { date: '2025-06-01T09:00:00', mood: 7 }],
      200, 100,
    );
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    expect(pts.map((p) => p.x)).toEqual([100, 100]);
  });

  it('returns nothing before the view has a width', () => {
    expect(sparklineDatePoints([{ date: '2025-06-01', mood: 5 }], 0, 100)).toEqual([]);
  });
});
