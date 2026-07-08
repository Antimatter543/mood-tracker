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

/** Read-record types the mood layer requests from Health Connect (Phase 1). */
export const REQUIRED_READ_RECORD_TYPES = [
  'SleepSession',
  'HeartRate',
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
 * - Days present in EITHER source appear in the output. Rows are sorted by date
 *   ascending, so an upsert writes them in calendar order.
 */
export function aggregateHealthByDay(input: {
  sleepSessions: ReadonlyArray<DailySleepInput>;
  heartRateSamples: ReadonlyArray<HeartRateSampleAt>;
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

  return [...byDay.entries()]
    .map(([date, acc]) => ({
      date,
      sleepTotalMinutes: acc.hasSleep ? acc.sleepTotalMinutes : null,
      sleepStages: acc.sleepStages,
      avgHeartRate: averageBpm([{ samples: acc.heartSamples }]),
      minHeartRate: minBpm(acc.heartSamples),
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
