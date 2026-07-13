# SoulSync 2.4.0 — Health analytics + per-activity insights

Big feature release (Anti: "this will be 1.10... pretty big"). Shipped as **2.4.0** (a big
MINOR bump from the live 2.3.8 — semver/versionCode can't go backwards, so it's 2.4.0, not "1.10").

Built as two parallel Opus dev agents in isolated worktrees, merged into
`feat/soulsync-2.4.0-health-activity-insights`, integrated + gated + released by the main session.

## The three asks (Anti, 2026-07-13)
1. **Health Connect does way more** — HRV→mood, sleep→mood overlays. (sleep→mood + HR→mood already exist.)
2. **"Wait for a few more days" bug** — HC has TONS of days of data but SoulSync says wait. Does our
   sync not backpropagate history? → YES it doesn't: **first sync reads only 30 days back.**
3. **Per-activity insights** — search an activity → detailed insights: distribution + variability
   ("with this activity you're often really sad OR really happy") + how it compares + what you pair it with.

---

## Workstream 1 — Health Connect (WS1, HC/DB layer)

### A. Full historical backfill (fixes "wait a few more days") — the real bug
Root cause: `computeSyncWindow` first-sync path reads only `HEALTH_CONNECT_SYNC_WINDOW_DAYS = 30` days.
A user with months/years of HC history + older mood history only gets 30 days pulled, so paired
(health-day + mood-day) count can stay below `MIN_PAIRS = 7` → "keep logging". Second latent bug:
`readRawWindow` reads a SINGLE page (no `pageToken` loop) → a large window silently truncates.

Fix:
- `getEarliestEntryInstant(db)` → backfill window = **[earliest mood entry day … now]** (capped at
  `MAX_BACKFILL_DAYS = 365`; `INITIAL_WINDOW_DAYS = 30` fallback when there are no mood entries).
- `resolveSyncWindow(...)` (pure): first connect → full mood-history backfill; already-connected user
  whose stored health only covers 30 days → **one-time gap-fill** back to earliest mood day; steady
  state → cheap incremental.
- **Chunk + paginate** the read (≤30-day chunks, `pageToken` loop per record type, aggregate + upsert
  per chunk so raw HR samples stay bounded) — so a year of heart-rate data never truncates or OOMs.

### B. HRV + resting-HR analytics
- HRV is an **optional** permission (`READ_HEART_RATE_VARIABILITY`, record `HeartRateVariabilityRmssd`)
  — `connect()` still succeeds on Sleep+HR only.
- New `avg_hrv_millis` column via **migration v8** (`ALTER TABLE health_metrics ADD COLUMN` — single
  path for fresh + existing installs; do NOT touch frozen migration 7). `DATABASE_VERSION` → 8.
- `hrvMoodCorrelation` + `restingHeartRateMoodCorrelation` (minHeartRate proxy, already stored).

### B2. UI (the headline visual)
- HRV→mood card, Resting-HR→mood card (reuse `MetricMoodCard`).
- **Mood × metric overlay** time-series card ("see your sleep / HRV / resting HR plotted against your
  mood, day by day") with a metric toggle — this is literally Anti's "hrv onto mood, sleep on mood".
- Wired into `app/(tabs)/insights.tsx` beside the existing Sleep/HR cards.

## Workstream 2 — Per-activity insights (WS2, activity layer)
- Queries: `ENTRIES_FOR_ACTIVITY`, `CO_OCCURRING_ACTIVITIES` (doctrine: range-filter raw instant, JS day-keys).
- Pure transforms (`transforms/activityDetail.ts`): `activityMoodStats`, **`classifyVariability`**
  (insufficient / consistent_positive / consistent_low / consistent_neutral / **polarizing** — the
  centerpiece: detects bimodal "hit or miss" activities), reuse `bucketMoodHistogram`.
- Detail screen (fullScreen `OverlayModal` — no pushed routes in this app): header, mood-vs-usual,
  distribution histogram (colored by `moodColor`), variability callout, "often paired with" chips.
- Entry point: **"Explore your activities"** search section on the Stats tab → tap → detail overlay.

---

## Scope fences (parallel-conflict avoidance)
- WS1 owns: `lib/health*`, `databases/{health-metrics,entries,migrations,lifecycle}.ts`,
  `plugins/withHealthConnect.js`, `transforms/healthMoodCorrelation.ts`, new health cards, `insights.tsx`.
- WS2 owns: `queries.ts`, `transforms/activityDetail.ts`, new detail component, `stats.tsx`, `activities.ts`.
- Near-disjoint → clean merge. Only possible overlap is trivial.

## Integration checklist (main session)
- [ ] Merge WS1 branch → integration branch.
- [ ] Merge WS2 branch → integration branch (resolve any conflict; expected none/trivial).
- [ ] `npx tsc --noEmit && npx jest` GREEN on the combined tree.
- [ ] Confirm migration is v8 + `DATABASE_VERSION = 8`; no double-add of `avg_hrv_millis`.
- [ ] Optional: add an insights.tsx tap-through to the activity detail (nice-to-have).
- [ ] Update `plugins/withHealthConnect.js` permission list is reflected in the HC declaration plan doc
      (`ops/routes/soulsync/research/health-connect-integration-plan.md` — now includes HRV).

## QA plan (batched, per project rule)
- **Activity insights**: device-QA-able on my Pixel 3 (Android 12) with local data ("Generate 50 Sample
  Entries" dev button) — Expo Go walk + Maestro if useful.
- **Health Connect**: my Pixel 3 has no Fitbit/HC data → I can verify the code paths + empty states, but
  the real backfill + HRV correlation confirmation is **Anti's Pixel 8 (Android 16)** — sideload the
  `main-latest` APK, connect HC, check the "wait a few more days" is gone and HRV/overlay cards populate.
- One release-APK pass before merge.

## Release
- `scripts/release.sh minor` → 2.4.0 → tag `v2.4.0` → CI builds signed APK + GitHub Release + `main-latest`.
- **Google Play stays HELD**: HC (now incl. HRV) needs the "Health Apps" declaration approved first;
  the `.play-hold` marker gates Play staging. GitHub Release + `main-latest` dev APK still ship.
  (See project CLAUDE.md "Releasing → Google Play" + the `.play-hold` gate.)
