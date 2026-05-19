import {
  buildCalendarMarkers,
  moodToColor,
  type MoodMarkerRow,
} from '@/components/visualisations/transforms/calendarMarkers';

describe('moodToColor', () => {
  it('maps the mood ranges to discrete colours', () => {
    expect(moodToColor(10)).toBe('#4CAF50');
    expect(moodToColor(8)).toBe('#4CAF50');
    expect(moodToColor(7.9)).toBe('#8BC34A');
    expect(moodToColor(6)).toBe('#8BC34A');
    expect(moodToColor(5.9)).toBe('#FFC107');
    expect(moodToColor(4)).toBe('#FFC107');
    expect(moodToColor(3.9)).toBe('#FF9800');
    expect(moodToColor(2)).toBe('#FF9800');
    expect(moodToColor(1.9)).toBe('#F44336');
    expect(moodToColor(0)).toBe('#F44336');
  });
});

describe('buildCalendarMarkers', () => {
  it('returns an empty dict on empty input', () => {
    expect(buildCalendarMarkers([])).toEqual({});
  });

  it('produces one marker per dated row, keyed by YYYY-MM-DD', () => {
    const rows: MoodMarkerRow[] = [
      { date: '2025-06-13', avgMood: 7 },
      { date: '2025-06-14', avgMood: 3 },
    ];
    const out = buildCalendarMarkers(rows);
    expect(Object.keys(out).sort()).toEqual(['2025-06-13', '2025-06-14']);
  });

  it('produces the shape react-native-calendars expects (customStyles)', () => {
    const rows: MoodMarkerRow[] = [{ date: '2025-06-15', avgMood: 8 }];
    const out = buildCalendarMarkers(rows);
    const m = out['2025-06-15'];
    expect(m.customStyles.container.backgroundColor).toBe('#4CAF50');
    expect(m.customStyles.text.color).toBe('#FFFFFF');
  });

  it('skips rows with null/undefined/NaN avgMood', () => {
    const rows: MoodMarkerRow[] = [
      { date: '2025-06-13', avgMood: null },
      { date: '2025-06-14', avgMood: NaN },
      { date: '2025-06-15', avgMood: 5 },
    ];
    const out = buildCalendarMarkers(rows);
    expect(Object.keys(out)).toEqual(['2025-06-15']);
  });
});
