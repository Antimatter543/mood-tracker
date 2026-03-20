import { interpolateData, getLast7Days, formatDayLabel } from '@/components/visualisations/chartUtils';

describe('interpolateData', () => {
  it('interpolates the docstring example: [1,null,3,null,5] -> [1,2,3,4,5]', () => {
    const { data, nullIndices } = interpolateData([1, null, 3, null, 5]);
    expect(data).toEqual([1, 2, 3, 4, 5]);
    expect(nullIndices).toEqual([1, 3]);
  });

  it('interpolates a single null between values: [1,null,3] -> [1,2,3]', () => {
    const { data, nullIndices } = interpolateData([1, null, 3]);
    expect(data).toEqual([1, 2, 3]);
    expect(nullIndices).toEqual([1]);
  });

  it('interpolates multiple consecutive nulls: [0,null,null,3] -> [0,1,2,3]', () => {
    const { data, nullIndices } = interpolateData([0, null, null, 3]);
    expect(data).toEqual([0, 1, 2, 3]);
    expect(nullIndices).toEqual([1, 2]);
  });

  it('handles leading null (no prev to interpolate from): data[0] should be 0', () => {
    const { data, nullIndices } = interpolateData([null, 2, 3]);
    expect(data[0]).toBe(0);
    expect(nullIndices).toEqual([0]);
  });

  it('handles trailing null (no next to interpolate from): data[2] should be 0', () => {
    const { data, nullIndices } = interpolateData([1, 2, null]);
    expect(data[2]).toBe(0);
    expect(nullIndices).toEqual([2]);
  });

  it('handles all nulls: [null,null,null] -> [0,0,0]', () => {
    const { data, nullIndices } = interpolateData([null, null, null]);
    expect(data).toEqual([0, 0, 0]);
    expect(nullIndices).toEqual([0, 1, 2]);
  });

  it('handles no nulls: [1,2,3] -> [1,2,3]', () => {
    const { data, nullIndices } = interpolateData([1, 2, 3]);
    expect(data).toEqual([1, 2, 3]);
    expect(nullIndices).toEqual([]);
  });

  it('handles empty array: [] -> []', () => {
    const { data, nullIndices } = interpolateData([]);
    expect(data).toEqual([]);
    expect(nullIndices).toEqual([]);
  });
});

describe('getLast7Days', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns 7 dates', () => {
    const days = getLast7Days();
    expect(days).toHaveLength(7);
  });

  it('returns dates in ascending order', () => {
    const days = getLast7Days();
    for (let i = 1; i < days.length; i++) {
      expect(days[i] > days[i - 1]).toBe(true);
    }
  });

  it('returns dates in ISO format (YYYY-MM-DD)', () => {
    const days = getLast7Days();
    const isoRegex = /^\d{4}-\d{2}-\d{2}$/;
    for (const day of days) {
      expect(day).toMatch(isoRegex);
    }
  });

  it('has the last date as today', () => {
    const days = getLast7Days();
    expect(days[days.length - 1]).toBe('2025-06-15');
  });
});

describe('formatDayLabel', () => {
  it('returns a short weekday string for a known date', () => {
    // 2025-06-15 is a Sunday
    const label = formatDayLabel('2025-06-15');
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
    expect(label.length).toBeLessThanOrEqual(4); // short weekday names are 2-4 chars
  });
});
