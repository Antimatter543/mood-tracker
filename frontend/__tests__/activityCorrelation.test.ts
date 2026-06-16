import {
  computeActivityCorrelation,
  selectCorrelationView,
  parseExcludedActivities,
  serializeExcludedActivities,
  DEFAULT_TOP_N,
  MIN_SAMPLES,
  type ActivityCorrelationRow,
  type ActivityCorrelationResult,
} from '@/components/visualisations/transforms/activityCorrelation';

const r = (
  name: string,
  avgWith: number | null,
  avgWithout: number | null,
  countWith: number,
  countWithout: number,
): ActivityCorrelationRow => ({
  activity_name: name,
  avg_with: avgWith,
  avg_without: avgWithout,
  count_with: countWith,
  count_without: countWithout,
});

/** Build a meaningful ActivityCorrelationResult with only name + delta that matter. */
const m = (name: string, delta: number): ActivityCorrelationResult => ({
  activity_name: name,
  avg_with: 5 + delta,
  avg_without: 5,
  delta,
  count_with: MIN_SAMPLES,
  count_without: MIN_SAMPLES,
  isMeaningful: true,
});

describe('computeActivityCorrelation', () => {
  it('returns empty result for empty input', () => {
    const out = computeActivityCorrelation([]);
    expect(out.items).toEqual([]);
    expect(out.meaningful).toEqual([]);
  });

  it('computes delta as avg_with - avg_without', () => {
    const out = computeActivityCorrelation([r('Yoga', 7.5, 6, 6, 6)]);
    expect(out.items[0].delta).toBeCloseTo(1.5);
  });

  it('marks items meaningful only when both sides >= MIN_SAMPLES', () => {
    const out = computeActivityCorrelation([
      r('Enough', 7, 5, MIN_SAMPLES, MIN_SAMPLES),
      r('TooFewWith', 7, 5, MIN_SAMPLES - 1, 20),
      r('TooFewWithout', 7, 5, 20, MIN_SAMPLES - 1),
    ]);
    const byName = Object.fromEntries(out.items.map((i) => [i.activity_name, i]));
    expect(byName['Enough'].isMeaningful).toBe(true);
    expect(byName['TooFewWith'].isMeaningful).toBe(false);
    expect(byName['TooFewWithout'].isMeaningful).toBe(false);
    expect(out.meaningful.map((i) => i.activity_name)).toEqual(['Enough']);
  });

  it('treats an activity logged every day (count_without = 0) as not meaningful', () => {
    const out = computeActivityCorrelation([r('Daily', 7, null, 30, 0)]);
    expect(out.items[0].isMeaningful).toBe(false);
    // null avg_without coerced to 0 — no NaN
    expect(out.items[0].avg_without).toBe(0);
    expect(Number.isFinite(out.items[0].delta)).toBe(true);
  });

  it('coerces null avgs to 0 (NaN guard)', () => {
    const out = computeActivityCorrelation([r('Sparse', null, null, 0, 0)]);
    expect(out.items[0].avg_with).toBe(0);
    expect(out.items[0].avg_without).toBe(0);
    expect(out.items[0].delta).toBe(0);
    expect(out.items[0].isMeaningful).toBe(false);
  });

  it('sorts items by absolute delta descending', () => {
    const out = computeActivityCorrelation([
      r('Small', 6, 5.5, 6, 6), // |delta| 0.5
      r('BigNeg', 4, 8, 6, 6),  // |delta| 4
      r('Mid', 7, 5, 6, 6),     // |delta| 2
    ]);
    expect(out.items.map((i) => i.activity_name)).toEqual(['BigNeg', 'Mid', 'Small']);
  });

  it('preserves the sign of delta for negative correlations', () => {
    const out = computeActivityCorrelation([r('Doomscroll', 4, 7, 6, 6)]);
    expect(out.items[0].delta).toBeCloseTo(-3);
  });
});

describe('selectCorrelationView', () => {
  it('splits into positive / negative buckets with delta===0 going positive', () => {
    const view = selectCorrelationView([m('Up', 1), m('Flat', 0), m('Down', -1)]);
    expect(view.positive.map((i) => i.activity_name)).toEqual(['Up', 'Flat']);
    expect(view.negative.map((i) => i.activity_name)).toEqual(['Down']);
  });

  it('sorts positive by delta DESC and negative by delta ASC (most draining first)', () => {
    const view = selectCorrelationView([
      m('SmallUp', 1),
      m('BigUp', 3),
      m('SmallDown', -1),
      m('BigDown', -3),
    ]);
    expect(view.positive.map((i) => i.activity_name)).toEqual(['BigUp', 'SmallUp']);
    expect(view.negative.map((i) => i.activity_name)).toEqual(['BigDown', 'SmallDown']);
  });

  it('caps each bucket to topN and counts hiddenByCollapse across both sides', () => {
    const items = [
      ...Array.from({ length: 7 }, (_, i) => m(`Pos${i}`, 7 - i)), // 7 positive
      ...Array.from({ length: 6 }, (_, i) => m(`Neg${i}`, -(i + 1))), // 6 negative
    ];
    const view = selectCorrelationView(items); // default topN = DEFAULT_TOP_N (5)
    expect(view.positive).toHaveLength(DEFAULT_TOP_N);
    expect(view.negative).toHaveLength(DEFAULT_TOP_N);
    // dropped: (7-5) positive + (6-5) negative = 3
    expect(view.hiddenByCollapse).toBe(3);
  });

  it('expanded returns all of each bucket with hiddenByCollapse 0', () => {
    const items = [
      ...Array.from({ length: 7 }, (_, i) => m(`Pos${i}`, 7 - i)),
      ...Array.from({ length: 6 }, (_, i) => m(`Neg${i}`, -(i + 1))),
    ];
    const view = selectCorrelationView(items, { expanded: true });
    expect(view.positive).toHaveLength(7);
    expect(view.negative).toHaveLength(6);
    expect(view.hiddenByCollapse).toBe(0);
  });

  it('excludes an item and lets the next-strongest fill the slot', () => {
    // 6 positive, topN 5: by default Pos5 (weakest) is hidden. Exclude the
    // strongest (Pos0) and the previously-hidden Pos5 should appear.
    const items = Array.from({ length: 6 }, (_, i) => m(`Pos${i}`, 6 - i));
    const baseline = selectCorrelationView(items);
    expect(baseline.positive.map((i) => i.activity_name)).toEqual([
      'Pos0', 'Pos1', 'Pos2', 'Pos3', 'Pos4',
    ]);
    expect(baseline.hiddenByCollapse).toBe(1); // Pos5 hidden

    const excluded = selectCorrelationView(items, { excluded: ['Pos0'] });
    expect(excluded.positive.map((i) => i.activity_name)).toEqual([
      'Pos1', 'Pos2', 'Pos3', 'Pos4', 'Pos5',
    ]);
    // After excluding Pos0 only 5 positives remain -> none hidden by slice.
    expect(excluded.hiddenByCollapse).toBe(0);
  });

  it('honours a custom topN', () => {
    const items = [m('A', 4), m('B', 3), m('C', 2), m('D', 1)];
    const view = selectCorrelationView(items, { topN: 2 });
    expect(view.positive.map((i) => i.activity_name)).toEqual(['A', 'B']);
    expect(view.hiddenByCollapse).toBe(2);
  });

  it('returns empty buckets for empty input', () => {
    const view = selectCorrelationView([]);
    expect(view.positive).toEqual([]);
    expect(view.negative).toEqual([]);
    expect(view.hiddenByCollapse).toBe(0);
  });

  it('returns empty buckets when everything is excluded', () => {
    const items = [m('Up', 2), m('Down', -2)];
    const view = selectCorrelationView(items, { excluded: ['Up', 'Down'] });
    expect(view.positive).toEqual([]);
    expect(view.negative).toEqual([]);
    expect(view.hiddenByCollapse).toBe(0);
  });
});

describe('parseExcludedActivities', () => {
  it('parses a valid string array', () => {
    expect(parseExcludedActivities('["Yoga","Run"]')).toEqual(['Yoga', 'Run']);
  });

  it('returns [] for empty, null, and undefined', () => {
    expect(parseExcludedActivities('')).toEqual([]);
    expect(parseExcludedActivities('   ')).toEqual([]);
    expect(parseExcludedActivities(null)).toEqual([]);
    expect(parseExcludedActivities(undefined)).toEqual([]);
  });

  it('returns [] for corrupt JSON', () => {
    expect(parseExcludedActivities('[not json')).toEqual([]);
    expect(parseExcludedActivities('{')).toEqual([]);
  });

  it('returns [] for non-array JSON', () => {
    expect(parseExcludedActivities('"Yoga"')).toEqual([]);
    expect(parseExcludedActivities('42')).toEqual([]);
    expect(parseExcludedActivities('{"a":1}')).toEqual([]);
  });

  it('drops non-string members', () => {
    expect(parseExcludedActivities('["Yoga",1,null,true,"Run"]')).toEqual(['Yoga', 'Run']);
  });

  it('round-trips with serializeExcludedActivities and dedupes', () => {
    const serialized = serializeExcludedActivities(['Yoga', 'Run', 'Yoga']);
    expect(parseExcludedActivities(serialized)).toEqual(['Yoga', 'Run']);
  });
});

describe('serializeExcludedActivities', () => {
  it('dedupes via Set', () => {
    expect(serializeExcludedActivities(['a', 'a', 'b'])).toBe('["a","b"]');
  });

  it('serializes an empty iterable to []', () => {
    expect(serializeExcludedActivities([])).toBe('[]');
  });
});
