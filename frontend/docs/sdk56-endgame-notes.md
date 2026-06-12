# SDK 52→56 Upgrade — ENDGAME notes (QA → merge → v2.0.0 ship)

**Date**: 2026-06-12 | **Branch merged**: `upgrade/sdk-56` → `main` | **Released**: v2.0.0
**Agent**: senior-developer-agent (Opus), endgame orchestration in 4 bursts
**Status**: ✅ **COMPLETE — v2.0.0 LIVE.** Release:
https://github.com/Antimatter543/mood-tracker/releases/tag/v2.0.0 (asset `SoulSync-2.0.0.apk`).

> This is the in-repo companion to `frontend/docs/sdk56-hop4-notes.md` (the code-migration notes).
> This file records the endgame: the reconcile-merge, the full on-device QA, the v2.0.0 release, and
> the release-binary verification. After this, fold the outcome into the exec plan and move it to
> `~/ops/exec-plans/completed/`.

## SHAs / build identity

| Item | Value |
|---|---|
| Merge: main → branch (BURST 1, reconcile) | `4e27b57` |
| Merge: branch → main (`--no-ff`, BURST 3) | `c55cb5f` |
| Release commit `release: v2.0.0` | `b327fbd` |
| Tag `v2.0.0` | → `b327fbd` |
| QA build CI run (workflow_dispatch on branch) | `27395665250` → `SoulSync-1.2.3.apk` artifact |
| Release CI run (tag push) | `27397868475` → GitHub Release `SoulSync-2.0.0.apk` |
| Cert SHA-256 (every build) | `db328ae9f4881644be0d4030212e2e65093878f35e719d9d62e29b063c4e02ab` |
| Invariant | tag `v2.0.0` == app.json `2.0.0` == versionCode `20000` == APK versionName `2.0.0` == asset `SoulSync-2.0.0.apk` ✓ |

## Code gates (re-run on the merged branch AND on main post-merge)

| Gate | Merged branch (`4e27b57`) | main post-merge | Notes |
|---|---|---|---|
| `npx tsc --noEmit` | 0 errors | 0 errors | TS 6.0.3; `types: ["jest","node","react"]` load-bearing |
| `npx jest` | 348/348 (32 suites) | 348/348 (32 suites) | RNTL migration, no count delta |
| `npx expo-doctor` | 21/21 | — | doctor grew 19→21 at SDK 56 |
| `npm run lint` | 0 errors | — | 13 warnings (pre-existing + React-Compiler-rule warns) |

## The merge (BURST 1 reconcile)

main had moved 3 commits past the branch's fork point (`49aab20`): CI lane `cb66b9e` + v1.2.3 release
`c3e4570` + release docs `ad5fe47`. Merged main INTO the branch first to reconcile.
- **Only `frontend/app.json` conflicted.** Resolution: main's version fields (version **1.2.3**,
  buildNumber/versionCode **10203**) + the branch's SDK-56 android schema (NO `newArchEnabled`, NO
  `edgeToEdgeEnabled`, KEEP `softwareKeyboardLayoutMode: "resize"`). git auto-merged the top-level
  version/buildNumber fields; only the android `versionCode` + `softwareKeyboardLayoutMode` region
  needed hand-resolution.
- **CLAUDE.md / CHANGELOG.md / RELEASING.md / lessons.md auto-merged cleanly** — the two sides touched
  different regions (branch: SDK header + On-device QA notes; main: two-lane Releasing section). Both
  histories preserved, no duplication.
- A `pre-commit-guard.sh` false-positive (it flags `CLAUDE.md` as "internal", but mood-tracker tracks
  it as a deliberately-public project guide) was fixed system-side with a narrowly-scoped
  `CLAUDE_MD_PUBLIC_REPOS = {'mood-tracker'}` allowlist.

## DEVICE QA — full gauntlet (BURST 2, Pixel 3 @ 192.168.1.68:5555)

APK under test = the QA build (`SoulSync-1.2.3.apk` from run 27395665250: 1.2.3 versionName +
**SDK-56 guts**, targetSdk 36). **Zero app crashes across the entire session** (full logcat sweep).

| # | Check | Result | Evidence (`~/Pictures/screenshots/`) |
|---|---|---|---|
| Pre | apksigner cert SHA-256 == `db328ae9…c4e02ab` | ✅ exact match | — |
| Pre | versionName 1.2.3 / versionCode 10203 / pkg | ✅ | — |
| Pre | ABIs arm-only (`arm64-v8a`+`armeabi-v7a`, no x86) | ✅ | — |
| a | v1.2.3 baseline + add 1 entry (overlay flow) | ✅ TOTAL ENTRIES 1→2 | sdk56-qa-00..03 |
| b | **`adb install -r` SDK-56 OVER v1.2.3 (no uninstall)** | ✅ `Success`, no INSTALL_FAILED_UPDATE_INCOMPATIBLE; targetSdk 34→36 | — |
| c | **Data survived migration chain** | ✅ Home 5.0/2 entries/streak; Timeline both entries w/ Mood+activities+timestamps; Stats + Insights show 2 | sdk56-qa-04,05,06,07 |
| d | Full synthetic add-entry **on SDK-56** | ✅ FAB→swipe (Selected 5→8)→Continue→activity→Submit→Home | sdk56-qa-08,09 |
| e | **CHARTS — the one open risk (chart-kit on RN 0.85/new-arch)** | ✅ **ALL render**: Monthly Mood Trend (line), Average Mood by Day (bar), Mood Distribution (bar, freq=2@mood5), heatmap. Insights cards render. **gifted-charts swap NOT needed.** | sdk56-qa-06,06b,06c,07 |
| f | 5 themes + edge-to-edge | ✅ Light/Dark/Cherry/Midnight/Forest all apply; edge-to-edge clean (corner pixels = theme bg sage `rgb(236,242,228)`, NOT white; tab bar clear of gesture pill; status bar not overlapping) | sdk56-qa-13,14,15,16,17 |
| g | **Notification fires on R8 build** | ✅ Fired + rendered ("Soulsync · 2-day streak · You're on a roll…"). 4 proofs: `NotificationsService` receiver registered, `daily-reminder` channel created (color #4CAF50), RTC_WAKEUP scheduled, live NotificationRecord posted. **expo-notifications 56.0.17 survives R8 minification.** | sdk56-qa-23 |
| h | Maestro tour | ⚠️ greeting-assert failed on a cold-start frame (timing artifact — failure shot showed a healthy Home; manual dump confirmed "Good afternoon"). Flow brittleness, NOT a regression. All beats covered manually. | maestro debug shot |
| i | dumpsys version | ✅ versionName 1.2.3 / versionCode 10203 / targetSdk 36 | — |

## v2.0.0 RELEASE-BINARY verification (BURST 4, Pixel 3)

APK under test = `SoulSync-2.0.0.apk` from the GitHub Release (run 27397868475). **Zero crashes.**

| Check | Result | Evidence |
|---|---|---|
| apksigner cert SHA-256 == `db328ae9…c4e02ab` | ✅ exact match | — |
| versionName 2.0.0 / versionCode 20000 / arm-only | ✅ | — |
| **`adb install -r` v2.0.0 OVER the SDK-56 QA build** | ✅ `Success` (same key); 1.2.3/10203 → 2.0.0/20000 | — |
| Launch → entries present | ✅ Home 6.0 / **3 entries** / streak; data survived the 2nd update too | sdk56-v200-01 |
| Full synthetic add-entry on the release binary | ✅ FAB→swipe (Selected 5→2)→Continue→activity (Happy)→Submit→Home | sdk56-v200-02,03,04 |
| dumpsys version | ✅ versionName 2.0.0 / versionCode 20000 / targetSdk 36 | — |
| Installed-build cert (pulled base.apk + apksigner) | ✅ `db328ae9…c4e02ab` — the on-device binary is correctly signed | — |

**Data-survival was verified TWICE** (the whole point — protects Anti's real data): install SDK-56
over v1.2.3, then v2.0.0 over the SDK-56 build. `firstInstallTime` stayed `2026-06-12 14:44:37`
(original v1.2.3) through the entire chain while `lastUpdateTime` advanced — a continuous in-place
update history, data dir never wiped. 3 entries intact throughout.

## Outstanding / follow-ups (non-blocking)

- **Maestro `soulsync-tour.yaml` cleanup**: add a wait/retry before the greeting `assertVisible`, and
  make the photo-picker beats `optional` (they assume a dev build). Tracked in `tasks/lessons.md`.
- **`@types/react-test-renderer`** is now only a transitive dep (of react-native-gesture-handler), not
  ours — harmless, noted in the hop-4 notes.
- Same-day entries dedup/update (TOTAL ENTRIES stays at the distinct-day count when re-submitting the
  same day) is app business logic, NOT an SDK-56 regression — confirmed identical behavior on v1.2.3,
  the QA build, and v2.0.0.

## Exec-plan housekeeping

`~/ops/exec-plans/active/soulsync-sdk-56-upgrade.md` should be marked COMPLETE and moved to
`~/ops/exec-plans/completed/` (this agent is hook-blocked from `~/ops`; the CEO does the move). The
hop-1..4 notes in that plan + `frontend/docs/sdk56-hop4-notes.md` + this file are the full record.
