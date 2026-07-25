// calendarMarkers.ts
//
// Builds the `markedDates` dict consumed by `react-native-calendars` under
// `markingType="custom"`.
//
// TWO layers compose on a single day (verified against the library source,
// v1.1314 BasicDay -> Marking -> Dot):
//   1. MOOD layer  — `customStyles.container.backgroundColor` paints the cell
//      and `customStyles.text.color` colors the day number.
//   2. ACTIVITY layer — `marked: true` + `dotColor` render the small dot below
//      the number. Both layers can live on the same marking object, so a
//      mood-colored day can ALSO carry an activity dot.
//
// The mood color comes ONLY from the app's canonical scale
// (`components/timeline/moodColor.ts`) — there is NO hardcoded mood palette
// here. The theme colors the builder needs are passed in as a parameter, so the
// same transform themes correctly across all five themes.

import { moodColor } from '@/components/timeline/moodColor';
import { parseHexColor } from '@/components/visualisations/chartUtils';

export type MoodMarkerRow = {
  date: string; // local "YYYY-MM-DD"
  avgMood: number | null;
};

/**
 * One day's marking. All fields optional (mirrors the library's MarkingProps):
 * a mood-only day has `customStyles`; an activity-only day has just
 * `marked`+`dotColor`; a day that is both carries all three.
 */
export type CalendarDayMarking = {
  customStyles?: {
    container?: { backgroundColor: string };
    text?: { color: string };
  };
  marked?: boolean;
  dotColor?: string;
};

export type MarkedDates = { [date: string]: CalendarDayMarking };

/**
 * Theme colors the marker builder needs, passed in so the transform hardcodes
 * NO palette:
 *  - `accent`         drives the canonical `moodColor` scale.
 *  - `cardBackground` is the calendar cell background the marker's semi-
 *                     transparent fill composites over — needed to judge the
 *                     day-number contrast.
 *  - `onDark`/`onLight` are the day-number colors to use when the composited
 *                     marker reads dark vs. light (the caller supplies theme-
 *                     appropriate high-contrast text colors).
 */
export type CalendarMarkerColors = {
  accent: string;
  cardBackground: string;
  onDark: string;
  onLight: string;
};

// Fallbacks if a theme ever ships a non-hex accent/card (e.g. an rgba accent):
// the default green + the dark-theme card. Mirrors moodColor.ts's fallback.
const ACCENT_FALLBACK = { r: 76, g: 175, b: 80 };
const CARD_FALLBACK = { r: 30, g: 31, b: 36 };

// Mirror of moodColor.ts's alpha ramp so we can composite the marker over the
// card for the contrast decision WITHOUT re-parsing the rgba string it returns.
const MIN_ALPHA = 0.2;
const MAX_ALPHA = 1.0;

/** sRGB channel (0..255) -> linear light (WCAG relative-luminance step). */
const srgbToLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/** WCAG relative luminance (0..1) of an {r,g,b}. */
const relLuminance = (r: number, g: number, b: number): number =>
  0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);

/** WCAG contrast ratio (>= 1) between two relative luminances. */
const contrastRatio = (l1: number, l2: number): number =>
  (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

const lumOf = (hex: string, fallback: { r: number; g: number; b: number }): number => {
  const rgb = parseHexColor(hex) ?? fallback;
  return relLuminance(rgb.r, rgb.g, rgb.b);
};

/**
 * The canonical mood marker for one day: `backgroundColor` from the shared
 * `moodColor` scale, and the day-number `textColor` chosen — per theme — as
 * whichever of `onDark`/`onLight` yields the HIGHER WCAG contrast against the
 * composited marker background. Because one candidate is light and one dark, the
 * winner is always >= ~4.1:1, so the number stays readable across the whole mood
 * ramp in both dark and light themes. Exported for unit testing.
 */
export const moodMarkerStyle = (
  avgMood: number,
  colors: CalendarMarkerColors,
): { backgroundColor: string; textColor: string } => {
  const backgroundColor = moodColor(avgMood, colors.accent);

  // Composite the marker's rgba(accent, alpha) over the card to its effective
  // opaque color: a low-mood marker is nearly the card, a high-mood marker is
  // near-solid accent.
  const accent = parseHexColor(colors.accent) ?? ACCENT_FALLBACK;
  const card = parseHexColor(colors.cardBackground) ?? CARD_FALLBACK;
  const clamped = Math.min(10, Math.max(0, avgMood));
  const alpha = MIN_ALPHA + (clamped / 10) * (MAX_ALPHA - MIN_ALPHA);
  const over = (c: number, base: number) => c * alpha + base * (1 - alpha);
  const bgLum = relLuminance(
    over(accent.r, card.r),
    over(accent.g, card.g),
    over(accent.b, card.b),
  );

  const darkContrast = contrastRatio(bgLum, lumOf(colors.onLight, { r: 26, g: 26, b: 26 }));
  const lightContrast = contrastRatio(bgLum, lumOf(colors.onDark, { r: 255, g: 255, b: 255 }));
  const textColor = darkContrast >= lightContrast ? colors.onLight : colors.onDark;
  return { backgroundColor, textColor };
};

/**
 * Build the MOOD marker layer. Skips rows with null/undefined/non-finite
 * avgMood (a "no marker" day). An empty input yields `{}` — an unmarked
 * calendar, never a throw.
 */
export const buildCalendarMarkers = (
  rows: MoodMarkerRow[],
  colors: CalendarMarkerColors,
): MarkedDates => {
  const markers: MarkedDates = {};
  for (const row of rows ?? []) {
    if (row?.avgMood === null || row?.avgMood === undefined) continue;
    if (!Number.isFinite(row.avgMood)) continue;
    const { backgroundColor, textColor } = moodMarkerStyle(
      row.avgMood as number,
      colors,
    );
    markers[row.date] = {
      customStyles: {
        container: { backgroundColor },
        text: { color: textColor },
      },
    };
  }
  return markers;
};

/**
 * Merge an ACTIVITY-dot layer onto existing mood markers: every day in
 * `activityDays` gets `marked:true`+`dotColor` on top of any mood coloring.
 * Returns a NEW dict (pure — never mutates the input).
 *
 * The dot color is derived PER DAY so it always contrasts: it reuses that day's
 * mood-marker number color (which `buildCalendarMarkers` already contrast-picked
 * for the marker background). A day with a dot but no mood marker (defensive; a
 * logged activity always implies an entry) gets a bare dot in `fallbackDotColor`
 * (the plain-card text color) so it can never silently drop.
 */
export const mergeActivityDots = (
  moodMarkers: MarkedDates,
  activityDays: Iterable<string>,
  fallbackDotColor: string,
): MarkedDates => {
  const out: MarkedDates = {};
  for (const [date, marking] of Object.entries(moodMarkers)) out[date] = marking;
  for (const day of activityDays) {
    const existing = out[day];
    const dotColor = existing?.customStyles?.text?.color ?? fallbackDotColor;
    out[day] = existing
      ? { ...existing, marked: true, dotColor }
      : { marked: true, dotColor };
  }
  return out;
};

/** The theme tokens the calendar's grid/header/day styles are built from. */
export type CalendarThemeTokens = {
  cardBackground: string;
  text: string;
  textSecondary: string;
  accent: string;
};

/**
 * Remount identity for the `<Calendar>` across a theme switch.
 *
 * react-native-calendars builds its grid stylesheet ONCE at mount
 * (`const style = useRef(styleConstructor(theme))` in calendar/index.js) and
 * never re-runs it when the `theme` prop later changes — so on a theme switch
 * the day-GRID background/dividers keep the OLD theme's colors (from
 * calendar/style.js's `calendarBackground`) until the component remounts. The
 * markers themselves DO restyle (they flow through `markedDates`, rebuilt on
 * every theme change), which is why ONLY the grid area lags. MoodCalendar keys
 * the `<Calendar>` on this string; it changes iff any theme token the grid is
 * built from changes, forcing React to remount and re-bake the stylesheet.
 * Verified against the installed v1.1314 source.
 *
 * Structural param (not the app's full ThemeColors) so this stays a pure,
 * RN-free unit.
 */
export const calendarThemeKey = (colors: CalendarThemeTokens): string =>
  `${colors.cardBackground}|${colors.text}|${colors.textSecondary}|${colors.accent}`;
