import {
  buildHeatmapGrid,
  type HeatmapInput,
} from '@/components/visualisations/transforms/heatmap';

describe('buildHeatmapGrid', () => {
  it('returns an empty grid for empty input', () => {
    const out = buildHeatmapGrid([]);
    expect(out.cells).toEqual([]);
    expect(out.monthLabels).toEqual([]);
    expect(out.totalWeeks).toBe(0);
  });

  it('produces cells in Monday-start week ordering (day 0 = Mon)', () => {
    // 2025-06-15 is a Sunday → dayIndex 6 under Monday-start convention
    const rows: HeatmapInput[] = [
      { date: '2025-06-15', mood: 7 },
    ];
    const out = buildHeatmapGrid(rows);
    const cell = out.cells.find((c) => c.date === '2025-06-15');
    expect(cell?.dayIndex).toBe(6);
  });

  it('aligns Monday to dayIndex 0', () => {
    // 2025-06-16 is a Monday
    const rows: HeatmapInput[] = [{ date: '2025-06-16', mood: 5 }];
    const out = buildHeatmapGrid(rows);
    const cell = out.cells.find((c) => c.date === '2025-06-16');
    expect(cell?.dayIndex).toBe(0);
    expect(cell?.weekIndex).toBe(0); // starts the grid
  });

  it('snaps the grid start back to the previous Monday', () => {
    // 2025-06-15 is a Sunday. The grid should start on Monday 2025-06-09.
    const rows: HeatmapInput[] = [{ date: '2025-06-15', mood: 7 }];
    const out = buildHeatmapGrid(rows);
    expect(out.cells[0].date).toBe('2025-06-09');
    expect(out.cells[0].dayIndex).toBe(0);
  });

  it('produces a full month of cells (sparse mood lookup)', () => {
    // Build 30 days of data, but mood only on every 3rd day.
    const rows: HeatmapInput[] = Array.from({ length: 30 }, (_, i) => {
      const day = String(i + 1).padStart(2, '0');
      return { date: `2025-06-${day}`, mood: i % 3 === 0 ? 7 : null };
    });
    const out = buildHeatmapGrid(rows);
    // Every cell in [June 1..June 30] should have a mood lookup; gaps elsewhere stay null.
    const within = out.cells.filter(
      (c) => c.date >= '2025-06-01' && c.date <= '2025-06-30',
    );
    expect(within.length).toBe(30);
    const withMood = within.filter((c) => c.mood === 7);
    expect(withMood.length).toBe(10);
  });

  it('emits one month label per distinct month', () => {
    const rows: HeatmapInput[] = [
      { date: '2025-05-15', mood: 5 },
      { date: '2025-06-15', mood: 6 },
      { date: '2025-07-15', mood: 7 },
    ];
    const out = buildHeatmapGrid(rows);
    const months = out.monthLabels.map((m) => m.month);
    // Could include Apr/May depending on grid-start snapping; verify all 3 are present.
    expect(months).toEqual(expect.arrayContaining(['May', 'Jun', 'Jul']));
  });
});
