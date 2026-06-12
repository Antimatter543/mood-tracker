# Plan: v2.2.0 correctness + architecture (data-refresh, multi-photo, icon catalog)

## Goal
Fix three confirmed correctness bugs and harden against regressions with tests.

## Task 1 — Robust data refresh (focus-aware, not freeze-fragile)
ROOT CAUSE CONFIRMED: expo-router v6 bottom-tabs (`BottomTabView.js:202`) wraps each
blurred tab in `<MaybeScreen ... shouldFreeze={activityState===STATE_INACTIVE && !isPreloaded}>`
→ react-native-screens `<Screen>` → react-freeze `<Freeze>`. A frozen subtree is suspended,
so its `useEffect(..., [db, refreshCount])` reload NEVER runs while the screen is blurred.
Bumping `refreshCount` from a write on another tab does not refetch the blurred screen →
user sees stale data until full app reopen.

FIX: `frontend/hooks/useDataRefresh.ts` wrapping `useFocusEffect` (exported by `expo-router`,
verified `node_modules/expo-router/build/exports.d.ts:19`). Runs `load` on every focus gain
(navigating to a tab always refetches) AND re-runs while focused when `refreshCount` (or
extraDeps) changes (live in-focus updates). Keep `refreshCount`/`refetchEntries` — the hook
consumes it as the in-focus signal.

Replace the `useEffect(..., [db, refreshCount, ...])` data-LOAD effect with `useDataRefresh`
in ALL 15 consumers (grep-confirmed):
- app/(tabs)/index.tsx, stats.tsx, insights.tsx
- components/DBViewer.tsx (refresh effect ONLY — do NOT touch EntryCard styling, out of scope)
- components/visualisations/: RecoveryPatterns, ActivityCorrelationChart [timeframe],
  MonthOverMonthCard, CustomHeatMap, DailyMoodBar [timeframe], StatSummaryCard [timeframe],
  WeeklyMoodChart [timeframe, formatDateLabel], MoodTrendChart [tf, formatDateLabel],
  MoodCalendar, Scatterplot [timeframe], ActivityImpactChart [timeframeCondition]
Preserve every query verbatim; only change WHAT triggers the reload. db + timeframe/prop deps
go into extraDeps.

STRETCH (skipped — see decision below).

TESTS: `__tests__/useDataRefresh.test.tsx` — mock `useFocusEffect` to invoke its callback;
assert `load` called on focus and again when `refreshCount` changes (callback identity changes).

## Task 2 — Multi-image selection
`EntryForm.tsx` `PhotoAttachments.pick('library')` sets `allowsMultipleSelection:false` and reads
only `result.assets[0]`. MAX_PHOTOS=5.
FIX: library path → `allowsMultipleSelection:true`, `selectionLimit = MAX_PHOTOS - photos.length`;
add every returned asset capped to MAX. Camera stays single.
PURE HELPER: `frontend/components/forms/photoSelection.ts` → `selectPhotosToAdd(currentCount,
pickedUris, max)` returns URIs to add (cap + dedupe-against-already-present is impossible from
count alone, so dedupe within the picked batch + cap to remaining). Wire into PhotoAttachments.
TESTS: `__tests__/photoSelection.test.ts` — empty, under, exactly-at, over limit, dedupe.

## Task 3 — Invalid icons + mis-wired FontAwesome6 family
`IconPicker.tsx`. Full glyphmap audit (script) found THREE invalid catalog names (task named 2):
- Feather `refresh` → `refresh-cw`
- MaterialCommunityIcons `brain-freeze` → `head-snowflake`
- MaterialCommunityIcons `guitar` → `guitar-acoustic`  (EXTRA — not in task brief)
Line 8 `import * as FontAwesome6 from '@expo/vector-icons/MaterialCommunityIcons'` is WRONG.
DECISION: FIX the import (point at the real `@expo/vector-icons/FontAwesome6`), do NOT remove the
family — `components/seedData.ts:39` seeds `{icon_family:'FontAwesome6', icon_name:'bed'}` and `bed`
IS in FontAwesome6Free.json (the real FA6 glyphmap). Removing the family would blank that seeded glyph.
All 34 seed entries audited → valid once the import is fixed.
TESTS: `__tests__/iconCatalog.test.ts` — every ICON_CATEGORIES entry name ∈ its family glyphmap;
every family ∈ ICON_FAMILIES. Permanent regression guard. (Map family→glyphmap explicitly; FA6 uses
FontAwesome6Free.json, name ≠ family.)

## Decisions made
- Task 1 stretch (`addDatabaseChangeListener` auto-bump): SKIPPED. The focus-aware hook fully fixes
  the reported bug; the listener is a decoupling nicety that adds a global write-watcher + risk of
  double-refetch, for no user-visible gain here. Belt-and-braces `refetchEntries()` calls already exist.
- Task 3 EXTRA `guitar` fix included — same class of bug (invalid glyph → blank), and the new
  iconCatalog test would fail if left unfixed. Closest in-family valid name chosen.
- OUT OF SCOPE (UI agent owns): EntryCard/PhotoStrip visuals, edit-pencil glyph in DBViewer. Only
  DBViewer's data-load effect is touched.

## Gate
`cd frontend && npx tsc --noEmit && npx jest` after each task + at the end. NO native build, NO `npm run check`.
