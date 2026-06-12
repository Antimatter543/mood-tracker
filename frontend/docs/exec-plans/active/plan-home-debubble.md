# Plan: De-bubble + polish the Home screen (qol/v2.3.0)

## Goal
Redesign Home's cards to the StatSummaryCard "Overview" idiom (open tiles, no
bubble-soup), replace chart-kit's Home LineChart with our own systematic SVG
chart, give activities real icons, de-bubble the streak pill — preserving the
just-rewritten fetchData data layer exactly.

## Design reference
- `StatSummaryCard.tsx` "Overview" card: one flat Card, 2x2 grid of OPEN tiles,
  each = 36px round accentLight chip (Feather) + 18/700 value over 12 muted label.
- `EntryCard.tsx` / `moodColor.ts`: v2.2.0 timeline language, mood->color ramp.
- `ActivityRow.tsx`: icon+name glyph render via ICON_FAMILIES (extract mapping).

## Steps
- [ ] Step 1: Extract `components/StatTile.tsx` (icon/value/label/color/iconBg) —
      refactor StatSummaryCard to use it (preserve exact visual output). Render test.
- [ ] Step 2: Extract activity-icon glyph mapping -> `components/activityIcon.tsx`
      (shared by ActivityRow + Home). Keep ActivityRow behavior; test mapping.
- [ ] Step 3: Pure chart geometry module `transforms/chartGeometry.ts` (point
      positioning, monotone/segment path, gap segmentation, area path). Unit-test.
- [ ] Step 4: `components/visualisations/MoodWeekChart.tsx` (SVG, measured width,
      moodColor dots, hollow/missing dots, dashed gaps, area fill, day labels,
      empty/single/all-same handling). Replace WeeklyChartCard's chart-kit usage.
- [ ] Step 5: MonthlyOverviewCard -> 3 StatTiles (Avg/Total/Best Day). Extend the
      activities query to select a.icon + a.icon_family; RecentActivitiesCard ->
      icon+name rows. Streak pill -> inline zap icon + text (no box).
- [ ] Step 6: Hierarchy pass (paddings, greeting, one subtitle convention).
- [ ] Step 7: Hygiene — remove unused imports/params (per task F).
- [ ] Step 8: GATE `tsc --noEmit && jest`. Commit per step.

## Decisions made
- SVG width via `onLayout` measurement (like ActivityCorrelationChart), NOT
  SCREEN_WIDTH-padding guessing — theme/orientation robust, avoids clipped dots.
- Missing/interpolated points: solid moodColor dot for real data; small hollow
  muted dot at gap endpoints; DASHED line across gaps. No red (red = error).
- Straight monotone-smoothed segments, no bezier overshoot. Area fill = accent
  low-opacity gradient under the line.
- Keep `interpolateData`/`isWeekEmpty` from chartUtils for the empty check, but
  the chart consumes the raw `(number|null)[]` + computes geometry from REAL
  points only (gaps are visual, not fabricated data).
- StatTile lives in `components/` (cross-feature: stats + home). Hooks order:
  all hooks before any early return (lesson 2026-06-08).
- Chart math is a PURE module (chartGeometry.ts) so it's fully jest-tested; the
  SVG component is thin. jest-expo already mocks react-native-svg.
