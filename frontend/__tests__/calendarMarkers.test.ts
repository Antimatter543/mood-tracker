import {
  buildCalendarMarkers,
  moodMarkerStyle,
  mergeActivityDots,
  type MoodMarkerRow,
  type CalendarMarkerColors,
} from '@/components/visualisations/transforms/calendarMarkers';
import { moodColor } from '@/components/timeline/moodColor';

// Representative palettes from styles/global.ts — a dark theme and a light theme
// (the spec requires day-number readability in BOTH).
const DARK: CalendarMarkerColors = {
  accent: '#4CAF50',
  cardBackground: '#1E1F24',
  onDark: '#FFFFFF',
  onLight: '#1A1A1A',
};
const LIGHT: CalendarMarkerColors = {
  accent: '#4CAF50',
  cardBackground: '#FFFFFF',
  onDark: '#FFFFFF',
  onLight: '#1A1A1A',
};
const CHERRY: CalendarMarkerColors = {
  accent: '#C7527C',
  cardBackground: '#FFF5F8',
  onDark: '#FFFFFF',
  onLight: '#1A1A1A',
};

// ── Standalone WCAG helpers, so the readability assertion is INDEPENDENT of the
// transform's own contrast math (a real second opinion, not a tautology). ──────
const hexRgb = (hex: string) => {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
};
const parseRgba = (s: string) => {
  const m = s.match(/rgba?\(([^)]+)\)/);
  const [r, g, b, a = '1'] = m![1].split(',').map((x) => x.trim());
  return { r: +r, g: +g, b: +b, a: +a };
};
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const lum = (r: number, g: number, b: number) =>
  0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (l1: number, l2: number) =>
  (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

/** Contrast of a chosen hex text color over a marker rgba composited on `card`. */
const textOnMarkerContrast = (
  textHex: string,
  markerRgba: string,
  cardHex: string,
): number => {
  const m = parseRgba(markerRgba);
  const c = hexRgb(cardHex);
  const eff = (mc: number, cc: number) => mc * m.a + cc * (1 - m.a);
  const bg = lum(eff(m.r, c.r), eff(m.g, c.g), eff(m.b, c.b));
  const t = hexRgb(textHex);
  return contrast(bg, lum(t.r, t.g, t.b));
};

const MOODS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('moodMarkerStyle — canonical scale', () => {
  it('takes the background straight from the shared moodColor scale (no local palette)', () => {
    for (const m of MOODS) {
      expect(moodMarkerStyle(m, DARK).backgroundColor).toBe(moodColor(m, DARK.accent));
      expect(moodMarkerStyle(m, CHERRY).backgroundColor).toBe(moodColor(m, CHERRY.accent));
    }
  });

  it('themes the background off the passed accent (different theme -> different color)', () => {
    expect(moodMarkerStyle(8, DARK).backgroundColor).not.toBe(
      moodMarkerStyle(8, CHERRY).backgroundColor,
    );
  });
});

describe('moodMarkerStyle — day-number readability (dark AND light themes)', () => {
  it.each(MOODS)('dark theme: mood %s number stays readable (>= 4:1)', (mood) => {
    const { backgroundColor, textColor } = moodMarkerStyle(mood, DARK);
    expect(textColor === DARK.onDark || textColor === DARK.onLight).toBe(true);
    expect(textOnMarkerContrast(textColor, backgroundColor, DARK.cardBackground)).toBeGreaterThanOrEqual(4);
  });

  it.each(MOODS)('light theme: mood %s number stays readable (>= 4:1)', (mood) => {
    const { backgroundColor, textColor } = moodMarkerStyle(mood, LIGHT);
    expect(textOnMarkerContrast(textColor, backgroundColor, LIGHT.cardBackground)).toBeGreaterThanOrEqual(4);
  });

  it('picks the HIGHER-contrast of the two candidate text colors', () => {
    for (const theme of [DARK, LIGHT, CHERRY]) {
      for (const mood of MOODS) {
        const { backgroundColor, textColor } = moodMarkerStyle(mood, theme);
        const chosen = textOnMarkerContrast(textColor, backgroundColor, theme.cardBackground);
        const other = textOnMarkerContrast(
          textColor === theme.onDark ? theme.onLight : theme.onDark,
          backgroundColor,
          theme.cardBackground,
        );
        expect(chosen).toBeGreaterThanOrEqual(other);
      }
    }
  });
});

describe('buildCalendarMarkers', () => {
  it('returns an empty dict on empty input (unmarked calendar, never throws)', () => {
    expect(buildCalendarMarkers([], DARK)).toEqual({});
  });

  it('produces one custom marker per dated row, keyed by YYYY-MM-DD', () => {
    const rows: MoodMarkerRow[] = [
      { date: '2025-06-13', avgMood: 7 },
      { date: '2025-06-14', avgMood: 3 },
    ];
    expect(Object.keys(buildCalendarMarkers(rows, DARK)).sort()).toEqual([
      '2025-06-13',
      '2025-06-14',
    ]);
  });

  it('emits the react-native-calendars custom shape from the canonical scale', () => {
    const out = buildCalendarMarkers([{ date: '2025-06-15', avgMood: 8 }], DARK);
    const m = out['2025-06-15'];
    expect(m.customStyles!.container!.backgroundColor).toBe(moodColor(8, DARK.accent));
    expect(m.customStyles!.text!.color).toBe(moodMarkerStyle(8, DARK).textColor);
    // A mood-only day has no activity dot layer.
    expect(m.marked).toBeUndefined();
    expect(m.dotColor).toBeUndefined();
  });

  it('skips rows with null/undefined/NaN avgMood', () => {
    const rows: MoodMarkerRow[] = [
      { date: '2025-06-13', avgMood: null },
      { date: '2025-06-14', avgMood: NaN },
      { date: '2025-06-15', avgMood: 5 },
    ];
    expect(Object.keys(buildCalendarMarkers(rows, DARK))).toEqual(['2025-06-15']);
  });
});

describe('mergeActivityDots — mood marking + activity dot compose on one day', () => {
  const FALLBACK = '#FFFFFF'; // stands in for colors.text (bare-dot days)

  it('adds a dot ON TOP of a mood marker without disturbing the mood layer', () => {
    const mood = buildCalendarMarkers([{ date: '2026-07-01', avgMood: 8 }], DARK);
    const merged = mergeActivityDots(mood, ['2026-07-01'], FALLBACK);
    const day = merged['2026-07-01'];
    // Mood layer preserved…
    expect(day.customStyles).toEqual(mood['2026-07-01'].customStyles);
    // …plus the dot layer, colored to contrast (reuses the marker's number color).
    expect(day.marked).toBe(true);
    expect(day.dotColor).toBe(mood['2026-07-01'].customStyles!.text!.color);
  });

  it('creates a bare dot (fallback color) on a day with no mood marker', () => {
    const merged = mergeActivityDots({}, ['2026-07-05'], FALLBACK);
    expect(merged['2026-07-05']).toEqual({ marked: true, dotColor: FALLBACK });
  });

  it('is pure — never mutates the input mood markers', () => {
    const mood = buildCalendarMarkers([{ date: '2026-07-01', avgMood: 8 }], DARK);
    const snapshot = JSON.parse(JSON.stringify(mood));
    mergeActivityDots(mood, ['2026-07-01'], FALLBACK);
    expect(mood).toEqual(snapshot); // unchanged
  });

  it('leaves un-dotted days as mood-only markers', () => {
    const mood = buildCalendarMarkers(
      [
        { date: '2026-07-01', avgMood: 8 },
        { date: '2026-07-02', avgMood: 4 },
      ],
      DARK,
    );
    const merged = mergeActivityDots(mood, ['2026-07-01'], FALLBACK);
    expect(merged['2026-07-02'].marked).toBeUndefined();
    expect(merged['2026-07-02'].dotColor).toBeUndefined();
  });
});
