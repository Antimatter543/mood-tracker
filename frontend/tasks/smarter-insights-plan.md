# SoulSync — Smarter Insights build doc

> Read THIS, not the chat. Goal: make correlation *state-conditioned* (dip-recovery
> drivers + destabilizers) and split the trend descriptor into a 2-axis mood-state
> (trend × volatility). 100% local. No new deps, no DB migration. Pure tested
> transforms + thin renderers, matching the existing `transforms/` architecture.

## Hard doctrine (do not violate — it is invariant-tested)
- **SQL NEVER day-buckets.** Queries only range-filter on the stored UTC instant and
  return RAW rows. ALL "which local day" keying happens in JS via `localDateString` /
  `aggregateDailyAverages` (see `transforms/dailyAverages.ts`, `queries.ts` header).
  New transforms MUST consume already-local-keyed data (a `DailyAverage[]` / dayAvg
  map), never re-key, never add `date()`/`strftime()` to SQL.
- Mood scale is ~0–10 (benchmarks/skull..happy; DIP_THRESHOLD=4, RECOVERY_THRESHOLD=6
  in `recoveryPatterns.ts` — reuse those constants where relevant).
- Every pure transform ships WITH a `__tests__/<name>.test.ts` (jest, see existing
  `statSummary.test.ts` / `activityCorrelation.test.ts` for style). Tests are part of
  the change, not a follow-up.
- Honesty: all surfaced claims are gated on sample size, framed as "patterns in your
  data," never causal/medical/advice. Below-threshold data → gentle "keep logging"
  state, NEVER a misleading number.

---

## Part 1 — `transforms/moodState.ts` (2-axis classification)

Replaces the single rising/falling/stable arrow with two independent axes.

### Inputs
```ts
buildMoodState(daily: DailyAverage[], opts?: { slope?: number }): MoodState
```
- `daily`: per-local-day averages, sorted ascending (from `aggregateDailyAverages`).
  Use RECORDED days only (do NOT gap-fill — gap-filling dampens/zeros real swings).
- `opts.slope`: optional precomputed MA slope (per-day) so the descriptor matches the
  MoodTrendChart line. If absent, compute slope via least-squares over `daily` (x = day
  index 0..n-1, y = avg). Reuse `SLOPE_THRESHOLD = 0.02` from statSummary for the trend
  cut.

### Axis 1 — trend (direction)
- `|slope| < SLOPE_THRESHOLD` → `'steady'`; `slope > 0` → `'rising'`; else `'falling'`.

### Axis 2 — volatility (day-to-day swing)
- Walk consecutive entries in `daily`. For each adjacent pair, compute the calendar gap
  in days (use `daysBetween` from dateHelpers). Include `|avgᵢ₊₁ − avgᵢ|` ONLY when the
  gap ≤ `MAX_GAP_DAYS = 3` (a 2-week gap is not a real "swing").
- `swing` = mean of included absolute diffs. Export thresholds (tunable):
  `STABLE_SWING = 0.8`, `VOLATILE_SWING = 1.8`.
  - `swing < 0.8` → `'stable'`; `< 1.8` → `'variable'`; else `'volatile'`.

### Data gate
- Need `≥ MIN_STATE_DAYS = 5` recorded days AND `≥ 3` valid transitions, else
  `state: 'building'`, `label: 'Keep logging to reveal your pattern'`, numbers null.

### Output
```ts
export type MoodTrend = 'rising' | 'falling' | 'steady';
export type MoodVolatility = 'stable' | 'variable' | 'volatile';
export type MoodState = {
  state: 'building' | 'classified';
  trend: MoodTrend | null;
  volatility: MoodVolatility | null;
  swing: number | null;       // mean day-to-day |Δ|, 1dp
  slope: number | null;       // per-day, signed
  label: string;              // warm human label, see matrix
  description: string;        // one sentence w/ the numbers
};
```

### Label matrix (trend × volatility) — warm, plain, non-clinical
| | stable | variable | volatile |
|---|---|---|---|
| rising | Steadily lifting | Trending up | Climbing through ups & downs |
| steady | Settled | Holding steady | Up and down |
| falling | Gently dipping | Trending down | A rough, turbulent patch |

`description` examples: "Settled — level and calm, swinging only ~0.5 pts day to day."
/ "A rough, turbulent patch — drifting down and swinging ~2.3 pts day to day."

> Keep `buildStatSummary`'s `trendArrow` EXACTLY as-is (back-compat + its tests).
> moodState is additive.

---

## Part 2 — `transforms/moodDrivers.ts` (state-conditioned, forward-looking correlation)

The smarter correlation. Answers: *when I'm low, what's followed by a lift?* and
*when I'm steady, what's followed by a dip?*

### Shared day-model (DRY — factor out, reuse for activityCorrelation too if clean)
From the existing `ACTIVITY_CORRELATION` raw rows (`ActivityCorrelationRawRow[]`), build:
```ts
type DayModel = {
  days: string[];                    // sorted ASC local "YYYY-MM-DD"
  dayAvg: Map<string, number>;       // local day -> avg mood
  activityDays: Map<string, Set<string>>; // activity name -> local days it appears
  activityNames: Set<string>;
};
```
This is exactly what `aggregateActivityCorrelation` already computes internally — extract
a `buildDayModel(rawRows)` helper (in moodDrivers.ts or a small shared module) and have
moodDrivers consume it. Do NOT duplicate day-keying; route through `localDateString`.

### Forward delta
For a day `d` at index `i` in `days`: let `next = days[i+1]`. If
`daysBetween(d, next) ≤ FWD_MAX_GAP = 3`, then `fwd(d) = dayAvg[next] − dayAvg[d]`;
else `d` has no forward signal (skip it). (Forward = "what happened next" — the honest
proxy for "did this lift/drop me".)

### Regime per day (by that day's avg mood)
- `baseline` = median of all `dayAvg` values.
- LOW day: `dayAvg[d] ≤ DIP_THRESHOLD` (4).
- STEADY day: `dayAvg[d] > DIP_THRESHOLD` AND `|dayAvg[d] − baseline| ≤ STEADY_BAND = 1.0`
  (i.e. near the user's own typical level — "when it's usually stable").

### Two analyses (each: split the regime's days by activity present/absent on day d)
For activity `A`, over the regime's days that have a valid `fwd`:
- `withMean` = mean fwd on regime-days where A ∈ activityDays (day d in A's set)
- `withoutMean` = mean fwd on regime-days where A ∉
- `effect = withMean − withoutMean`
- `isMeaningful = withCount ≥ MIN_DRIVER_SAMPLES (4) AND withoutCount ≥ 4`

**Recovery drivers** = analysis over LOW days. `effect > 0` ⇒ "when low, days you log A
are followed by a bigger lift." Sort by effect DESC.
**Destabilizers** = analysis over STEADY days. `effect < 0` ⇒ "when steady, days you log
A tend to precede a dip." Sort by effect ASC (most draining first).

### Output
```ts
export type MoodDriver = {
  activity_name: string;
  effect: number;      // signed, 2dp (mean forward-delta diff)
  withMean: number; withoutMean: number;
  withCount: number; withoutCount: number;
  isMeaningful: boolean;
};
export type MoodDriversData = {
  recoveryDrivers: MoodDriver[];   // meaningful only, effect>0, sorted desc
  destabilizers: MoodDriver[];     // meaningful only, effect<0, sorted asc
  lowDayCount: number; steadyDayCount: number;  // for the "keep logging" copy
  hasRecoverySignal: boolean;      // recoveryDrivers.length > 0
  hasDestabilizerSignal: boolean;
};
```
Edge cases (test them): empty rows; all-same-day; activity logged every day (withoutCount
0 → not meaningful); large gaps killing forward signal; <gate samples → empty arrays +
false flags (never throw).

---

## Part 3 — Renderers (thin)

1. **`MoodDriversCard.tsx`** (new) — two mini-sections:
   - "When you're low, these tend to help you bounce back" → top recoveryDrivers (max 3),
     e.g. "After a low day, logging **Walk** is followed by a **+1.8** lift on average
     (vs +0.2 without)."
   - "When you're steady, these tend to come before a dip" → top destabilizers (max 3),
     "**−1.2**" framing.
   - `InfoBubble` with honest method note: "Patterns from your own entries — associations,
     not causes. We compare what tends to happen the day AFTER, and only show patterns with
     enough data." Gentle empty/low-data state when no signal (use lowDayCount/steadyDayCount:
     "Keep logging through a few low and steady stretches and we'll surface what moves you").
   - Mount on the **Insights tab** (primary home; narrative fits) under the existing cards.
     Reuse the Insights `ACTIVITY_CORRELATION` fetch already in `insights.tsx` (it's already
     querying the raw rows) — feed the same `activityRawRows` into `buildMoodDrivers`.

2. **Insights "How you've been" card** — a moodState sentence near the top of `insights.tsx`.
   Fetch the all-time (or last-90d) daily averages (reuse `WEEKLY_MOOD_AVERAGES` raw query +
   `aggregateDailyAverages`) and render `moodState.label` + `description`. Gate on
   `state === 'classified'`.

3. **`StatSummaryCard.tsx` upgrade** — replace the single trend arrow chip with the 2-axis
   moodState: arrow (trend) + a small volatility tag + "~X.X pts/day swing" subtitle. Compute
   moodState from the window's daily averages the card already has access to (or add the
   `WEEKLY_MOOD_AVERAGES` fetch over the active timeframe). Keep it graceful in the 'building'
   state. Do not break StatSummaryCard's existing tests/props.

---

## Test + verify gate (run before reporting done)
- `npx jest moodState moodDrivers statSummary activityCorrelation` (new + touched).
- `npx tsc --noEmit` clean.
- `npx jest` full suite green (run ONCE at the end).
- Confirm the no-bucketing invariant test still passes (don't add date()/strftime to SQL).
- Report: files added/changed, test counts, any threshold you tuned, anything deferred.
```
