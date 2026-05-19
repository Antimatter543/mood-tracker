import {
  bucketMoodHistogram,
  dedupePoints,
  NUM_BUCKETS,
} from '@/components/visualisations/transforms/scatter';

describe('bucketMoodHistogram', () => {
  it('returns an array of NUM_BUCKETS zeros on empty input', () => {
    const out = bucketMoodHistogram([]);
    expect(out).toHaveLength(NUM_BUCKETS);
    expect(out.every((c) => c === 0)).toBe(true);
  });

  it('floors fractional moods into the correct bucket (7.5 -> 7)', () => {
    const out = bucketMoodHistogram([{ mood: 7.5 }]);
    expect(out[7]).toBe(1);
    expect(out[8]).toBe(0);
  });

  it('clamps mood >= 10 into the last bucket', () => {
    const out = bucketMoodHistogram([{ mood: 10 }, { mood: 12 }]);
    expect(out[NUM_BUCKETS - 1]).toBe(2);
  });

  it('clamps negative moods into bucket 0', () => {
    const out = bucketMoodHistogram([{ mood: -1 }, { mood: -100 }]);
    expect(out[0]).toBe(2);
  });

  it('counts identical moods together (a histogram is a frequency table)', () => {
    const entries = Array.from({ length: 5 }, () => ({ mood: 4 }));
    const out = bucketMoodHistogram(entries);
    expect(out[4]).toBe(5);
  });

  it('ignores NaN moods', () => {
    const out = bucketMoodHistogram([{ mood: NaN }, { mood: 3 }]);
    expect(out.reduce((s, n) => s + n, 0)).toBe(1);
  });
});

describe('dedupePoints', () => {
  it('returns empty for empty', () => {
    expect(dedupePoints([])).toEqual([]);
  });

  it('keeps unique points untouched (count=1)', () => {
    const out = dedupePoints([
      { x: 1, y: 2 },
      { x: 1, y: 3 },
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((p) => p.count === 1)).toBe(true);
  });

  it('collapses identical (x,y) into one entry with a count', () => {
    const out = dedupePoints([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 6 },
    ]);
    expect(out).toHaveLength(2);
    const dup = out.find((p) => p.x === 5 && p.y === 5);
    expect(dup?.count).toBe(3);
  });
});
