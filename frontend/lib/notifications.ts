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
 *   - All scheduling DECISIONS live in pure functions (planReminderSchedule,
 *     buildReminderCopy, ...) so the computation layer is fully unit-testable
 *     without a native build. The effectful half only executes a plan.
 *   - reconcileReminders() is the single public entry point for re-arming. Call
 *     it on every app foreground (NotificationReArm in app/(tabs)/_layout.tsx).
 *   - Notifications "drift" and can be cleared by the OS; re-arming on every
 *     foreground ensures every enabled reminder always exists, and that
 *     deleted/disabled ones are gone.
 *   - The user can configure SEVERAL reminders (morning / afternoon / ...) —
 *     see lib/reminders.ts for the model. Each gets its own stable notification
 *     identifier, so reconciliation is per-reminder, not all-or-nothing.
 *   - This module never requests permissions implicitly. Permission is
 *     requested ONLY in response to a user gesture (adding/enabling a reminder).
 *
 * TODO(v2): weekly-recap — fire every Sunday 10:00 local with week stats.
 */

import { Platform } from 'react-native';
import type { Reminder } from '@/lib/reminders';
import { enabledReminders, reminderDisplayLabel } from '@/lib/reminders';
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

/**
 * The identifier used by the pre-v2.10 SINGLE daily reminder. No reminder in the
 * list model can ever produce it (list identifiers are prefixed below), so it is
 * only ever CANCELLED — unconditionally, on every reconcile, so an upgrading
 * user's old notification can't survive alongside the new ones even if listing
 * the OS schedule fails.
 */
export const LEGACY_DAILY_REMINDER_IDENTIFIER = 'soulsync-daily-reminder';

/** Every list-model reminder schedules under `<prefix><reminder.id>`. */
export const REMINDER_IDENTIFIER_PREFIX = 'soulsync-reminder-';

// The channel ID is PERMANENT: Android keys the user's per-channel preferences
// (sound, importance, blocked state) to it, so renaming it would orphan them and
// silently create a second channel. The display name is free to change.
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
    name: 'Reminders',
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

// ─── Identifiers ──────────────────────────────────────────────────────────────

/** The OS notification identifier for a reminder. Stable across re-arms. */
export function reminderNotificationIdentifier(reminderId: string): string {
  return `${REMINDER_IDENTIFIER_PREFIX}${reminderId}`;
}

/**
 * Is this scheduled notification one of OURS? Reconciliation only ever cancels
 * identifiers this returns true for, so a notification scheduled by anything
 * else (now or in a future feature) is never collaterally cancelled.
 */
export function isManagedNotificationIdentifier(identifier: string): boolean {
  return (
    identifier === LEGACY_DAILY_REMINDER_IDENTIFIER ||
    identifier.startsWith(REMINDER_IDENTIFIER_PREFIX)
  );
}

// ─── Copy for one reminder ────────────────────────────────────────────────────

/**
 * Notification copy for a single reminder.
 *
 * The user-set label becomes the TITLE — with several reminders firing on the
 * same day, "Morning check-in" vs "Evening reflection" is what makes them
 * distinguishable at a glance in the shade. The streak-aware body keeps the
 * motivation. An unlabelled reminder falls back to the streak title, i.e. the
 * pre-list behaviour.
 * Pure function — unit-testable.
 */
export function buildReminderCopy(
  label: string,
  streak: number
): { title: string; body: string } {
  const base = pickReminderCopy(streak);
  const trimmed = label.trim();
  return trimmed ? { title: trimmed, body: base.body } : base;
}

// ─── Reconciliation (pure planning) ───────────────────────────────────────────

/** One notification the OS should hold, fully resolved. */
export interface PlannedNotification {
  identifier: string;
  hour: number;
  minute: number;
  title: string;
  body: string;
}

export interface ReminderSchedulePlan {
  /** Identifiers of OURS to cancel — deleted/disabled reminders + the legacy one. */
  toCancel: string[];
  /** One entry per enabled reminder. Executed as cancel-then-schedule. */
  toSchedule: PlannedNotification[];
}

export interface ReminderPlanInput {
  reminders: readonly Reminder[];
  /**
   * What the OS currently holds (from getAllScheduledNotificationsAsync). Pass
   * [] when it can't be read — the plan stays correct, it just can't clean up
   * identifiers it doesn't know about (the next successful read will).
   */
  scheduledIdentifiers?: readonly string[];
  currentStreak: number;
  /** Today's YYYY-MM-DD in local time. */
  todayKey: string;
  /** Recent local date strings, for the already-logged-today check. */
  entryDates: readonly string[];
}

/**
 * Decide the whole schedule from (reminders x what's currently scheduled).
 * PURE — no native module, no clock. This is the function the tests drive.
 *
 * Rules:
 *   1. Every ENABLED reminder is scheduled under its own stable identifier. It
 *      is always re-scheduled (not "scheduled only if missing"), because a
 *      changed time/label must take effect and cancel-then-schedule by
 *      identifier is idempotent — re-arming can never accumulate duplicates.
 *   2. Anything OF OURS that the OS holds but we no longer want (a deleted or
 *      disabled reminder) is cancelled. Foreign identifiers are left alone.
 *   3. The legacy single-reminder identifier is ALWAYS cancelled: it can never
 *      be desired, and cancelling unconditionally means an upgrading user is
 *      cleaned up even if the OS schedule couldn't be read. Cancelling an
 *      identifier that isn't scheduled is a no-op.
 *   4. Streak copy: if the user already logged today, the next fire is
 *      tomorrow, so the copy uses tomorrow's streak (one more than today's).
 */
export function planReminderSchedule(input: ReminderPlanInput): ReminderSchedulePlan {
  const { reminders, scheduledIdentifiers = [], currentStreak, todayKey, entryDates } = input;

  const active = enabledReminders(reminders);
  const streak = hasLoggedToday(todayKey, entryDates as string[])
    ? currentStreak + 1
    : currentStreak;

  const toSchedule: PlannedNotification[] = active.map(reminder => {
    const { hour, minute } = parseReminderTime(reminder.time);
    const copy = buildReminderCopy(reminderDisplayLabel(reminder), streak);
    return {
      identifier: reminderNotificationIdentifier(reminder.id),
      hour,
      minute,
      title: copy.title,
      body: copy.body,
    };
  });

  const desired = new Set(toSchedule.map(p => p.identifier));
  const toCancel = [LEGACY_DAILY_REMINDER_IDENTIFIER];
  for (const identifier of scheduledIdentifiers) {
    if (!isManagedNotificationIdentifier(identifier)) continue; // never ours to cancel
    if (desired.has(identifier)) continue; // about to be re-scheduled
    if (toCancel.includes(identifier)) continue; // de-dupe (incl. the legacy id)
    toCancel.push(identifier);
  }

  return { toCancel, toSchedule };
}

// ─── Reconciliation (effects) ─────────────────────────────────────────────────

/**
 * Identifiers the OS currently holds for THIS app. Returns [] (never throws)
 * when the native module is absent or the query fails — the plan degrades to
 * "can't clean up unknown identifiers", not to a crash.
 */
async function getScheduledIdentifiers(): Promise<string[]> {
  const Notifications = getNotifications();
  if (!Notifications) return [];
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    return scheduled.map(request => request.identifier);
  } catch {
    return [];
  }
}

/** Execute a plan against the OS. No-ops entirely without the native module. */
async function applyReminderSchedulePlan(plan: ReminderSchedulePlan): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return; // Expo Go (no native module) — nothing to schedule

  for (const identifier of plan.toCancel) {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  }

  for (const planned of plan.toSchedule) {
    // Cancel first so a re-arm replaces rather than stacks. (Scheduling with an
    // existing identifier is not a documented replace on every platform.)
    await Notifications.cancelScheduledNotificationAsync(planned.identifier);
    await Notifications.scheduleNotificationAsync({
      identifier: planned.identifier,
      content: {
        title: planned.title,
        body: planned.body,
        sound: false, // silent — a mood reminder shouldn't blare
        ...(Platform.OS === 'android' && { channelId: ANDROID_CHANNEL_ID }),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: planned.hour,
        minute: planned.minute,
      },
    });
  }
}

/**
 * Cancel every reminder this module owns (both the list identifiers the OS
 * currently holds and the legacy one). Used when reminders are wiped.
 */
export async function cancelAllReminders(): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return; // nothing was scheduled where there's no module
  await applyReminderSchedulePlan({
    toCancel: [
      LEGACY_DAILY_REMINDER_IDENTIFIER,
      ...(await getScheduledIdentifiers()).filter(
        id => isManagedNotificationIdentifier(id) && id !== LEGACY_DAILY_REMINDER_IDENTIFIER
      ),
    ],
    toSchedule: [],
  });
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
  /** The user's full reminder list (enabled AND disabled — see the model). */
  reminders: readonly Reminder[];
  currentStreak: number;
  todayKey: string; // YYYY-MM-DD local
  entryDates: string[]; // recent local date strings
}

/**
 * Top-level re-arm function — the SINGLE public entry point. Call this on every
 * app foreground (NotificationReArm in app/(tabs)/_layout.tsx).
 *
 * Reads what the OS currently holds, plans the whole schedule purely
 * (planReminderSchedule — that is where the logic and the tests live), then
 * executes: cancel what is stale, (re)schedule every enabled reminder.
 *
 * This function does NOT request permissions. Call requestNotificationPermission()
 * separately, triggered by the user adding or enabling a reminder.
 */
export async function reconcileReminders(opts: RearmOptions): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return; // Expo Go (no native module) — nothing to do

  const plan = planReminderSchedule({
    reminders: opts.reminders,
    scheduledIdentifiers: await getScheduledIdentifiers(),
    currentStreak: opts.currentStreak,
    todayKey: opts.todayKey,
    entryDates: opts.entryDates,
  });

  // Only touch the channel when something will actually be posted to it.
  if (plan.toSchedule.length > 0) {
    await ensureAndroidChannel();
  }

  await applyReminderSchedulePlan(plan);
}
