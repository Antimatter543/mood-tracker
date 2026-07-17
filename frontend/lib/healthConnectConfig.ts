/**
 * lib/healthConnectConfig.ts
 *
 * Native-free configuration + pure gating helpers for the Health Connect
 * feature. Kept separate from `lib/healthConnect.ts` (the native shell) so the
 * feature flag, constants, and gate logic can be imported by UI + tested with
 * ZERO native dependencies.
 *
 * (The only reference to `lib/healthConnect` here is a TYPE-only import, which is
 * erased at compile time — this module stays native-free at runtime.)
 */
import type { HealthConnectStatus } from './healthConnect';

/**
 * Master feature flag for the whole Health Connect feature — the Settings card,
 * the Insights health↔mood cards + overlay, and (transitively) the runtime
 * permission request and every sync. When `false`, none of that surfaces and no
 * Health Connect native call is made.
 *
 * THE SINGLE KNOB — `EXPO_PUBLIC_HEALTH_CONNECT`:
 *   - unset / any value other than '0'  → ENABLED  (the default; GitHub APK
 *     builds are unaffected — this is how every normal build ships HC).
 *   - '0'                                → DISABLED (the Play "no-HC" variant).
 *
 * ONE env var drives BOTH layers because it's an `EXPO_PUBLIC_*` var: Expo/Metro
 * inlines it into the JS bundle (so this runtime flag bakes in at bundle time),
 * AND the `plugins/withHealthConnect.js` config plugin reads the same
 * `process.env` at prebuild (Node), so the manifest and the JS agree by
 * construction. The CI Play-variant build exports `EXPO_PUBLIC_HEALTH_CONNECT=0`
 * for the prebuild AND the gradle bundle step (metro bundles the JS during
 * gradle — the env must be present there too, or the runtime flag bakes in wrong).
 *
 * WHY THE KNOB EXISTS (temporary, 2026-07-17): shipping Health Connect reads on
 * Google Play requires Google's app-level "Health Apps" declaration APPROVED
 * first (undeclared `android.permission.health.*` risks store removal; approval
 * takes ~2-3 weeks). That declaration is unfiled, so the Play AAB is built with
 * this knob OFF — Play users get everything ELSE now, with a manifest carrying
 * ZERO health permissions. Once the declaration is approved, flip the CI env
 * line to '1' (or drop it) and Play gets HC too, no code change.
 */
export const HEALTH_CONNECT_ENABLED =
  process.env.EXPO_PUBLIC_HEALTH_CONNECT !== '0';

/**
 * Hard cap on how far back a historical backfill reads (≈1 year). A user with
 * months/years of both Health Connect history AND mood history gets that overlap
 * pulled on first connect — but never more than this, so a huge history can't
 * make the first sync unbounded. See `resolveSyncWindow` in healthConnectPure.
 */
export const HEALTH_CONNECT_MAX_BACKFILL_DAYS = 365;

/**
 * Fallback lookback for the FIRST sync when there is NO mood history to anchor a
 * backfill to (a fresh, empty DB). With mood entries present the backfill instead
 * reaches back to the earliest mood day (capped at {@link HEALTH_CONNECT_MAX_BACKFILL_DAYS}).
 */
export const HEALTH_CONNECT_INITIAL_WINDOW_DAYS = 30;

/**
 * Max calendar-days read per chunk during a backfill. A large backfill is split
 * into ≤ this-many-day sub-windows and each chunk is aggregated + upserted before
 * the next is read, so at most one chunk's worth of raw heart-rate samples is held
 * in memory at once (a year of per-second HR would otherwise OOM the read).
 */
export const HEALTH_CONNECT_CHUNK_DAYS = 30;

/** The `source` label written on every locally-stored health row. */
export const HEALTH_CONNECT_SOURCE = 'health_connect';

/** Health Connect provider package (Google's Health Connect app on Play). */
export const HEALTH_CONNECT_PLAY_PACKAGE = 'com.google.android.apps.healthdata';

/** `market://` deep link to the Health Connect Play listing (opens the store app). */
export const HEALTH_CONNECT_PLAY_MARKET_URL = `market://details?id=${HEALTH_CONNECT_PLAY_PACKAGE}`;

/** Web fallback for the Health Connect Play listing (when the store app is absent). */
export const HEALTH_CONNECT_PLAY_WEB_URL = `https://play.google.com/store/apps/details?id=${HEALTH_CONNECT_PLAY_PACKAGE}`;

/**
 * `user_settings` key: the user's explicit opt-in to Health Connect syncing
 * ('true'/'false'). Distinct from the OS permission grant — the app treats a
 * user as connected only when BOTH are true, so "Turn off" honestly
 * disconnects even if the OS grant lingers. Stored as a plain user_settings
 * row (not SETTINGS_REGISTRY) because it's driven entirely by the custom
 * HealthConnectSection card, never the generic settings renderer.
 */
export const HEALTH_OPT_IN_SETTING_KEY = 'health_connect_opt_in';

/** `user_settings` key: ISO timestamp of the last successful sync ('' = never). */
export const HEALTH_LAST_SYNCED_SETTING_KEY = 'health_last_synced_at';

/**
 * Whether the Health Connect Settings section should render at all. Android +
 * feature-flag-on only; on iOS / web / when disabled the section renders
 * nothing. Pure.
 */
export function shouldShowHealthConnect(
  platformOS: string,
  enabled: boolean = HEALTH_CONNECT_ENABLED
): boolean {
  return platformOS === 'android' && enabled;
}

/**
 * The card's resolved display phase (excludes the transient `'loading'` state the
 * component shows before this resolves). Each phase drives one distinct body:
 *
 *  - `'unavailable'` — the device can't run Health Connect at all (Android too
 *    old / native module absent). Info state, NO install action (installing the
 *    provider wouldn't help).
 *  - `'provider_required'` — Health Connect isn't installed (or is outdated) but
 *    the device CAN run it: offer an install-or-update action to the Play listing.
 *  - `'available'` — ready to connect / already connected.
 *
 * NOTE (2026-07-13): there is deliberately NO Android-version gate. An earlier
 * build blocked Android 16 / API 36 outright ("not supported on your Android
 * version") on the belief that `react-native-health-connect`'s permission prompt
 * silently fails there. That was over-broad — Health Connect works on Android
 * 14/15/16 real devices (the library is current: 3.5.3 / connect-client
 * 1.1.0-alpha11); the "silent fail" reproduced only on an emulator (limited HC
 * support). The genuine Android-16 edge case — the permission promise not
 * resolving in the `never_ask_again`/blocked state (react-native#53887) — is
 * handled by a timeout on `connect()` (see lib/healthConnect.ts), not by
 * disabling the feature. So the phase is now a pure function of the SDK status.
 */
export type HealthConnectCardPhase =
  | 'unavailable'
  | 'provider_required'
  | 'available';

/**
 * Pure decision: which card phase to show, given the resolved SDK status.
 * `'unsupported_platform'` can't occur on Android (the whole section is gated off
 * elsewhere) but folds to `'unavailable'` for safety.
 *
 * This is the mapping the "wrong copy on a device with no Health Connect" bug
 * lived in — kept pure + exported so the not-installed vs unavailable branches
 * are unit-testable without a device or the native module.
 */
export function resolveHealthConnectPhase(
  status: HealthConnectStatus
): HealthConnectCardPhase {
  if (status === 'available') return 'available';
  if (status === 'provider_required') return 'provider_required';
  // 'unavailable' or the impossible-on-Android 'unsupported_platform'.
  return 'unavailable';
}
