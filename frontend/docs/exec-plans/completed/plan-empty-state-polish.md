# Plan: Empty-state polish (fresh-install experience)

## Goal
Make a brand-new user (empty DB) see a calm, on-brand app, not broken red-dotted
charts and `--`/`0` tiles, without building a full onboarding flow.

## Findings (current state)
- Home (`app/(tabs)/index.tsx`): weekly LineChart calls `interpolateData([0,0,...])`
  on empty data, then `getDotColor` paints every (interpolated) dot RED -> looks
  like an error. Monthly tiles show `--`/`0`. No first-entry nudge.
- Insights (`insights.tsx`): ALREADY clean — `totalEntries === 0` -> `<EmptyState/>`.
- Timeline (`DBViewer.tsx`): ALREADY clean — `sections.length === 0` -> `<EmptyState/>`.
- Stats (`stats.tsx`): renders ~8 viz cards directly, no top-level empty guard ->
  wall of empty charts on a fresh DB. Empty-SAFE (no crash, post heatmap fix) but
  barren.
- `EmptyState.tsx`: already warm (Feather icon + halo + themed). Copy is fine;
  refine slightly + accept an `accessibilityLabel`-friendly tweak only if needed.
- Cleanups: `colors` unused in `RootLayout` (`_layout.tsx`), `chartWidth` unused
  (module-level in `CustomHeatMap.tsx`).

## Design decisions
- Detect "whole DB empty" via a tiny all-time `TOTAL_ENTRIES` count query (one
  source of truth) on Home + Stats.
- Home: when the week has no data -> replace the chart with a calm placeholder
  inside the SAME card (soft line-chart Ionicon + "Log your mood to start seeing
  your week"). Condition = `weeklyData` all null (pure helper `isWeekEmpty`,
  unit-tested). When DB totally empty -> also show ONE gentle nudge under the
  hero: "Tap + to log your first mood" with a small arrow-down/add Ionicon.
- Stats: when DB empty -> render ONE `<EmptyState>` ("No data yet" + calm copy)
  instead of the wall of empty charts. Keep timeframe selector hidden in that
  case (nothing to filter).
- All themed via `useThemeColors()`. Ionicons, no emoji. Semantic warn/error kept.

## Steps
- [ ] Add `TOTAL_ENTRIES` query + `isWeekEmpty` pure helper (+ test).
- [ ] Home: chart placeholder + first-entry nudge.
- [ ] Stats: top-level empty guard using total count.
- [ ] EmptyState: minor copy polish if warranted.
- [ ] Cleanups: remove unused `colors` / `chartWidth`.
- [ ] tsc + jest green. Build dev, reproduce empty, screenshot all tabs (dark+light).
- [ ] EAS preview build, install release, verify standalone, gh release upload.
</content>
</invoke>
