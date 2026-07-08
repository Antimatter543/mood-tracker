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
 * Master feature flag for the Health Connect Settings surface.
 *
 * Default `true` on this branch so the section is testable end-to-end.
 *
 * PRODUCTION VALUE IS GATED: shipping Health Connect reads on Google Play
 * requires the app-level "Health Apps" declaration + a privacy-policy review.
 * Flip this to `false` (or wire it to a build-time env) until that declaration
 * is approved, so a store build never exposes an unauthorized Health Connect
 * integration.
 */
export const HEALTH_CONNECT_ENABLED = true;

/**
 * Android API level at/above which `react-native-health-connect`'s permission
 * prompt silently fails (an unfixed upstream bug on Android 16 / API 36). On
 * such devices we surface an explicit "not supported yet" state and never call
 * `connect()` — calling it would open a prompt the user can never complete.
 *
 * Behind a named constant so it's a one-line change to lift once the library
 * ships a fix.
 */
export const HEALTH_CONNECT_MIN_UNSUPPORTED_API = 36; // Android 16

/** How many days back the FIRST sync reads (incremental syncs read less). */
export const HEALTH_CONNECT_SYNC_WINDOW_DAYS = 30;

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
 * Whether the running Android version supports the Health Connect permission
 * flow. `false` at/above {@link HEALTH_CONNECT_MIN_UNSUPPORTED_API}. Pure.
 *
 * @param apiLevel `Platform.Version` on Android (the numeric API level).
 */
export function isHealthConnectVersionSupported(apiLevel: number): boolean {
  if (!Number.isFinite(apiLevel)) return false;
  return apiLevel < HEALTH_CONNECT_MIN_UNSUPPORTED_API;
}

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
 *  - `'unsupported_version'` — Android 16+, where the library's permission prompt
 *    is broken upstream (an info state, no action).
 *  - `'unavailable'` — the device can't run Health Connect at all (Android too
 *    old / native module absent). Info state, NO install action (installing the
 *    provider wouldn't help).
 *  - `'provider_required'` — Health Connect isn't installed (or is outdated) but
 *    the device CAN run it: offer an install-or-update action to the Play listing.
 *  - `'available'` — ready to connect / already connected.
 */
export type HealthConnectCardPhase =
  | 'unsupported_version'
  | 'unavailable'
  | 'provider_required'
  | 'available';

/**
 * Pure decision: which card phase to show, given the OS API level + the resolved
 * SDK status. The version gate wins first (an unsupported Android version can't
 * complete the permission flow regardless of provider state); otherwise the SDK
 * status decides. `'unsupported_platform'` can't occur on Android (the whole
 * section is gated off elsewhere) but folds to `'unavailable'` for safety.
 *
 * This is the mapping the "wrong copy on a device with no Health Connect" bug
 * lived in — kept pure + exported so the not-installed vs unsupported branches
 * are unit-testable without a device or the native module.
 */
export function resolveHealthConnectPhase(
  apiLevel: number,
  status: HealthConnectStatus
): HealthConnectCardPhase {
  if (!isHealthConnectVersionSupported(apiLevel)) return 'unsupported_version';
  if (status === 'available') return 'available';
  if (status === 'provider_required') return 'provider_required';
  // 'unavailable' or the impossible-on-Android 'unsupported_platform'.
  return 'unavailable';
}
