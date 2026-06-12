# Changelog

All notable changes to SoulSync are documented here. Versions follow
[semver](https://semver.org/); each release ships an APK on GitHub Releases.

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
