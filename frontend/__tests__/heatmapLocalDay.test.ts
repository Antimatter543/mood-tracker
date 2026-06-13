/**
 * Heatmap + calendar LOCAL-day path. The grid/marker transforms take
 * "YYYY-MM-DD" keys; the day-keying happens just upstream in the component via
 * aggregateDailyAverages. This verifies the composed path (raw instant ->
 * local-day key -> cell/marker) places a backdated entry on the right day.
 * Runs under the Brisbane pin (UTC+10).
 */
import { aggregateDailyAverages } from '@/components/visualisations/transforms/dailyAverages';
import { buildHeatmapGrid, type HeatmapInput } from '@/components/visualisations/transforms/heatmap';
import { buildCalendarMarkers } from '@/components/visualisations/transforms/calendarMarkers';

const localMidnight = (y: number, m0: number, d: number) =>
  new Date(y, m0, d, 0, 0, 0).toISOString();

// Reproduce the component's transform: raw instants -> {date: localDay, mood}.
const toDayRows = (rows: { date: string; mood: number }[]): HeatmapInput[] =>
  aggregateDailyAverages(rows).map((d) => ({ date: d.day, mood: d.avg }));

describe('heatmap places a backdated entry on its LOCAL day', () => {
  it('the cell for the backdated Thursday entry is dated 2026-06-11, not 2026-06-10', () => {
    const dayRows = toDayRows([
      { date: localMidnight(2026, 5, 11), mood: 9 }, // Thu local / Wed UTC
    ]);
    const grid = buildHeatmapGrid(dayRows);
    const cell = grid.cells.find((c) => c.mood === 9);
    expect(cell).toBeDefined();
    expect(cell!.date).toBe('2026-06-11'); // Thursday
    // And there is no populated cell on the UTC Wednesday.
    const wed = grid.cells.find((c) => c.date === '2026-06-10');
    expect(wed?.mood ?? null).toBeNull();
  });

  it('empty input -> empty grid (no throw on a fresh DB)', () => {
    expect(buildHeatmapGrid(toDayRows([]))).toEqual({
      cells: [],
      monthLabels: [],
      totalWeeks: 0,
    });
  });
});

describe('calendar marks a backdated entry on its LOCAL day', () => {
  it('the marker key is the local Thursday 2026-06-11', () => {
    const markerRows = aggregateDailyAverages([
      { date: localMidnight(2026, 5, 11), mood: 9 }, // Thu local / Wed UTC
    ]).map((d) => ({ date: d.day, avgMood: d.avg }));
    const markers = buildCalendarMarkers(markerRows);
    expect(Object.keys(markers)).toEqual(['2026-06-11']);
    expect(markers['2026-06-10']).toBeUndefined(); // not the UTC day
  });
});
