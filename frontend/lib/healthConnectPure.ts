/**
 * lib/healthConnectPure.ts
 *
 * PURE, native-free transforms for the Health Connect data layer.
 *
 * These functions hold the only real *logic* in the Health Connect integration
 * (averaging, duration math, stage/permission rollups). They are split out from
 * `lib/healthConnect.ts` — which touches the Android-only native module
 * `react-native-health-connect` — so they can be exhaustively unit-tested
 * WITHOUT importing or mocking that native module.
 *
 * The ONLY runtime import is the app's pure, native-free date helpers
 * (`localDateString` / `startOfLocalDay`) — the single day-keying authority
 * shared with the mood layer, so Health Connect days bucket EXACTLY the way
 * mood entries do (see databases/dateHelpers.ts). Everything else is
 * `import type` (erased at compile time), so this module never pulls the native
 * TurboModule into the bundle and loads instantly under jest on any platform.
 *
 * PHASE 1 (foundation) scope: Sleep + Heart Rate reads (averaging, duration,
 * stage/permission rollups). PHASE 2a adds per-LOCAL-DAY aggregation
 * (`aggregateHealthByDay`) + the incremental sync window (`computeSyncWindow`) —
 * still pure, so the native wiring in `lib/healthConnect.ts` and the sync
 * orchestrator in `lib/healthSync.ts` stay thin, testable shells over tested
 * logic.
 */

import type { SleepSessionRecord } from 'react-native-health-connect';
import { localDateString, startOfLocalDay } from '@/databases/dateHelpers';

/** The minimal heart-rate sample shape averageBpm needs (library HeartRateSample is assignable). */
type BpmSample = { beatsPerMinute: number };
/** Anything carrying beats-per-minute samples (a HeartRate record or read-result). */
type BpmSamplesBearer = { samples: ReadonlyArray<BpmSample> };
/** Anything carrying a start/end instant (a SleepSession, sleep stage, or read-result). */
type TimeInterval = { startTime: string; endTime: string };
/** Anything that may carry sleep stages (a SleepSession record or read-result). */
type SleepStagesBearer = Pick<SleepSessionRecord, 'stages'>;

const MS_PER_MINUTE = 60_000;

/**
 * Read-record types the mood layer REQUIRES from Health Connect — the app's
 * "connected" state gates on read access to every one of these.
 */
export const REQUIRED_READ_RECORD_TYPES = [
  'SleepSession',
  'HeartRate',
] as const;

/**
 * OPTIONAL read-record types — requested alongside the required ones, but NOT
 * gated on. Neither HRV nor a dedicated RestingHeartRate reading is emitted by
 * every source (many phones/wearables record neither; some sources — e.g.
 * Fitbit — write a daily RestingHeartRate record but NO intraday HeartRate), so
 * a device that grants only Sleep + Heart Rate is still fully "connected"; the
 * optional analytics simply stay empty until data appears. `connect()`'s
 * `granted` boolean therefore checks {@link REQUIRED_READ_RECORD_TYPES} only.
 */
export const OPTIONAL_READ_RECORD_TYPES = [
  'HeartRateVariabilityRmssd',
  'RestingHeartRate',
] as const;

/**
 * The finite beats-per-minute values from a flat sample list. Non-finite
 * samples (NaN / Infinity / non-number) are dropped — the single place the
 * "skip garbage samples" rule lives, shared by {@link averageBpm} and
 * {@link minBpm}.
 */
function finiteBpm(samples: ReadonlyArray<BpmSample>): number[] {
  const out: number[] = [];
  for (const sample of samples) {
    const bpm = sample.beatsPerMinute;
    if (typeof bpm === 'number' && Number.isFinite(bpm)) out.push(bpm);
  }
  return out;
}

/**
 * Mean beats-per-minute across every sample of every record.
 *
 * Returns `null` when there are no (finite) samples — an empty or absent
 * dataset must read as "no data", never as 0 bpm. Non-finite samples (NaN /
 * Infinity) are skipped rather than poisoning the mean.
 */
export function averageBpm(
  records: ReadonlyArray<BpmSamplesBearer>
): number | null {
  const bpms: number[] = [];
  for (const record of records) bpms.push(...finiteBpm(record.samples ?? []));
  return bpms.length === 0
    ? null
    : bpms.reduce((sum, bpm) => sum + bpm, 0) / bpms.length;
}

/**
 * Minimum beats-per-minute across a flat sample list — the day's lowest heart
 * rate, a reasonable proxy for resting heart rate when no dedicated
 * `RestingHeartRate` record is available. Returns `null` when there are no
 * finite samples (never 0).
 */
export function minBpm(samples: ReadonlyArray<BpmSample>): number | null {
  const bpms = finiteBpm(samples);
  return bpms.length === 0 ? null : Math.min(...bpms);
}

/**
 * The finite HRV-in-millis values from a flat sample list. Mirrors
 * {@link finiteBpm} — non-finite / non-number values are dropped so a garbage
 * reading never poisons the day's mean.
 */
function finiteHrv(samples: ReadonlyArray<{ hrvMillis: number }>): number[] {
  const out: number[] = [];
  for (const sample of samples) {
    const ms = sample.hrvMillis;
    if (typeof ms === 'number' && Number.isFinite(ms)) out.push(ms);
  }
  return out;
}

/**
 * Mean heart-rate-variability (RMSSD, milliseconds) across a flat sample list.
 * Returns `null` when there are no finite samples — an absent HRV source must
 * read as "no data", never 0. Mirrors {@link averageBpm} for the HR side.
 */
export function averageHrv(
  samples: ReadonlyArray<{ hrvMillis: number }>
): number | null {
  const values = finiteHrv(samples);
  return values.length === 0
    ? null
    : values.reduce((sum, ms) => sum + ms, 0) / values.length;
}

/**
 * Duration of a time interval in minutes (endTime − startTime).
 *
 * Returns 0 for malformed intervals (unparseable dates, or end ≤ start) so a
 * bad record can never yield a negative or NaN duration downstream.
 */
export function durationMinutes(interval: TimeInterval): number {
  const start = Date.parse(interval.startTime);
  const end = Date.parse(interval.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const minutes = (end - start) / MS_PER_MINUTE;
  return minutes > 0 ? minutes : 0;
}

/** Duration of a single sleep session in minutes. Alias of {@link durationMinutes}. */
export const sleepDurationMinutes = durationMinutes;

/** Total sleep minutes across a set of sessions. */
export function totalSleepMinutes(
  sessions: ReadonlyArray<TimeInterval>
): number {
  return sessions.reduce((sum, s) => sum + durationMinutes(s), 0);
}

/**
 * Trivial stage rollup: minutes spent in each sleep-stage type, keyed by the
 * numeric `SleepStageType` (see the library's constants — 4=LIGHT, 5=DEEP,
 * 6=REM, etc.). Sessions with no `stages` array yield an empty map; zero/negative
 * stage intervals are ignored.
 */
export function sleepStageMinutes(
  session: SleepStagesBearer
): Record<number, number> {
  const rollup: Record<number, number> = {};
  for (const stage of session.stages ?? []) {
    const minutes = durationMinutes(stage);
    if (minutes <= 0) continue;
    rollup[stage.stage] = (rollup[stage.stage] ?? 0) + minutes;
  }
  return rollup;
}

/**
 * True iff `granted` contains a `read` grant for every required record type.
 * Used by `connect()` to decide whether a permission request actually yielded
 * the access the app needs. Typed structurally (not against `Permission`) so it
 * accepts the mixed permission union the native `requestPermission` returns.
 */
export function hasRequiredReadAccess(
  granted: ReadonlyArray<{ accessType: string; recordType: string }>
): boolean {
  const readTypes = new Set(
    granted.filter((p) => p.accessType === 'read').map((p) => p.recordType)
  );
  return REQUIRED_READ_RECORD_TYPES.every((t) => readTypes.has(t));
}

// ─── PHASE 2a: per-local-day aggregation ─────────────────────────────────────

/** A single heart-rate sample carrying its own instant (library HeartRateSample). */
export interface HeartRateSampleAt {
  /** ISO instant of the sample. */
  time: string;
  beatsPerMinute: number;
}

/**
 * A single HRV (RMSSD) reading carrying its own instant — the flattened shape of
 * a library `HeartRateVariabilityRmssdRecord` (an InstantaneousRecord: `time` +
 * `heartRateVariabilityMillis`, flattened here to `hrvMillis`).
 */
export interface HrvSampleAt {
  /** ISO instant of the reading. */
  time: string;
  /** RMSSD in milliseconds. */
  hrvMillis: number;
}

/**
 * A single dedicated RestingHeartRate reading carrying its own instant — the
 * flattened shape of a library `RestingHeartRateRecord` (an InstantaneousRecord:
 * `time` + `beatsPerMinute`). Distinct from the per-second `HeartRate` samples:
 * this is the ONE resting-HR value a source (e.g. Fitbit) writes ~1/day, and it
 * is the REAL resting heart rate — not the intraday-minimum proxy.
 */
export interface RestingHrSampleAt {
  /** ISO instant of the reading. */
  time: string;
  beatsPerMinute: number;
}

/**
 * The minimal per-session sleep shape day-aggregation needs. The native layer's
 * `SleepSessionSummary` is structurally assignable, so this module stays
 * independent of `lib/healthConnect.ts` (no import cycle).
 */
export interface DailySleepInput {
  /** Wake instant — determines which LOCAL calendar day the night is attributed to. */
  endTime: string;
  durationMinutes: number;
  stageMinutes: Record<number, number>;
}

/** One local calendar day's rolled-up health metrics (the row shape we persist). */
export interface DailyHealthMetrics {
  /** Local calendar day `YYYY-MM-DD` — JOINs cleanly to day-keyed mood entries. */
  date: string;
  /** Total sleep minutes attributed to this day, or `null` when there was no sleep. */
  sleepTotalMinutes: number | null;
  /** Minutes per numeric sleep-stage type (empty when no staged sleep). */
  sleepStages: Record<number, number>;
  /** Mean bpm across the day's samples, or `null` when there were none. */
  avgHeartRate: number | null;
  /** Lowest bpm across the day's samples (resting-HR proxy), or `null`. */
  minHeartRate: number | null;
  /**
   * Mean of the dedicated RestingHeartRate readings that day (Fitbit et al. write
   * ~1/day), or `null` when none. Distinct from `minHeartRate` — the intraday-min
   * proxy. This is the REAL resting heart rate and is preferred over the proxy
   * wherever a resting-HR value is shown.
   */
  restingHeartRate: number | null;
  /** Mean HRV (RMSSD, ms) across the day's samples, or `null` when there were none. */
  avgHrvMillis: number | null;
}

/**
 * Which LOCAL calendar day a sleep session belongs to.
 *
 * Attributed to the day you WAKE (the session's `endTime` in local time) — a
 * night that starts 22:00 Mon and ends 06:00 Tue is "Tuesday's sleep", which is
 * the pairing users expect when asking "did last night's sleep affect how I
 * feel today". This is the ONE place that convention lives, so the insights
 * phase inherits it for free.
 */
export function sleepSessionWakeDay(session: { endTime: string }): string {
  return localDateString(session.endTime);
}

interface DayAccumulator {
  hasSleep: boolean;
  sleepTotalMinutes: number;
  sleepStages: Record<number, number>;
  heartSamples: BpmSample[];
  restingHrSamples: BpmSample[];
  hrvSamples: { hrvMillis: number }[];
}

/**
 * Roll sleep sessions + heart-rate samples up into one {@link DailyHealthMetrics}
 * row per LOCAL calendar day. Pure.
 *
 * - Sleep is keyed by wake-day ({@link sleepSessionWakeDay}); its stage maps are
 *   summed. A day with any sleep session gets a numeric `sleepTotalMinutes`; a
 *   day with none gets `null`.
 * - Heart-rate samples are keyed by each sample's own local day; `avgHeartRate`
 *   / `minHeartRate` are computed via the shared bpm helpers (finite-only). A
 *   day with no samples gets `null` for both.
 * - Dedicated RestingHeartRate readings are keyed by their own local day;
 *   `restingHeartRate` is the finite mean of that day's readings (sources like
 *   Fitbit write ~1/day), `null` when the day had none. Distinct from — and
 *   independent of — `minHeartRate`, the intraday-min proxy.
 * - HRV (RMSSD) samples are keyed by their own local day; `avgHrvMillis` is the
 *   finite mean, `null` when the day had no HRV reading (HRV is optional — many
 *   sources never emit it, so most days will be `null` here).
 * - Days present in ANY source appear in the output. Rows are sorted by date
 *   ascending, so an upsert writes them in calendar order.
 */
export function aggregateHealthByDay(input: {
  sleepSessions: ReadonlyArray<DailySleepInput>;
  heartRateSamples: ReadonlyArray<HeartRateSampleAt>;
  restingHrSamples?: ReadonlyArray<RestingHrSampleAt>;
  hrvSamples?: ReadonlyArray<HrvSampleAt>;
}): DailyHealthMetrics[] {
  const byDay = new Map<string, DayAccumulator>();

  const dayOf = (key: string): DayAccumulator => {
    let acc = byDay.get(key);
    if (!acc) {
      acc = {
        hasSleep: false,
        sleepTotalMinutes: 0,
        sleepStages: {},
        heartSamples: [],
        restingHrSamples: [],
        hrvSamples: [],
      };
      byDay.set(key, acc);
    }
    return acc;
  };

  for (const session of input.sleepSessions) {
    const acc = dayOf(sleepSessionWakeDay(session));
    acc.hasSleep = true;
    acc.sleepTotalMinutes += session.durationMinutes;
    for (const [stage, minutes] of Object.entries(session.stageMinutes)) {
      const n = Number(stage);
      acc.sleepStages[n] = (acc.sleepStages[n] ?? 0) + minutes;
    }
  }

  for (const sample of input.heartRateSamples) {
    // Key by the sample's own local day. Skip unparseable timestamps rather
    // than throwing (localDateString throws on invalid dates).
    if (Number.isNaN(Date.parse(sample.time))) continue;
    dayOf(localDateString(sample.time)).heartSamples.push(sample);
  }

  for (const sample of input.restingHrSamples ?? []) {
    // Same guard as the intraday HR samples — the { beatsPerMinute } shape is
    // exactly what averageBpm consumes, so it accumulates into its own bucket.
    if (Number.isNaN(Date.parse(sample.time))) continue;
    dayOf(localDateString(sample.time)).restingHrSamples.push(sample);
  }

  for (const sample of input.hrvSamples ?? []) {
    if (Number.isNaN(Date.parse(sample.time))) continue;
    dayOf(localDateString(sample.time)).hrvSamples.push(sample);
  }

  return [...byDay.entries()]
    .map(([date, acc]) => ({
      date,
      sleepTotalMinutes: acc.hasSleep ? acc.sleepTotalMinutes : null,
      sleepStages: acc.sleepStages,
      avgHeartRate: averageBpm([{ samples: acc.heartSamples }]),
      minHeartRate: minBpm(acc.heartSamples),
      restingHeartRate: averageBpm([{ samples: acc.restingHrSamples }]),
      avgHrvMillis: averageHrv(acc.hrvSamples),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** An inclusive-start / exclusive-end read window, as ISO instants. */
export interface SyncWindow {
  startISO: string;
  endISO: string;
}

/**
 * Compute the read window for a sync. Pure.
 *
 * - First sync (no valid `lastSyncedAtISO`): the full `windowDays` lookback.
 * - Incremental: re-read from the START of the last-synced LOCAL day (that day
 *   may have been partial when last synced, and late-arriving samples land
 *   retroactively), clamped so it never reaches further back than the full
 *   lookback and never past `now` (guards clock skew / a future stored value).
 *
 * `endISO` is always `now`.
 */
export function computeSyncWindow(
  lastSyncedAtISO: string | null | undefined,
  now: Date,
  windowDays: number
): SyncWindow {
  const endISO = now.toISOString();
  const fullStartMs = now.getTime() - windowDays * 24 * 60 * 60 * 1000;

  let startMs = fullStartMs;
  if (lastSyncedAtISO) {
    const lastMs = Date.parse(lastSyncedAtISO);
    if (Number.isFinite(lastMs) && lastMs <= now.getTime()) {
      const incrementalMs = Date.parse(startOfLocalDay(new Date(lastMs)));
      // Never earlier than the full lookback; never later than now.
      startMs = Math.min(Math.max(incrementalMs, fullStartMs), now.getTime());
    }
  }

  return { startISO: new Date(startMs).toISOString(), endISO };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Inputs for {@link resolveSyncWindow} — all pure, all provided by the caller. */
export interface ResolveSyncWindowOptions {
  /** Earliest mood-entry instant (raw UTC ISO), or `null` for an empty DB. */
  earliestMoodInstant: string | null;
  /** Last successful sync marker (ISO), or `null`/'' when never synced. */
  lastSyncedAtISO: string | null;
  /** Earliest LOCAL day (`YYYY-MM-DD`) already stored in health_metrics, or `null`. */
  earliestStoredHealthDate: string | null;
  now: Date;
  /** Hard cap on how far back a backfill may reach (days). */
  maxBackfillDays: number;
  /** Fallback lookback when there is no mood history to anchor to (days). */
  initialWindowDays: number;
}

/** A resolved read window plus whether it's a (chunked) historical backfill. */
export interface ResolvedSyncWindow extends SyncWindow {
  /** True when this window is a one-time historical backfill (drive it chunked). */
  isBackfill: boolean;
}

/**
 * Decide the Health Connect read window for a sync, choosing between a one-time
 * historical BACKFILL and a small INCREMENTAL read. Pure.
 *
 * The problem it solves: the first sync used to read only a fixed 30 days back,
 * so a user with months/years of Health Connect history AND older mood history
 * only ever got 30 days paired — the (health-day ∩ mood-day) count could stay
 * below the insight threshold forever ("keep logging"). This reaches back to the
 * earliest mood day (capped) so the full overlap is pulled.
 *
 * - `desiredBackfillStart` = the earliest mood day (local midnight), floored at
 *   `now − maxBackfillDays`; or, with no mood history, `now − initialWindowDays`.
 * - `needBackfill` when stored health coverage doesn't yet reach that desired
 *   start (nothing stored, or the earliest stored day is later than desired).
 *   → read `[desiredBackfillStart, now]` as a backfill.
 * - Otherwise steady-state: an INCREMENTAL read from the start of the last-synced
 *   local day ({@link computeSyncWindow}), clamped so it never reaches earlier
 *   than the desired start nor later than `now`.
 *
 * Guarantees: `startISO ≤ endISO` always; the window never reaches earlier than
 * `now − maxBackfillDays`; future/garbage `lastSyncedAtISO` can't push the start
 * past `now`.
 *
 * NOTE (known, bounded limitation): coverage is judged by the earliest STORED
 * health day, not the earliest day we've READ. If a user's mood history predates
 * their available Health Connect data (no HC data exists that far back), the
 * earliest stored day can never reach `desiredBackfillStart`, so each sync
 * re-runs the (idempotent) backfill instead of going incremental. This is
 * wasteful-but-correct and, since sync is user-triggered (connect / manual
 * refresh, not every app-open), acceptable; a future `backfilled-through` marker
 * would make it strictly one-time.
 */
export function resolveSyncWindow(
  opts: ResolveSyncWindowOptions
): ResolvedSyncWindow {
  const {
    earliestMoodInstant,
    lastSyncedAtISO,
    earliestStoredHealthDate,
    now,
    maxBackfillDays,
    initialWindowDays,
  } = opts;

  const nowMs = now.getTime();
  const endISO = now.toISOString();
  const backfillFloorMs = nowMs - maxBackfillDays * MS_PER_DAY;

  // The day we'd LIKE the backfill to reach: the earliest mood day (local
  // midnight), never earlier than the hard cap; or the initial-window fallback
  // when there is no mood history to anchor to.
  const moodMs = earliestMoodInstant ? Date.parse(earliestMoodInstant) : NaN;
  let desiredStartMs: number;
  if (Number.isFinite(moodMs)) {
    const moodDayStartMs = Date.parse(startOfLocalDay(new Date(moodMs)));
    desiredStartMs = Math.max(moodDayStartMs, backfillFloorMs);
  } else {
    desiredStartMs = nowMs - initialWindowDays * MS_PER_DAY;
  }
  // Never past now (guards a pathological config where initialWindowDays ≤ 0).
  desiredStartMs = Math.min(desiredStartMs, nowMs);
  const desiredStartDay = localDateString(new Date(desiredStartMs));

  // Backfill when stored coverage doesn't reach the desired start.
  const needBackfill =
    earliestStoredHealthDate == null ||
    earliestStoredHealthDate > desiredStartDay;

  if (needBackfill) {
    return {
      startISO: new Date(desiredStartMs).toISOString(),
      endISO,
      isBackfill: true,
    };
  }

  // Steady state: small incremental read from the last-synced local day, but
  // never earlier than the desired start and never later than now.
  const incremental = computeSyncWindow(lastSyncedAtISO, now, maxBackfillDays);
  let startMs = Date.parse(incremental.startISO);
  startMs = Math.min(Math.max(startMs, desiredStartMs), nowMs);

  return { startISO: new Date(startMs).toISOString(), endISO, isBackfill: false };
}

/**
 * Split an inclusive-start / exclusive-end window into consecutive sub-windows
 * of at most `chunkDays` each, so a large backfill can be read + upserted one
 * chunk at a time (bounding peak memory). Pure.
 *
 * Interior boundaries are SNAPPED to a local-day start so no calendar day ever
 * straddles two chunks — otherwise a night's sleep (attributed to its wake day)
 * or a day's HR samples could be split across chunks and the second chunk's
 * per-day upsert would overwrite the first with a partial day. Contiguous:
 * chunk N's `endISO` is exactly chunk N+1's `startISO`. Returns `[]` for an empty
 * or inverted window (start ≥ end) or a non-positive `chunkDays`.
 */
export function splitWindow(
  startISO: string,
  endISO: string,
  chunkDays: number
): SyncWindow[] {
  const startMs = Date.parse(startISO);
  const endMs = Date.parse(endISO);
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs >= endMs ||
    chunkDays <= 0
  ) {
    return [];
  }

  const chunkMs = chunkDays * MS_PER_DAY;
  const windows: SyncWindow[] = [];
  let cursorMs = startMs;

  while (cursorMs < endMs) {
    let nextMs = cursorMs + chunkMs;
    if (nextMs >= endMs) {
      nextMs = endMs;
    } else {
      // Snap the interior boundary down to a local-day start (keeps each chunk
      // ≤ chunkDays and day-aligned). Guard against a non-advancing snap.
      const snapped = Date.parse(startOfLocalDay(new Date(nextMs)));
      nextMs = snapped > cursorMs ? snapped : cursorMs + chunkMs;
      if (nextMs >= endMs) nextMs = endMs;
    }
    windows.push({
      startISO: new Date(cursorMs).toISOString(),
      endISO: new Date(nextMs).toISOString(),
    });
    cursorMs = nextMs;
  }

  return windows;
}
