import {
  analyseRecoveryPatterns,
  type MoodActivityRow,
} from '@/components/visualisations/transforms/recoveryPatterns';

// Helper: build descending-by-date rows (matches the SQL's ORDER BY DESC).
const series = (...pairs: Array<[string, number]>): MoodActivityRow[] =>
  pairs.map(([date, mood]) => ({ date, mood }));

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
    expect(r.currentEpisode?.startMood).toBe(3);
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
    const rows: MoodActivityRow[] = [
      { date: '2025-06-01', mood: NaN },
      { date: '2025-06-02', mood: 5 },
    ];
    expect(() => analyseRecoveryPatterns(rows)).not.toThrow();
  });
});
