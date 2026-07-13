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
import type {
  Permission,
  ReadRecordsOptions,
  RecordResult,
  RecordType,
} from 'react-native-health-connect';
import type * as HealthConnectModule from 'react-native-health-connect';
import type {
  HeartRateSampleAt,
  HrvSampleAt,
  RestingHrSampleAt,
} from './healthConnectPure';
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

/**
 * Resolve `promise`, or reject after `ms`. Used to cap Health Connect's
 * `requestPermission`, whose returned promise can hang FOREVER on Android 16 when
 * the permission is in the `never_ask_again`/blocked state (an upstream RN issue,
 * react-native#53887). A hung promise would freeze the "Connect" spinner
 * indefinitely; the timeout lets us fall through to reading the ACTUAL granted
 * permissions instead. The timer is always cleared so it can't leak or fire late.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('health-connect: request timed out')),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** Max wait for the Health Connect permission prompt before we stop blocking on it. */
const PERMISSION_PROMPT_TIMEOUT_MS = 90_000;

// ─── Public types ───────────────────────────────────────────────────────────

/**
 * Normalized SDK-availability status (maps the library's numeric
 * `SdkAvailabilityStatus`). The two "not ready" states are DISTINCT and must not
 * be conflated — getting this wrong is what showed a fresh device an "update"
 * prompt when it had nothing to update:
 *
 *  - `'provider_required'` ← `SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED`: the
 *    device CAN run Health Connect, but the Health Connect provider app is
 *    **not installed OR is too old** — the actionable "send the user to the Play
 *    listing" case. Android reports this SAME value whether the provider is
 *    missing or merely outdated; `getSdkStatus` gives us no signal to tell
 *    install from update apart (the Play listing itself renders the right
 *    button), so the UI offers a single install-or-update action. This is the
 *    status a freshly-set-up device with no Health Connect reports.
 *  - `'unavailable'` ← `SDK_UNAVAILABLE`: Health Connect fundamentally cannot run
 *    on this device (Android too old), or the native module is absent. Installing
 *    the provider would NOT help — there is no useful action to offer.
 */
export type HealthConnectStatus =
  | 'available'
  | 'provider_required'
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
  /** Every dedicated RestingHeartRate reading in the window, flattened + timestamped (may be empty). */
  restingHrSamples: RestingHrSampleAt[];
  /** Every HRV (RMSSD) reading in the window, flattened + timestamped (may be empty). */
  hrvSamples: HrvSampleAt[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** The REQUIRED read permissions (Sleep + Heart Rate) — the "connected" gate. */
const SLEEP_HEART_READ_PERMISSIONS: Permission[] = [
  { accessType: 'read', recordType: 'SleepSession' },
  { accessType: 'read', recordType: 'HeartRate' },
];

/**
 * OPTIONAL read permissions — requested alongside the required ones but NOT
 * gated on. Neither HRV nor a dedicated RestingHeartRate reading is emitted by
 * every source (Fitbit, notably, writes a daily RestingHeartRate record but no
 * intraday HeartRate), so a device that grants only Sleep + Heart Rate is still
 * fully connected. MUST stay in sync with the manifest permissions declared in
 * plugins/withHealthConnect.js — see healthPermissionInvariant.test.ts.
 */
const OPTIONAL_READ_PERMISSIONS: Permission[] = [
  { accessType: 'read', recordType: 'HeartRateVariabilityRmssd' },
  { accessType: 'read', recordType: 'RestingHeartRate' },
];

/** All read permissions requested at connect time (required + optional). */
const ALL_READ_PERMISSIONS: Permission[] = [
  ...SLEEP_HEART_READ_PERMISSIONS,
  ...OPTIONAL_READ_PERMISSIONS,
];

/**
 * Max records per Health Connect page. 5000 is Health Connect's per-read ceiling;
 * we page through with `pageToken` until exhausted so a large backfill window
 * (a year of per-second heart rate) is never silently truncated to one page.
 */
const READ_PAGE_SIZE = 5000;

/**
 * Hard cap on pages per record type per read — a safety valve so a provider that
 * kept returning a non-empty `pageToken` can never spin forever. 5000 pages ×
 * 5000 records ≫ any realistic window.
 */
const MAX_PAGES = 5000;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Report whether the Health Connect SDK is available on this device.
 * Returns `'unsupported_platform'` off Android and `'unavailable'` when the
 * native module can't be reached. See {@link HealthConnectStatus} for why
 * `SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED` maps to `'provider_required'`
 * (install-or-update) and `SDK_UNAVAILABLE` maps to `'unavailable'`.
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
        // Provider not installed OR outdated — the actionable "get it from Play"
        // case. This is what a device with no Health Connect app reports.
        return 'provider_required';
      default:
        // SDK_UNAVAILABLE — the device can't run Health Connect at all.
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

    // Open the system permission prompt, but don't block on it forever: on
    // Android 16 the returned promise can hang in the never_ask_again state
    // (react-native#53887). Whether it resolves, times out, or throws, we read
    // the ACTUAL grants afterwards as the source of truth — so a hung prompt
    // never freezes the caller's spinner, and a grant the user DID make is still
    // detected. (This also makes the happy path robust: getGrantedPermissions
    // reflects the real state regardless of what requestPermission returned.)
    try {
      await withTimeout(
        hc.requestPermission(ALL_READ_PERMISSIONS),
        PERMISSION_PROMPT_TIMEOUT_MS
      );
    } catch {
      // timeout or prompt error — fall through to the real grant check below.
    }

    const grantedPermissions = (await hc.getGrantedPermissions()).map((p) => ({
      accessType: (p as Permission).accessType,
      recordType: (p as Permission).recordType,
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
 * Read EVERY record of `recordType` in the window, paging through Health
 * Connect's `pageToken` until exhausted. `readRecords` returns at most
 * `pageSize` records plus a continuation `pageToken`; without this loop a window
 * larger than one page is silently truncated (the bug a full-year backfill hits).
 * The one place `readRecords` is called, so every read issues the identical query
 * shape.
 */
async function readAllPages<T extends RecordType>(
  hc: NonNullable<ReturnType<typeof getHealthConnect>>,
  recordType: T,
  timeRangeFilter: { operator: 'between'; startTime: string; endTime: string }
): Promise<RecordResult<T>[]> {
  const all: RecordResult<T>[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const options: ReadRecordsOptions = {
      timeRangeFilter,
      pageSize: READ_PAGE_SIZE,
      ...(pageToken ? { pageToken } : {}),
    };
    const result = await hc.readRecords(recordType, options);
    all.push(...result.records);
    if (!result.pageToken) break;
    pageToken = result.pageToken;
  }

  return all;
}

/**
 * Read the raw Sleep + Heart Rate + RestingHeartRate + HRV records over an
 * explicit `[start, end]` window with a single `between` filter, fully
 * paginated. RestingHeartRate + HRV are read too (both optional; each array is
 * simply empty when the source has none). RestingHeartRate is ~1 record/day so
 * pagination is trivially cheap.
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

  const [sleepRecords, heartRecords, restingHrRecords, hrvRecords] =
    await Promise.all([
      readAllPages(hc, 'SleepSession', timeRangeFilter),
      readAllPages(hc, 'HeartRate', timeRangeFilter),
      readAllPages(hc, 'RestingHeartRate', timeRangeFilter),
      readAllPages(hc, 'HeartRateVariabilityRmssd', timeRangeFilter),
    ]);
  return { sleepRecords, heartRecords, restingHrRecords, hrvRecords };
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
    restingHrSamples: [],
    hrvSamples: [],
  };

  if (Platform.OS !== 'android') return empty;
  const hc = getHealthConnect();
  if (!hc) return empty;

  try {
    const { sleepRecords, heartRecords, restingHrRecords, hrvRecords } =
      await readRawWindow(hc, startISO, endISO);

    const heartRateSamples: HeartRateSampleAt[] = [];
    for (const record of heartRecords) {
      for (const sample of record.samples ?? []) {
        heartRateSamples.push({
          time: sample.time,
          beatsPerMinute: sample.beatsPerMinute,
        });
      }
    }

    // RestingHeartRate is an InstantaneousRecord: one `time` + `beatsPerMinute`
    // per record (no nested samples — unlike HeartRate). This is the dedicated
    // daily resting-HR reading Fitbit et al. write. Flatten to the pure layer's
    // `{ time, beatsPerMinute }` shape.
    const restingHrSamples: RestingHrSampleAt[] = restingHrRecords.map(
      (record) => ({
        time: record.time,
        beatsPerMinute: record.beatsPerMinute,
      })
    );

    // HeartRateVariabilityRmssd is an InstantaneousRecord: one `time` +
    // `heartRateVariabilityMillis` per record (no nested samples). Flatten to
    // the pure layer's `{ time, hrvMillis }` shape.
    const hrvSamples: HrvSampleAt[] = hrvRecords.map((record) => ({
      time: record.time,
      hrvMillis: record.heartRateVariabilityMillis,
    }));

    return {
      windowStart: startISO,
      windowEnd: endISO,
      sleepSessions: toSleepSummaries(sleepRecords),
      heartRateSamples,
      restingHrSamples,
      hrvSamples,
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
