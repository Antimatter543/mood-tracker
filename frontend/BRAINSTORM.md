Confirmed: current DB is at v3, and three lenses all want to claim "migration v4." This is the critical sequencing fact. I have what I need.

# SoulSync — Improvement Roadmap & Brainstorm

> Synthesized from 5 design lenses (Notifications, Statistics, Media Attachments, UI/Bug-Polish, Delight/Differentiation). This is the build doc — the agents read THIS, not the raw lens specs. All work is 100% local: no accounts, no cloud, no server.

---

## 1. Executive Summary

We are turning SoulSync from a clean-but-thin mood logger into a retention-grade privacy-first journal. Four confirmed build tracks land this session, in this priority order:

1. **UI Bug/Polish** — fix the live data-corruption bug (weekly chart 8-points/7-labels mismatch), kill the production `console.log`, remove the deceptive fake-friends Social tab, and fix theme-breaking hardcoded colors. **Ships first because it's mostly zero-dep, zero-migration, and removes embarrassing/broken surfaces.**
2. **Statistics** — replace low-signal charts with rigorous ones (with/without activity correlation, moving-average trend, KPI summary card, month-over-month). **Zero new deps, zero migration** — pure transforms + SVG. Highest quality-per-effort track.
3. **Notifications** — local daily reminder, streak-aware copy, user-set time, "skip if already logged" guard. **Requires `expo-notifications` + a native dev-client rebuild.**
4. **Media Attachments** — wire up the already-existing-but-dead `entry_media` table for multi-photo entries. **Requires `expo-image-picker` + the same native rebuild.**

**Why it matters:** Notifications are the single biggest retention lever for any journaling app (a 7-day-streak user becomes a long-term user). Statistics is the actual value proposition — turning logs into self-knowledge. The Social tab currently ships *fake friend data behind a "Coming Soon" overlay* in a no-accounts app — that's a trust-destroying lie we remove this session. Media + the polish pass close the gap vs Daylio/How We Feel.

**The one hard sequencing constraint:** the DB is at **v3 today**, and Notifications + Media + (idea-bank) Reflect/Onboarding/Privacy-Lock all independently assume "I'm migration v4." **They cannot all be v4.** See §5 for the assigned version ladder. This is the #1 merge-conflict hotspot.

---

## 2. The 4 Build Tracks

### Track A — UI Bug / Polish (ship first, no migration, no deps)

**Decision:** Fix every P0/P1 in one pass. Replace the Social tab with an **Insights tab** (not just delete it) — it reuses existing streak/activity/recovery data, costs zero deps, and converts a dead deceptive tab into a retention surface. Centralize all color through `useThemeColors()`; no raw hex in render paths except *semantic* signal colors (error red / warning amber), which are allowed.

**Must-do (P0 — broken/corrupt/embarrassing):**
- `app/(tabs)/index.tsx`: change weekly loop `for (let i = 7; …)` → `for (let i = 6; …)` so 7 data points match 7 labels (chart currently misaligns/drops a column).
- `app/(tabs)/index.tsx` line 134: **delete** `console.log(interpolatedData)` (fires every render in production).
- `app/(tabs)/index.tsx`: replace emoji `MoodIcon` (😄🙂😐🙁😢) with `Ionicons` (`happy`/`happy-outline`/`remove-circle-outline`/`sad-outline`/`sad`), tinted via `moodColor()`. **Brand rule: no emoji-as-icon.**
- `components/forms/MoodSelector.tsx`: replace emoji `moodBenchmarks` (💀😐🙂😄) with `Ionicons`. (Use `skull-outline`/`remove-outline`/`happy-outline`/`sunny-outline` OR `sad`/`remove-circle-outline`/`happy-outline`/`happy` — pick one set and be consistent with `MoodIcon`.)
- **Social → Insights:** delete `app/(tabs)/social.tsx`; create `app/(tabs)/insights.tsx` (cards: streak, best day-of-week, top activity impact, recovery status, monthly-trend sentence — each self-contained `useEffect` + query); edit `app/(tabs)/_layout.tsx` to rename route `social`→`insights`, title `'Insights'`, icon `Ionicons bulb/bulb-outline` (also fixes the `name={focused ? 'mood' : 'mood'}` no-op ternary). **Grep all non-tab files for `'social'` before deleting** — a stale route reference will crash navigation.
- `components/visualisations/chartUtils.ts`: chart line is hardcoded green `rgba(76,175,80,…)` on every theme. Parse `colors.accent` hex → rgba. **Cache the parsed r/g/b in closure** (the function runs many times per render). Remove the dead static `colors` import.
- `placeholderTextColor="#666"` → `{colors.textSecondary}` in `EntryForm.tsx`, `ActivitySelector.tsx` (×2), `ActivityEditModal.tsx` (invisible on dark themes).
- `components/visualisations/CustomHeatMap.tsx`: replace UTC `date('now')` end-date with a JS-computed local-date string param (same fix already applied to `WeeklyMoodChart`). Today's evening entries vanish until UTC midnight for AEST users otherwise.

**Must-do (P2 — visible correctness):**
- `components/visualisations/ActivityImpactChart.tsx`: theme detection compares `colors.accent === '#DB7093'` (cherry's real accent is `'#C7527C'`) — never fires. Replace the whole `negativeColor` memo with `colors.isDark ? '#FF5252' : '#E53935'`.
- `components/Card.tsx`: add `paddingTop: 3` to children wrapper when `accentTop` (the 3px accent bar currently overlaps the first 3px of content).
- `app/(tabs)/index.tsx`: activity tags render `"Running (3) "` (trailing space + debug count) → `a.name`.

**Nice-to-have (P3):**
- Wrap `StyleSheet.create` in `useMemo(…, [colors])` in `TimeframeSelector.tsx`, `stats.tsx`, `SettingRow.tsx`.
- Home hero: bump today's mood number 48→64px / weight 900; add a time-of-day greeting; 24px gap below the hero card.
- Stats `paddingTop: 120` magic number → `onLayout`-measured header height.
- DBViewer edit/delete buttons: `minHeight/minWidth: 44`, add `accessibilityLabel`/`accessibilityRole`.
- Remove dead static `colors` import in `DBViewer.tsx`; delete commented-out code blocks; copyright `2024`→`2025`.

**Files:** `app/(tabs)/index.tsx`, `app/(tabs)/social.tsx` (delete), `app/(tabs)/insights.tsx` (create), `app/(tabs)/_layout.tsx`, `app/(tabs)/settings.tsx`, `app/(tabs)/stats.tsx`, `components/Card.tsx`, `components/DBViewer.tsx`, `components/TimeframeSelector.tsx`, `components/forms/{EntryForm,MoodSelector,ActivitySelector,ActivityEditModal}.tsx`, `components/visualisations/{chartUtils,ActivityImpactChart,CustomHeatMap}.tsx`.

---

### Track B — Proper Statistics (no migration, no deps)

**Decision:** **No new chart library.** Keep `react-native-chart-kit` for the working line/bar charts; use `react-native-svg` (already installed, v15.8.0) for all new custom charts. `react-native-gifted-charts` and `victory-native` are **rejected** — both pull native peer deps that force an EAS rebuild we don't want on this track. All new logic lives in **pure, unit-tested transforms**.

**Must-do (the high-signal core):**
- **`StatSummaryCard.tsx`** + `transforms/statSummary.ts` — 2×2 KPI grid: streak (current/longest), avg mood, consistency %, trend arrow. Feather icons, theme tokens, semantic red for "falling". This is the single highest-density insight surface.
- **`ActivityCorrelationChart.tsx`** + `transforms/activityCorrelation.ts` + `ACTIVITY_CORRELATION` SQL — replaces `ActivityImpactChart`'s misleading delta-from-mean with rigorous **avg-with vs avg-without** per activity. Only show items with `count_with ≥ 5 AND count_without ≥ 5`. **Leave `ActivityImpactChart.tsx` in the repo (still tested) — just stop mounting it.**
- **`MoodTrendChart.tsx`** + `transforms/movingAverage.ts` — chart-kit line + SVG moving-average overlay. MA window adapts: none (week), 7-day (month), 14-day (3mo+). Cap render at 90 points (sample every N-th) for alltime.
- **Fix `Scatterplot.tsx` (histogram)** — remove hardcoded `date('now','-30 days')`, wire to TimeframeSelector params, rename title "Mood Distribution".
- **Fix `MoodCalendar.tsx`** — replace all hardcoded dark hex in the Calendar `theme` prop with `useThemeColors()` tokens (currently breaks on every non-dark theme).

**Nice-to-have:**
- `MonthOverMonthCard.tsx` + `transforms/monthOverMonth.ts` ("am I better than last month?"). **Note:** this card uses *calendar-month* windows, NOT the rolling TimeframeSelector — label it clearly so users don't conflate the two.
- Upgrade `DailyMoodBar.tsx` to timeframe-scoped `DOW_MOOD_PATTERN` query + `mondayFirst` flag on `buildDailyBarData` (default false preserves existing callers).
- `SectionHeader.tsx` + restructure `stats.tsx` into OVERVIEW / PATTERNS / ACTIVITIES.
- **Remove `RecoveryPatterns` from the screen** (renders empty for most users, confusing concept) but fix its UTC bug so the component stays valid.

**Critical extraction:** `computeWindow` is duplicated inline in `WeeklyMoodChart.tsx`. Before `MoodTrendChart` + `DailyMoodBar` both need it, **extract it to a shared `windowHelpers.ts`** to avoid a third copy.

**Files (create):** `components/visualisations/StatSummaryCard.tsx`, `MoodTrendChart.tsx`, `ActivityCorrelationChart.tsx`, `MonthOverMonthCard.tsx`, `components/SectionHeader.tsx`, `transforms/{movingAverage,dayOfWeekPattern,activityCorrelation,monthOverMonth,statSummary}.ts`, plus `__tests__/{movingAverage,dayOfWeekPattern,activityCorrelation,monthOverMonth,statSummary}.test.ts`.
**Files (edit):** `queries.ts` (+`ACTIVITY_CORRELATION`,`DOW_MOOD_PATTERN`,`WINDOW_SUMMARY`), `Scatterplot.tsx`, `MoodCalendar.tsx`, `DailyMoodBar.tsx`, `transforms/dailyBar.ts`, `RecoveryPatterns.tsx`, `app/(tabs)/stats.tsx`, `context/TimeframeContext.tsx` (deprecation comment on `getTimeframeCondition`).

**Watch:** `ACTIVITY_CORRELATION` self-join may be slow on 1000+ entries — the `HAVING count_with >= 3` filter helps; check for an existing index on `entry_activities(activity_id)` in `lifecycle.ts` before adding one.

---

### Track C — Local Notifications (NEW DEP + native rebuild)

**Decision:** `npm install expo-notifications@~0.29.0` (pinned, SDK-52-compatible — do **not** use `latest`). **This is incompatible with Expo Go on Android (SDK 52 / new arch) — the only valid test path is a dev-client build (`npx expo run:android`).** `expo-dev-client` is already in deps, so no new tooling. All scheduling logic lives in pure functions in `lib/notifications.ts` so the computation layer is fully Jest-testable without a native build.

**Approach:** Single public entry `scheduleOrSkipDailyReminder(opts)` called on **every app foreground** (OS can silently drop scheduled notifications, so re-arm is the correct pattern — `AppState` listener, not just cold boot). Uses the `DAILY` trigger type. "Already logged today" guard reschedules for tomorrow so the streak chain continues. Permission is requested **only on user gesture** (toggling the switch ON), never on cold boot.

**Migration:** **v4** — seeds `reminder_enabled` (false) + `reminder_time` ('20:00', "HH:MM" 24h) via `INSERT OR IGNORE` into `user_settings`. No schema change (KV store). `reminder_time` uses `type: 'text'` so the generic `SettingRow` skips it — the custom time picker owns it.

**Must-do:**
- `npm install expo-notifications@~0.29.0`; add plugin block + android perms (`RECEIVE_BOOT_COMPLETED`, `SCHEDULE_EXACT_ALARM`) to `app.json`.
- `databases/settings.ts`: 2 keys + `SettingValues`. `databases/migrations.ts`: migration v4.
- Create `lib/notifications.ts` (pure: `pickReminderCopy`, `parseReminderTime`, `formatReminderTime`, `nextTriggerDate`, `hasLoggedToday`; effectful: `ensureAndroidChannel`, `requestNotificationPermission`, `rescheduleDailyReminder`, `scheduleOrSkipDailyReminder`).
- `app/(tabs)/_layout.tsx`: add `NotificationReArm` render-null component inside `SettingsProvider`, AppState-driven. **Use a static `import { currentStreak }` — not the dynamic import shown in the lens spec.**
- `components/SettingRow.tsx`: add `RemindersSection` (switch + `@react-native-community/datetimepicker` time picker — already in deps at 8.2.0). Permission gated in `handleToggle`. Wire into `settings.tsx`.
- `__mocks__/expo-notifications.ts` + `__tests__/notifications.test.ts` (pure-fn coverage) + V4 block in `migrations.test.ts`.

**Nice-to-have (flag as TODO, skip v1):** evening streak-save nudge; weekly recap notification.

**Files:** `app.json`, `package.json`, `databases/{settings,migrations}.ts`, `lib/notifications.ts` (create), `app/(tabs)/{_layout,settings}.tsx`, `components/SettingRow.tsx`, `__mocks__/expo-notifications.ts` (create), `__tests__/{notifications,migrations}.test.ts`.

---

### Track D — Media Attachments (NEW DEP + native rebuild)

**Decision:** The `entry_media` table **already exists from v1** (created but never written/read — schema-present, functionally dead). **Wire up that table — do NOT add `image_uri` to `entries`.** This gives multi-photo per entry for free, and the existing `ON DELETE CASCADE` handles DB cleanup. Files are copied into `FileSystem.documentDirectory + 'entry_media/'` on pick (stable path). Use **UUID-style filenames** (`ts_rand.ext`) so we avoid a two-phase rename around the insert.

**Migration:** **v5** (v4 is taken by Notifications — see §5). Rebuild `entry_media` with a `created_at` column (for stable in-entry sort) + `idx_entry_media_entry_id` index. The rename-recreate-copy-drop pattern is safe on the empty table. Bump `DATABASE_VERSION` in `lifecycle.ts`.

**Export decision: file-refs, NOT base64.** Embed `photos: [{file_path, media_type, created_at}]` per entry; bump export `version` to 2. A 20-photo user would generate 60+ MB of base64 JSON — unacceptable for a backup meant to be emailed. Import inserts the rows but **paths are device-specific** — the result message must warn that photo files aren't portable. (Zip-with-media is a V2 idea, needs a new dep.)

**Must-do:**
- `npx expo install expo-image-picker` (resolves ~15.0.x for SDK 52 — `MediaTypeOptions.Images` is correct for v15; v16+ changes this but that's a compile error, safe to ship now). Add plugin + permission strings to `app.json`.
- Migration v5 + `DATABASE_VERSION` bump.
- Create `databases/mediaHelpers.ts` (`MEDIA_DIR`, `ensureMediaDir`, `buildMediaFilename`, `copyMediaToStore`, `deleteMediaFile` — fail-soft on missing files).
- `databases/entries.ts`: extend `addMoodEntry` with optional `photoPaths`; hydrate `photos` in `getMoodEntries`; add `getPhotosForEntry`, `deleteEntryPhoto`, **`deleteEntryWithMedia`** (critical — SQL CASCADE removes rows but NOT files on disk). Re-export from `database.ts`. Add `EntryPhoto` type + `MoodEntry.photos` in `components/types.ts`.
- `components/forms/hooks/useEntryDraft.ts`: `photoPaths` in draft + `addPhoto`/`removePhoto`; `reset()` clears it.
- Create `components/forms/PhotoPicker.tsx` (camera/library buttons, thumbnail strip, remove-with-confirm); wire into `EntryForm` `DetailsStep`; pass `photoPaths` from `AddEntryButton` → `addMoodEntry`.
- Create `components/PhotoViewer.tsx` (full-screen FlatList pager); add `PhotoStrip` thumbnails to `DBViewer` `EntryCard`; swap delete → `deleteEntryWithMedia`; seed `photoPaths` into edit-modal `initialData`; diff add/remove photos in `handleUpdate`.
- `databases/data-export.ts`: embed photos on export (version 2), import photo rows, warning message.
- Tests/mocks: `__tests__/mediaHelpers.test.ts`, extend `__mocks__/expo-file-system.ts` (`getInfoAsync`/`makeDirectoryAsync`/`deleteAsync`), create `__mocks__/expo-image-picker.ts`, update `useEntryDraft.test.ts` / `entries.test.ts` / `data-export.test.ts` / `migrations.test.ts`.

**MUST-CODE-EXPLICITLY (most likely ship bug):** on **form cancel** with `draft.photoPaths.length > 0` and no submit, call `deleteMediaFile()` for each path — otherwise picked-then-cancelled photos orphan in `MEDIA_DIR` forever.

**Files:** `app.json`, `package.json`, `databases/{migrations,lifecycle,entries,database,data-export}.ts`, `databases/mediaHelpers.ts` (create), `components/types.ts`, `components/forms/{hooks/useEntryDraft,EntryForm,PhotoPicker}.tsx`, `components/{AddEntryButton,DBViewer,PhotoViewer}.tsx`, plus mocks/tests above.

---

## 3. Impact / Effort Matrix

Quick-wins (high impact / low effort) at top. **★ = ship this session.**

| Item | Track | Impact | Effort |
|---|---|---|---|
| ★ Fix weekly chart 8/7 data-label mismatch | A | High | Low |
| ★ Delete production `console.log(interpolatedData)` | A | High | Low |
| ★ Replace emoji MoodIcon + MoodSelector benchmarks | A/D-bank | High | Low |
| ★ Chart line color → theme accent (not hardcoded green) | A | High | Low |
| ★ `placeholderTextColor #666` → theme token (×4 files) | A | High | Low |
| ★ Haptic feedback layer (expo-haptics already installed) | bank | High | Low |
| ★ Longest-streak + all-time stats pills on home | bank | Medium | Low |
| ★ CustomHeatMap UTC `date('now')` fix | A | Medium | Low |
| ★ ActivityImpactChart broken theme detection | A | Medium | Low |
| ★ Card accentTop clips 3px of content | A | Medium | Low |
| ★ Remove trailing space / debug count on activity tags | A | Medium | Low |
| ★ Entry confirmation micro-animation (FAB→check) | bank | Medium | Low |
| ★ StatSummaryCard (KPI grid) | B | High | Medium |
| ★ ActivityCorrelationChart (with/without) | B | High | Medium |
| ★ MoodTrendChart (moving-average overlay) | B | High | Medium |
| ★ Fix Scatterplot histogram timeframe wiring | B | High | Low |
| ★ Fix MoodCalendar hardcoded dark theme | B | High | Low |
| ★ Social tab → Insights tab | A | High | Medium |
| ★ MonthOverMonthCard / DOW upgrade / SectionHeaders | B | Medium | Low–Med |
| ★ CSV export | bank | Medium | Low |
| ★ Daily reminder notifications | C | High | High |
| ★ Media attachments (photos) | D | High | High |
| StyleSheet.create → useMemo (×3) | A | Medium | Low |
| Home hierarchy / hero / greeting | A | High | Medium |
| a11y touch targets + labels | A | Medium | Low |
| On This Day memory card | bank | High | Medium |
| Mood trend insight card | bank | High | Medium |
| Timeline search & filter | bank | High | Medium |
| Year in Pixels | bank | High | Medium |
| Swipe-to-delete on timeline | bank | Medium | Medium |
| Customizable mood-scale labels | bank | Medium | Medium |
| First-run onboarding | bank | High | High |
| Biometric / passcode lock | bank | High | High |

---

## 4. Idea Bank

### Build now (cheap quick-wins, fold into this session)
- **Haptic feedback layer** — `expo-haptics` is already installed and unused. `selectionAsync()` on mood-scroll snap, `impactAsync(Light)` on activity toggle, `notificationAsync(Success)` on submit, `impactAsync(Medium)` on delete. The cheapest delight upgrade available. *(MoodSelector, ActivitySelector, AddEntryButton, DBViewer)*
- **Longest-streak + all-time stats pills** — `longestStreak()` is already implemented and tested in `transforms/streak.ts` but **never rendered**. Add a pills row to `TodaysMoodCard`: best streak, total entries, "tracking since" (one extra `SELECT COUNT(*), MIN(date)`).
- **Entry confirmation micro-animation** — FAB morphs `plus`→`check` with a spring on submit (~30 lines, Reanimated already wired). Closes the "did it save?" loop.
- **CSV export** — `exportAsCSV(db)` next to the existing JSON export. Reuses all FileSystem/Sharing infra. Privacy-first users want to open their data in Sheets.

### V2 (next cycle — medium effort, high value, no native rebuild)
- **On This Day memory card** — entries from 1yr/6mo/1mo ago, pick highest `ABS(mood-5)`. Daylio's most-loved feature. Zero schema change.
- **Mood trend insight card** — "Fridays are your best days (+1.3)", "Exercise correlates with +0.8". Surfaces the correlation headline on home (Bearable's signature). Reuses Track B's correlation transform.
- **Timeline search & filter** — search notes + filter by mood/date/activity. Table stakes past 100 entries; Daylio paywalls it, we give it free. Build the range slider with Reanimated (no new dep).
- **Year in Pixels** — 365-square grid; `CustomHeatMap` already implements ~90% of the SVG mechanics. The sole feature of a 500K-download competitor.
- **Swipe-to-delete on timeline** — `react-native-gesture-handler` `Swipeable` (already a transitive dep — verify version supports the API).
- **Customizable mood-scale labels** — store `mood_labels` JSON in `user_settings`. "Terrible/Good/Terrific" is clinically loaded for some users. One settings key + 4 inputs.

### V3 / maybe (high effort or needs the native build window)
- **First-run onboarding (3-screen)** — theme pick + scale choice + reminder opt-in. High value but high effort; do it *after* notifications land so screen 3 is real.
- **Biometric / passcode lock** — `expo-local-authentication` + `expo-secure-store` (PIN never in SQLite). Makes the privacy promise tactile. Bundle its native deps into the *same* rebuild as notifications/image-picker if we commit to it.
- **Gratitude/Reflect tab** — *only if* we keep a 4th tab. **Conflicts with the Insights-tab decision in Track A** — we are spending the Social slot on Insights, which reuses existing data with zero new tables. Reflect needs a new `reflections` table + migration. **Decision: Insights wins this session; Reflect is a V3 maybe, would need its own tab, not the Social slot.**

**Cut (generic, low-conviction):** evening streak-save nudge and weekly-recap notification (over-notifying erodes trust before we've validated the base reminder); zip-with-media export (premature, needs a dep for an unvalidated need).

---

## 5. Risks & Sequencing

### Build order
1. **Track A (UI/Polish) first.** Mostly zero-dep, zero-migration. Removes broken/deceptive surfaces. Lowest risk, highest "looks fixed" signal. Ships without any native rebuild.
2. **Track B (Statistics) second.** Zero-dep, zero-migration, pure transforms. Fully testable in Jest. Can land in parallel with A on a separate worktree (minimal file overlap — only `stats.tsx` and `ActivityImpactChart` touch both; coordinate those).
3. **Track C (Notifications) third** — first track that needs `expo-notifications` + a native dev-client rebuild. Owns **migration v4**.
4. **Track D (Media) fourth** — needs `expo-image-picker` + the **same** native rebuild. Owns **migration v5**. **Batch C and D into ONE `npx expo run:android` cycle** — don't rebuild twice.

### THE migration ladder (non-negotiable — resolves the v4 collision)
DB is at **v3 today**. Three lenses each independently wrote "migration v4." Assign explicitly:

| Version | Owner | Content |
|---|---|---|
| v4 | **Notifications** | seed `reminder_enabled`, `reminder_time` |
| v5 | **Media** | rebuild `entry_media` (+`created_at`, +index) |
| v6+ | future (Reflect/Onboarding/Privacy/mood-labels) | claim next free integer |

**Whoever's branch merges second must renumber to the next free version and bump `DATABASE_VERSION` in `lifecycle.ts` line 14 to match.** A duplicate version number or a `DATABASE_VERSION` that lags the highest migration is a silent data-layer break.

### Merge-conflict hotspots (serialize edits to these, don't parallelize)
- **`databases/migrations.ts`** — every track that migrates appends here. Append in version order; rebase, don't blind-merge.
- **`databases/settings.ts` (`SETTINGS_REGISTRY` + `SettingValues`)** — Notifications adds keys; bank ideas (mood-labels, onboarding) add more. Coordinate.
- **`databases/lifecycle.ts` `DATABASE_VERSION`** — single integer, multiple writers.
- **`app/(tabs)/_layout.tsx`** — Track A renames Social→Insights; Track C adds `NotificationReArm`. Both edit this file — land A's rename first, then C inserts the component.
- **`app/(tabs)/settings.tsx`** + **`components/SettingRow.tsx`** — Notifications `RemindersSection` and any bank settings sections collide here.
- **`app/(tabs)/stats.tsx`** — Track B restructures it; Track A's polish touches it. B owns the layout; A's stats changes go on B's branch.
- **`__tests__/migrations.test.ts`** — each migrating track adds a `describe('Migration Vn')`. The count-based invariant tests use `migrations.length` (not hardcoded), so they auto-adjust — but the per-version blocks must not clobber each other.

### Native-build / testing reality (read before touching C or D)
- **`expo-notifications` does NOT run in Expo Go on Android (SDK 52 / RN 0.76 new arch).** The ONLY test path is a dev-client build: `npx expo run:android`. `expo-dev-client` is already installed, so no new tooling — but every notification test on Android requires the rebuild.
- **`expo-image-picker` similarly requires the native build** for camera/library.
- **Pure functions are testable WITHOUT the rebuild.** Both tracks deliberately push logic into pure modules (`lib/notifications.ts`, `databases/mediaHelpers.ts`) so the build agent gets green Jest before the device build. The native build is for the *integration* surface only.
- **253 existing tests must stay green.** New native modules throw on import in Jest unless mocked — the `__mocks__/expo-notifications.ts`, `__mocks__/expo-image-picker.ts`, and the `expo-file-system` mock extensions are **on the critical path**, not optional polish. Land mocks in the same commit as the code that imports them.

### Other risks
- **`'social'` route references** — grep the whole project before deleting `social.tsx`; a stale string reference crashes the tab navigator.
- **Orphaned media files on form cancel** (Track D) — the single most likely ship bug. Must be coded explicitly (see Track D).
- **`getMoodEntries` N+1** — already 2 queries/entry (activities); photos make it 3. Acceptable now; batch with an `IN`-list query if the timeline slows.
- **`MoodTrendChart` SVG overlay** depends on chart-kit's internal `~50px` left offset — document the magic number and pin the chart-kit version, or it misaligns on upgrade.
- **Import photo paths are device-specific absolute paths** — they'll render broken on a different device. The warning message is the v1 mitigation; existence-validation on import is a future hardening note.