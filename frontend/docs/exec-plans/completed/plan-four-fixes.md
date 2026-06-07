# Plan: SoulSync four user-reported fixes (v1.2.0)

## Goal
Fix four user-reported issues, verify each on-device (Pixel 3), re-ship optimized APK.

## Issues + approach

### 1. White framing around floating tab bar
- Root: floating rounded tab bar leaves window/root background white around/under it.
- Fix: set the Android root/window background to theme `background` via
  `expo-system-ui` `SystemUI.setBackgroundColorAsync(colors.background)` in the
  tabs layout, reactive to theme changes. Pure-style; expo-navigation-bar not installed.

### 2. "How were you?" step not scrollable
- Root: `contentContainer` is `flex:1, center` inside fixed-height modal; overflow unreachable.
- Fix: wrap each step's content in a `ScrollView` with `keyboardShouldPersistTaps="handled"`,
  `showsVerticalScrollIndicator`, `contentContainerStyle` `flexGrow:1` + vertical padding +
  centered justify so it stays centered when it fits, scrolls when it doesn't.

### 3. Year/all-time trend x-axis overlapping month labels
- Root: `formatLabel` returns `month:'short'` for EVERY point on year/alltime (300+ points).
- Fix: sparse strategy. Label only at the first point of each new month, AND thin to
  ~4-6 total labels evenly. Include year when it changes ("Jan '25" / "Jan '26").
  Sanity-check 3months too. Update tests.

### 4a. Year labels on heatmap + trend
- Heatmap month labels never show year. Fix: in `heatmap.ts` `monthLabels`, append year
  at January (or first month of each year): "Jan 26". Trend handled in 3.
### 4b. Most-recent nearest / reliable scrollToEnd
- Heatmap timeout scrollToEnd unreliable. Fix: scrollToEnd in `onContentSizeChange`.
- Line charts already chronological (ORDER BY date asc, newest right). Confirm.

## Verify
- Seeder already spans 2025-01-01..now -> crosses year boundary. No hack needed.
- tsc clean, jest green (>=336 adjusted), Maestro screenshots of: tab bar (no white),
  All-Time trend (legible axis + years), heatmap (year labels + recent visible),
  entry form scrolling.

## Ship
- EAS preview build, verify ~40-50MB arm-only, install release on-device, smoke test,
  gh release upload v1.2.0 --clobber.
