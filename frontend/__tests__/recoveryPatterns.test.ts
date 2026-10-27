import {
  analyseRecoveryPatterns,
  type MoodActivityRow,
} from '@/components/visualisations/transforms/recoveryPatterns';

let nextId = 1;

// Helper: build descending-by-date rows (matches the SQL's ORDER BY DESC).
const series = (...pairs: Array<[string, number]>): MoodActivityRow[] =>
  pairs.map(([date, mood]) => ({ id: nextId++, date: date, mood: mood, activities: []}));

describe('analyseRecoveryPatterns', () => {
  it('handles empty input gracefully (was a crash risk)', () => {
    const r = analyseRecoveryPatterns([]);
    expect(r.currentEpisode).toBeNull();
    expect(r.historicalEpisodes).toEqual([]);
    expect(r.successRate).toBe(0);
    expect(r.avgDuration).toBe(0);
  });

  it('handles single-entry input without crashing', () => {
    const r = analyseRecoveryPatterns(series(['2025-06-15', 2]));
    expect(r.historicalEpisodes).toEqual([]);
    // Episode starts but never closes — should be tracked as currentEpisode
    // OR be null if no dip was even reached; both are acceptable for size 1.
    // We mainly assert no crash.
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
    expect(r.successRate).toBe(100);
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
    expect(r.avgDuration).toBeGreaterThan(0);
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

    expect(r.currentEpisode).not.toBeNull
    expect(r.currentEpisode!.endDate).toBeNull
    expect(r.currentEpisode!.worstMood).toBe(1)
  });

  it('doesn\'t count days with dips after the end recovery towards recovery time', () => {
    const r = analyseRecoveryPatterns(
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
    expect(r.currentEpisode).not.toBeNull
    expect(r.currentEpisode!.endDate).toBeNull
    expect(r.currentEpisode!.worstMood).toBe(0)
    expect(r.currentEpisode!.entries.length).toBe(8)
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
    expect(r.avgDuration).toBeGreaterThan(0);
  });
});
