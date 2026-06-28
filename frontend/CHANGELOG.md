# Changelog

All notable changes to SoulSync are documented here. Versions follow
[semver](https://semver.org/); each release ships an APK on GitHub Releases.

## [2.3.5] - Unreleased

### Changed
- **The Mood Heatmap now shows your most recent days on the left.** Week columns are reversed so
  the latest week sits on the left edge and older weeks extend to the right — your recent moods are
  visible the moment the heatmap opens, with no scrolling. The day-of-week rows (Mon at the top,
  Sun at the bottom) are unchanged, and the month labels move with their columns.

### Fixed
- **Timeline no longer goes blank after rapid tab-switching.** When you moved quickly between
  tabs (or added an entry and jumped straight to Timeline), the Timeline list could occasionally
  render empty until you reopened the app. An overlapping data-load could finish out of order and
  wipe the freshly-loaded list; Timeline now ignores any stale load that finishes late, so the
  list stays put. (Same class of fix as the earlier Home-screen blank fix.)

## [2.0.0] - 2026-06-12

### Changed
- **Upgraded the app's foundation (Expo SDK 52 → 56, React Native 0.76 → 0.85).** This is an
  internal platform/tooling upgrade that keeps SoulSync current with security patches, the Android
  toolchain, and the libraries it's built on. The supported Android version range is unchanged for
  the devices SoulSync targets.
- **No feature changes and no data changes.** Your entries, photos, and settings are untouched —
  the on-device database and its migrations carry over exactly as before (verified via an
  install-over-the-old-version data-survival test before release). Everything you could do in 1.2.x
  you can still do; nothing was removed.

### Internal (no user impact)
- Dropped the bundled navigation library in favour of the router's built-in navigation (SDK 56).
- Migrated the test suite off the deprecated React test renderer; all 348 tests pass on the new
  stack. Animations, charts, notifications, and the in-app overlay dialogs were re-verified on the
  new architecture.

## [1.2.3] - 2026-06-12

### Fixed
- **Mood entry form is now fully interactive.** The "add mood" picker (and every
  control in the entry form) did not respond to touch on some devices. Root cause:
  the form used a native modal, which on this app's rendering engine routed touches
  into a separate window where they were silently dropped. The entry form — and all
  other dialogs (settings theme picker, activity editor, icon picker, photo viewer) —
  now render as in-app overlays, so taps, swipes, and scrolling all work reliably.
- The mood number picker scrolls smoothly again, the Continue/Submit buttons respond,
  and Android's back button closes an open form/dialog without leaving the app.

## [1.2.2] - 2026-06-08

### Fixed
- Attempted fix for unresponsive controls inside the mood entry modal (added gesture
  handling at the app root and per modal). Superseded by 1.2.3, which addresses the
  underlying cause.

## [1.2.1] - 2026-06

### Changed
- Deterministic versioning + one-command release pipeline (`scripts/release.sh`).

## [1.2.0] - 2026-06

### Fixed
- Statistics no longer white-screens on a fresh/empty database.
- Entry forms scroll so the Continue button is reachable on short screens.
- Chart x-axis labels no longer overlap on year / all-time ranges; heatmap and trend
  axes show the year at boundaries.
- White framing around the floating tab bar removed (window background follows theme).
