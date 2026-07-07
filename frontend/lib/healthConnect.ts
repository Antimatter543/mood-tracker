/**
 * lib/healthConnect.ts
 *
 * Typed data-access layer over Android Health Connect
 * (`react-native-health-connect`). PHASE 1 (foundation): read-only access to
 * Sleep Sessions + Heart Rate. No product UI, no persistence, no scheduling —
 * this module only wires the native module to the pure transforms in
 * `./healthConnectPure` so RN-0.85 native compatibility can be validated before
 * any feature is built on top.
 *
 * TWO hard rules, both load-bearing:
 *
 * 1. EVERYTHING is guarded by `Platform.OS === 'android'`. Health Connect is
 *    Android-only; on iOS / web every entry point returns a safe empty so the
 *    bundle is unaffected and nothing throws.
 *
 * 2. The native module is loaded LAZILY through `getHealthConnect()` — never a
 *    bare top-level `import ... from 'react-native-health-connect'`. Health
 *    Connect's TurboModule is absent from Expo Go (the on-device iteration
 *    loop); a top-level import would evaluate the module at bundle time and can
 *    throw during native-module resolution, which — if this file ever enters a
 *    route's import graph — white-screens the whole app on boot. This mirrors
 *    the already-guarded `lib/notifications.ts`. (If a future Expo-Go boot ever
 *    surfaces an unsuppressable error from the require below, add the same
 *    `Constants.executionEnvironment === StoreClient` pre-check notifications.ts
 *    uses; the try/catch handles the common case today.)
 *
 * All type imports are `import type` (erased), so they never pull the native
 * module in at runtime.
 */

import { Platform } from 'react-native';
import type { Permission } from 'react-native-health-connect';
import type * as HealthConnectModule from 'react-native-health-connect';
import type { HeartRateSampleAt } from './healthConnectPure';
import {
  averageBpm,
  hasRequiredReadAccess,
  sleepDurationMinutes,
  sleepStageMinutes,
  totalSleepMinutes,
} from './healthConnectPure';

// ─── Lazy native-module resolution ──────────────────────────────────────────

let cachedModule: typeof HealthConnectModule | null | undefined;
let warnedUnavailable = false;

/**
 * Lazily resolve the Health Connect native module. Returns `null` on any
 * non-Android platform or when the module is unavailable (e.g. Expo Go strips
 * it), so every caller degrades to a no-op/empty instead of throwing at import.
 * Resolved once and cached.
 */
function getHealthConnect(): typeof HealthConnectModule | null {
  if (Platform.OS !== 'android') return null;
  if (cachedModule !== undefined) return cachedModule;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, guarded native require (see module header)
    cachedModule = require('react-native-health-connect') as typeof HealthConnectModule;
  } catch {
    cachedModule = null;
  }

  if (!cachedModule && __DEV__ && !warnedUnavailable) {
    warnedUnavailable = true;
    console.warn(
      '[healthConnect] react-native-health-connect unavailable in this runtime — Health Connect features disabled'
    );
  }
  return cachedModule;
}

// ─── Public types ───────────────────────────────────────────────────────────

/** Normalized SDK-availability status (maps the library's numeric SdkAvailabilityStatus). */
export type HealthConnectStatus =
  | 'available'
  | 'update_required'
  | 'unavailable'
  | 'unsupported_platform';

/** Outcome of a permission request. */
export interface HealthConnectPermissionResult {
  /** True iff read access was granted for every required record type. */
  granted: boolean;
  /** The raw grants returned by Health Connect (access type + record type). */
  grantedPermissions: Array<{ accessType: string; recordType: string }>;
}

/** One sleep session, normalized. */
export interface SleepSessionSummary {
  startTime: string;
  endTime: string;
  durationMinutes: number;
  /** Minutes per numeric sleep-stage type (empty when the session has no stages). */
  stageMinutes: Record<number, number>;
}

/** Normalized Sleep + Heart Rate read over a time window. */
export interface HealthReadResult {
  /** ISO instant — inclusive start of the queried window. */
  windowStart: string;
  /** ISO instant — exclusive end of the queried window (now). */
  windowEnd: string;
  sleepSessions: SleepSessionSummary[];
  totalSleepMinutes: number;
  /** Mean bpm across all samples in the window, or `null` when there are none. */
  avgHeartRate: number | null;
  heartRateSampleCount: number;
}

/**
 * Raw-per-sample Sleep + Heart Rate over an explicit window. Unlike
 * {@link HealthReadResult} (which collapses heart rate to a single window
 * average), this preserves each timestamped heart-rate sample so the caller
 * can bucket by LOCAL day — the shape Phase 2a's per-day storage needs.
 */
export interface HealthRangeResult {
  /** ISO instant — inclusive start of the queried window. */
  windowStart: string;
  /** ISO instant — exclusive end of the queried window. */
  windowEnd: string;
  sleepSessions: SleepSessionSummary[];
  /** Every heart-rate sample in the window, flattened + timestamped. */
  heartRateSamples: HeartRateSampleAt[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** The read permissions this layer requests (Sleep + Heart Rate). */
const SLEEP_HEART_READ_PERMISSIONS: Permission[] = [
  { accessType: 'read', recordType: 'SleepSession' },
  { accessType: 'read', recordType: 'HeartRate' },
];

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Report whether the Health Connect SDK is available on this device.
 * Returns `'unsupported_platform'` off Android and `'unavailable'` when the
 * native module can't be reached.
 */
export async function getStatus(): Promise<HealthConnectStatus> {
  if (Platform.OS !== 'android') return 'unsupported_platform';
  const hc = getHealthConnect();
  if (!hc) return 'unavailable';

  try {
    const status = await hc.getSdkStatus();
    switch (status) {
      case hc.SdkAvailabilityStatus.SDK_AVAILABLE:
        return 'available';
      case hc.SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED:
        return 'update_required';
      default:
        return 'unavailable';
    }
  } catch {
    return 'unavailable';
  }
}

/**
 * Initialize the SDK and request read access to Sleep + Heart Rate.
 * No-op (returns `{ granted: false }`) off Android or when the module is absent.
 * Callers MUST only invoke this in response to a user gesture.
 */
export async function connect(): Promise<HealthConnectPermissionResult> {
  const empty: HealthConnectPermissionResult = {
    granted: false,
    grantedPermissions: [],
  };
  if (Platform.OS !== 'android') return empty;
  const hc = getHealthConnect();
  if (!hc) return empty;

  try {
    const initialized = await hc.initialize();
    if (!initialized) return empty;

    const granted = await hc.requestPermission(SLEEP_HEART_READ_PERMISSIONS);
    const grantedPermissions = granted.map((p) => ({
      accessType: p.accessType,
      recordType: p.recordType,
    }));
    return {
      granted: hasRequiredReadAccess(grantedPermissions),
      grantedPermissions,
    };
  } catch {
    return empty;
  }
}

/**
 * Read the raw Sleep + Heart Rate records over an explicit `[start, end]`
 * window with a single `between` filter. The one place `readRecords` is called,
 * so every read issues the identical query shape.
 */
async function readRawWindow(
  hc: NonNullable<ReturnType<typeof getHealthConnect>>,
  windowStart: string,
  windowEnd: string
) {
  const timeRangeFilter = {
    operator: 'between',
    startTime: windowStart,
    endTime: windowEnd,
  } as const;

  const [sleep, heart] = await Promise.all([
    hc.readRecords('SleepSession', { timeRangeFilter }),
    hc.readRecords('HeartRate', { timeRangeFilter }),
  ]);
  return { sleepRecords: sleep.records, heartRecords: heart.records };
}

/** The minimal sleep-record shape the summary mapping reads (library records are assignable). */
type RawSleepRecord = {
  startTime: string;
  endTime: string;
  stages?: { stage: number; startTime: string; endTime: string }[];
};

/** Normalize raw sleep-session records into the summary shape. */
function toSleepSummaries(
  records: ReadonlyArray<RawSleepRecord>
): SleepSessionSummary[] {
  return records.map((s) => ({
    startTime: s.startTime,
    endTime: s.endTime,
    durationMinutes: sleepDurationMinutes(s),
    stageMinutes: sleepStageMinutes(s),
  }));
}

/**
 * Read Sleep Sessions + Heart Rate over the last `sinceHours` and return a
 * normalized summary. Returns an empty summary (with the correct window) off
 * Android, when the module is absent, or on any read failure — never throws.
 */
export async function readSleepAndHeartRate(
  sinceHours = 24
): Promise<HealthReadResult> {
  const end = new Date();
  const start = new Date(end.getTime() - sinceHours * 60 * 60 * 1000);
  const windowStart = start.toISOString();
  const windowEnd = end.toISOString();

  const empty: HealthReadResult = {
    windowStart,
    windowEnd,
    sleepSessions: [],
    totalSleepMinutes: 0,
    avgHeartRate: null,
    heartRateSampleCount: 0,
  };

  if (Platform.OS !== 'android') return empty;
  const hc = getHealthConnect();
  if (!hc) return empty;

  try {
    const { sleepRecords, heartRecords } = await readRawWindow(
      hc,
      windowStart,
      windowEnd
    );

    const heartRateSampleCount = heartRecords.reduce(
      (n, r) => n + (r.samples?.length ?? 0),
      0
    );

    return {
      windowStart,
      windowEnd,
      sleepSessions: toSleepSummaries(sleepRecords),
      totalSleepMinutes: totalSleepMinutes(sleepRecords),
      avgHeartRate: averageBpm(heartRecords),
      heartRateSampleCount,
    };
  } catch {
    return empty;
  }
}

/**
 * Read Sleep + timestamped Heart-Rate samples over an explicit `[startISO,
 * endISO]` window. Unlike {@link readSleepAndHeartRate} this keeps every
 * heart-rate sample (with its instant) so the caller can bucket by local day.
 * Returns an empty result (with the requested window) off Android, when the
 * module is absent, or on any read failure — never throws.
 */
export async function readHealthForRange(
  startISO: string,
  endISO: string
): Promise<HealthRangeResult> {
  const empty: HealthRangeResult = {
    windowStart: startISO,
    windowEnd: endISO,
    sleepSessions: [],
    heartRateSamples: [],
  };

  if (Platform.OS !== 'android') return empty;
  const hc = getHealthConnect();
  if (!hc) return empty;

  try {
    const { sleepRecords, heartRecords } = await readRawWindow(
      hc,
      startISO,
      endISO
    );

    const heartRateSamples: HeartRateSampleAt[] = [];
    for (const record of heartRecords) {
      for (const sample of record.samples ?? []) {
        heartRateSamples.push({
          time: sample.time,
          beatsPerMinute: sample.beatsPerMinute,
        });
      }
    }

    return {
      windowStart: startISO,
      windowEnd: endISO,
      sleepSessions: toSleepSummaries(sleepRecords),
      heartRateSamples,
    };
  } catch {
    return empty;
  }
}

/**
 * Whether the app currently holds the required Sleep + Heart Rate READ grants —
 * checked WITHOUT prompting (uses `getGrantedPermissions`, not
 * `requestPermission`). Lets the UI show a "connected" state on mount without
 * throwing a permission dialog. `false` off Android / when the module is absent
 * / on any failure.
 */
export async function hasReadPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const hc = getHealthConnect();
  if (!hc) return false;

  try {
    const initialized = await hc.initialize();
    if (!initialized) return false;
    const granted = await hc.getGrantedPermissions();
    return hasRequiredReadAccess(
      granted.map((p) => ({
        // Special grants (background/exercise-route) lack these fields; they
        // become undefined and are harmlessly filtered out by the read check.
        accessType: (p as Permission).accessType,
        recordType: (p as Permission).recordType,
      }))
    );
  } catch {
    return false;
  }
}

/**
 * Revoke ALL of this app's Health Connect grants — an honest disconnect.
 * No-op (returns `false`) off Android or when the module is absent. On Android
 * 14+ the OS applies the revocation on next app restart.
 */
export async function disconnect(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const hc = getHealthConnect();
  if (!hc) return false;

  try {
    await hc.initialize();
    await hc.revokeAllPermissions();
    return true;
  } catch {
    return false;
  }
}

/**
 * Open the system Health Connect settings screen (to install/update the
 * provider or manage permissions). No-op off Android / when the module is
 * absent.
 */
export function openHealthConnectSettings(): void {
  if (Platform.OS !== 'android') return;
  const hc = getHealthConnect();
  if (!hc) return;
  try {
    hc.openHealthConnectSettings();
  } catch {
    // best-effort — nothing to recover if the settings intent can't launch.
  }
}
