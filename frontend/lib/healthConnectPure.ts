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
 * Every import here is `import type` (erased at compile time), so this module
 * has ZERO runtime dependencies: it loads instantly under jest on any platform,
 * and importing it never pulls the native TurboModule into the bundle.
 *
 * PHASE 1 (foundation) scope: only Sleep + Heart Rate reads. No product UI,
 * no persistence — these helpers exist so the native wiring in
 * `lib/healthConnect.ts` is a thin, testable shell over tested logic.
 */

import type { SleepSessionRecord } from 'react-native-health-connect';

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
 * Mean beats-per-minute across every sample of every record.
 *
 * Returns `null` when there are no (finite) samples — an empty or absent
 * dataset must read as "no data", never as 0 bpm. Non-finite samples (NaN /
 * Infinity) are skipped rather than poisoning the mean.
 */
export function averageBpm(
  records: ReadonlyArray<BpmSamplesBearer>
): number | null {
  let sum = 0;
  let count = 0;
  for (const record of records) {
    for (const sample of record.samples ?? []) {
      const bpm = sample.beatsPerMinute;
      if (typeof bpm === 'number' && Number.isFinite(bpm)) {
        sum += bpm;
        count += 1;
      }
    }
  }
  return count === 0 ? null : sum / count;
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
