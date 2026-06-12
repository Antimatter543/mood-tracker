/**
 * lib/notifications.ts
 *
 * Local notification system for SoulSync. 100% on-device — no cloud.
 *
 * IMPORTANT: expo-notifications' native module is STRIPPED from Expo Go on
 * Android (since SDK 53). A bare top-level `import * as Notifications from
 * 'expo-notifications'` THROWS at module-evaluation time inside Expo Go, and
 * because this module is imported (transitively) by app/(tabs)/_layout.tsx, that
 * throw aborts the route module's evaluation -> its default export is undefined
 * -> expo-router reads `.ErrorBoundary` off undefined -> the WHOLE app
 * white-screens on the splash. To keep the app bootable in Expo Go (the on-device
 * iteration loop), the native module is loaded LAZILY through `getNotifications()`
 * and every public function no-ops (or returns a sane default) when it is absent.
 * On a real dev-client / release build the module is present and behaves exactly
 * as before. (Mirrors the already-guarded `react-native-haptic-feedback`.)
 * Full notification behaviour can only be verified on a dev-client/release build.
 *
 * Architecture:
 *   - All scheduling logic lives in pure/mockable functions so the
 *     computation layer is fully unit-testable without a native build.
 *   - scheduleOrSkipDailyReminder() is the single public entry point for
 *     re-arming. Call it on every app foreground (NotificationReArm in
 *     app/(tabs)/_layout.tsx).
 *   - Notifications "drift" and can be cleared by the OS; re-arming on every
 *     foreground ensures the reminder always exists.
 *   - This module never requests permissions implicitly. Permission is
 *     requested ONLY in response to a user gesture (toggling the switch).
 *
 * TODO(v2): weekly-recap — fire every Sunday 10:00 local with week stats.
 */

import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
// Type-only import: erased at compile time, so it never pulls the native module
// in at runtime (which would re-introduce the Expo-Go module-eval crash).
import type * as NotificationsModule from 'expo-notifications';

/**
 * True in Expo Go on Android, where expo-notifications' native module is
 * STRIPPED (SDK 53+). `Constants.executionEnvironment === 'storeClient'`
 * identifies the Expo Go client; standalone/bare (real dev-client + release
 * builds) report 'standalone'/'bare' and keep the full require path. iOS Expo
 * Go is unaffected by the Android strip, so we scope the skip to Android.
 */
const isExpoGoAndroid = (): boolean =>
  Platform.OS === 'android' &&
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * Lazily resolve the expo-notifications native module. Returns `null` when the
 * module is unavailable (Expo Go on Android strips it), so callers degrade to a
 * no-op instead of throwing at import. `require` is wrapped in try/catch because
 * accessing the stripped module throws synchronously. Resolved once and cached.
 */
let cachedNotifications: typeof NotificationsModule | null | undefined;
// Logs the "unavailable" notice at most ONCE per JS runtime. The cache above
// already short-circuits repeat requires, but this flag makes the once-only
// guarantee explicit and survives even if cachedNotifications were ever reset.
let warnedUnavailable = false;
/**
 * Emit the once-per-runtime "unavailable in Expo Go" notice (console.WARN, never
 * console.error — see below) and return null. Shared by the pre-require Expo-Go
 * skip and the require-threw fallback.
 */
function markUnavailable(): null {
  cachedNotifications = null;
  // ONE concise console.warn — never console.error. The module being absent in
  // Expo Go is expected, not an error; logging it as console.error made LogBox
  // render a full-screen "Uncaught Error" on every app boot in Go, disrupting
  // on-device QA. warn keeps it a quiet, dismissible notice.
  if (__DEV__ && !warnedUnavailable) {
    warnedUnavailable = true;
    console.warn(
      '[notifications] expo-notifications unavailable in this runtime (Expo Go) — reminders disabled'
    );
  }
  return cachedNotifications;
}

function getNotifications(): typeof NotificationsModule | null {
  if (cachedNotifications !== undefined) return cachedNotifications;

  // In Expo Go on Android the native module is stripped and `require(
  // 'expo-notifications')` does not merely return undefined — the module's own
  // factory console.errors/THROWS during evaluation, which LogBox surfaces as an
  // ERROR-level entry that our try/catch can't suppress (the error is emitted
  // INSIDE the module init, before control returns to us). Worse, Metro re-runs a
  // factory that previously threw on each fresh require attempt across reloads.
  // So we never require it in Expo Go at all — detect the client up front and
  // skip straight to the no-op path.
  if (isExpoGoAndroid()) {
    return markUnavailable();
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, guarded native require (see module header)
    cachedNotifications = require('expo-notifications') as typeof NotificationsModule;
  } catch {
    // Defensive fallback: any OTHER runtime where the require throws still
    // degrades rather than crashing.
    return markUnavailable();
  }
  return cachedNotifications;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const DAILY_REMINDER_IDENTIFIER = 'soulsync-daily-reminder';
export const ANDROID_CHANNEL_ID = 'daily-reminder';

// ─── Android channel setup ────────────────────────────────────────────────────

/**
 * Register the Android notification channel. Safe to call multiple times
 * (setNotificationChannelAsync is idempotent). Must be called before any
 * notification is scheduled.
 */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const Notifications = getNotifications();
  if (!Notifications) return; // no native module (Expo Go) — nothing to register
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Daily Reminder',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#4CAF50',
    sound: null, // silent channel — a mood reminder shouldn't blare
  });
}

// ─── Permission ───────────────────────────────────────────────────────────────

/**
 * Request notification permissions. Returns true if granted.
 *
 * Call ONLY in response to a user gesture (toggling the reminder switch).
 * Do NOT call on cold boot.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const Notifications = getNotifications();
  if (!Notifications) return false; // can't be granted where there's no module
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Returns the current permission status without prompting.
 * Reports 'undetermined' when the native module is unavailable (Expo Go).
 */
export async function getNotificationPermissionStatus(): Promise<string> {
  const Notifications = getNotifications();
  if (!Notifications) return 'undetermined';
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

// ─── Copy selection ───────────────────────────────────────────────────────────

/**
 * Pick notification body copy based on current streak.
 * Pure function — fully unit-testable without a native build.
 */
export function pickReminderCopy(streak: number): { title: string; body: string } {
  if (streak <= 0) {
    return {
      title: 'Time to check in',
      body: 'How are you feeling today? Log your first entry and start a streak.',
    };
  }
  if (streak === 1) {
    return {
      title: 'How are you feeling?',
      body: 'You logged yesterday — keep the momentum going.',
    };
  }
  if (streak < 7) {
    return {
      title: `${streak}-day streak`,
      body: `You're on a roll. Take a moment to log today's mood.`,
    };
  }
  if (streak < 30) {
    return {
      title: `${streak} days strong`,
      body: 'Consistent check-ins build real self-awareness. Keep it going.',
    };
  }
  return {
    title: `${streak}-day streak — impressive`,
    body: "You've built a real habit. How are you feeling today?",
  };
}

// ─── Time parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a "HH:MM" 24-hour string into { hour, minute }.
 * Returns default 20:00 on invalid input.
 * Pure function — unit-testable.
 */
export function parseReminderTime(hhmm: string): { hour: number; minute: number } {
  const match = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { hour: 20, minute: 0 };
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { hour: 20, minute: 0 };
  }
  return { hour, minute };
}

/**
 * Serialize { hour, minute } back to "HH:MM".
 * Pure function — unit-testable.
 */
export function formatReminderTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Compute the next trigger Date for a daily reminder at {hour, minute}.
 * If that time has already passed today in local time, schedules for tomorrow.
 * Pure function — unit-testable (pass `now` explicitly).
 */
export function nextTriggerDate(
  hour: number,
  minute: number,
  now: Date = new Date()
): Date {
  const trigger = new Date(now);
  trigger.setHours(hour, minute, 0, 0);
  if (trigger <= now) {
    trigger.setDate(trigger.getDate() + 1);
  }
  return trigger;
}

// ─── Core scheduling ──────────────────────────────────────────────────────────

/**
 * Cancel any existing daily reminder (by identifier) and schedule a new one.
 * This is a "replace" operation — safe to call on every app foreground.
 */
export async function rescheduleDailyReminder(
  hour: number,
  minute: number,
  copy: { title: string; body: string }
): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return; // Expo Go (no native module) — nothing to schedule

  // Cancel previous so we never accumulate duplicates.
  await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_IDENTIFIER);

  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_REMINDER_IDENTIFIER,
    content: {
      title: copy.title,
      body: copy.body,
      sound: false, // silent — a mood reminder shouldn't blare
      ...(Platform.OS === 'android' && { channelId: ANDROID_CHANNEL_ID }),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    },
  });
}

/**
 * Cancel the daily reminder and remove it from the schedule.
 */
export async function cancelDailyReminder(): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return; // nothing was scheduled where there's no module
  await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_IDENTIFIER);
}

// ─── "Already logged today" guard ─────────────────────────────────────────────

/**
 * Check whether the user has already logged at least one entry today
 * (local timezone).
 *
 * `todayKey`: today's YYYY-MM-DD in local time — pass localDateString(new Date()).
 * `entryDates`: the array of YYYY-MM-DD strings from the recent-entries query.
 * Pure function — unit-testable.
 */
export function hasLoggedToday(todayKey: string, entryDates: string[]): boolean {
  return entryDates.includes(todayKey);
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export interface RearmOptions {
  enabled: boolean;
  reminderTime: string; // "HH:MM"
  currentStreak: number;
  todayKey: string; // YYYY-MM-DD local
  entryDates: string[]; // recent local date strings
}

/**
 * Top-level re-arm function. Call this on every app foreground.
 *
 * Logic:
 *   1. If reminders disabled → cancel any existing and return.
 *   2. If user already logged today → keep the DAILY reminder armed but with
 *      copy reflecting tomorrow's streak (the OS fires the next slot, which is
 *      tomorrow, since today's H:M has effectively been satisfied).
 *   3. Otherwise → (re)schedule the DAILY reminder with streak-aware copy.
 *
 * The DAILY trigger is idempotent: rescheduleDailyReminder() cancels the prior
 * one by identifier first, so re-arming never accumulates duplicates.
 *
 * This function does NOT request permissions. Call requestNotificationPermission()
 * separately, triggered by the user toggling the switch.
 */
export async function scheduleOrSkipDailyReminder(opts: RearmOptions): Promise<void> {
  if (!opts.enabled) {
    await cancelDailyReminder();
    return;
  }

  await ensureAndroidChannel();

  const { hour, minute } = parseReminderTime(opts.reminderTime);

  if (hasLoggedToday(opts.todayKey, opts.entryDates)) {
    // Already logged today — the next DAILY fire is tomorrow, so use the copy
    // for tomorrow's streak (one more consecutive day than today's count).
    const copy = pickReminderCopy(opts.currentStreak + 1);
    await rescheduleDailyReminder(hour, minute, copy);
    return;
  }

  const copy = pickReminderCopy(opts.currentStreak);
  await rescheduleDailyReminder(hour, minute, copy);
}
