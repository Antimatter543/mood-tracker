/**
 * Tests for the MULTI-reminder scheduling layer in lib/notifications.ts.
 *
 * The user can configure several reminders (morning / afternoon / ...), each with
 * its own time and enabled switch. Re-arming therefore stopped being a toggle and
 * became a RECONCILIATION: given the reminder list and what the OS currently
 * holds, decide what to cancel and what to (re)schedule.
 *
 * That decision lives in the pure `planReminderSchedule()` — which is what most
 * of this file drives, no native module required. The last describe block covers
 * the thin effectful half (`reconcileReminders`) against a mocked
 * expo-notifications, because three things there are easy to get wrong and
 * invisible in a pure test: the cancel-BEFORE-schedule ordering (a re-arm must
 * replace, never stack), not touching the Android channel when nothing is being
 * scheduled, and surviving a failed read of the OS schedule.
 *
 * What CANNOT be tested here: that a notification actually fires. expo-
 * notifications' native module is stripped from Expo Go on Android and absent in
 * jest — firing is release-build-only verification.
 */
import { Platform } from 'react-native';

import {
  LEGACY_DAILY_REMINDER_IDENTIFIER,
  REMINDER_IDENTIFIER_PREFIX,
  buildReminderCopy,
  isManagedNotificationIdentifier,
  pickReminderCopy,
  planReminderSchedule,
  reminderNotificationIdentifier,
} from '@/lib/notifications';
import type { Reminder } from '@/lib/reminders';

// Android so the channelId branch of the scheduled content is exercised.
Platform.OS = 'android';

// Report a NON-Expo-Go runtime, otherwise lib/notifications' up-front Expo-Go
// skip short-circuits every effectful call to a no-op (that path has its own
// suite: notificationsGuard.test.ts).
jest.mock('expo-constants', () => ({
  __esModule: true,
  ExecutionEnvironment: {
    Bare: 'bare',
    Standalone: 'standalone',
    StoreClient: 'storeClient',
  },
  default: { executionEnvironment: 'standalone' },
}));

// The name must start with `mock` for babel-plugin-jest-hoist to allow the
// factory to close over it.
const mockNotifications = {
  setNotificationChannelAsync: jest.fn(async (_id: string, _channel: Record<string, unknown>) => {}),
  cancelScheduledNotificationAsync: jest.fn(async (_identifier: string) => {}),
  scheduleNotificationAsync: jest.fn(async (_request: Record<string, unknown>) => 'scheduled'),
  getAllScheduledNotificationsAsync: jest.fn(async (): Promise<{ identifier: string }[]> => []),
  // Present so the "never asks implicitly" test can assert they stay UNCALLED.
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DAILY: 'daily' },
};
jest.mock('expo-notifications', () => mockNotifications);

const reminder = (over: Partial<Reminder> = {}): Reminder => ({
  id: 'reminder-1',
  label: 'Morning check-in',
  time: '08:00',
  enabled: true,
  ...over,
});

const ident = (id: string) => `${REMINDER_IDENTIFIER_PREFIX}${id}`;

// A day with no entry logged, so the streak copy is used verbatim.
const NOT_LOGGED = { todayKey: '2026-09-03', entryDates: ['2026-09-01'] };

describe('identifiers', () => {
  it('derives a prefixed identifier per reminder', () => {
    expect(reminderNotificationIdentifier('reminder-4')).toBe(`${REMINDER_IDENTIFIER_PREFIX}reminder-4`);
  });

  it('claims our own identifiers, including the legacy single-reminder one', () => {
    expect(isManagedNotificationIdentifier(ident('reminder-1'))).toBe(true);
    expect(isManagedNotificationIdentifier(LEGACY_DAILY_REMINDER_IDENTIFIER)).toBe(true);
  });

  it('never claims a foreign identifier', () => {
    // The reconciler cancels ONLY what this returns true for, so a future
    // feature's notification (or another library's) must never match.
    for (const foreign of ['some-other-notification', '', 'soulsync-weekly-recap', 'reminder-1']) {
      expect(isManagedNotificationIdentifier(foreign)).toBe(false);
    }
  });

  it('cannot be produced by a list reminder — the legacy id is only ever cancelled', () => {
    // Guards the assumption planReminderSchedule relies on when it cancels the
    // legacy identifier unconditionally.
    expect(LEGACY_DAILY_REMINDER_IDENTIFIER.startsWith(REMINDER_IDENTIFIER_PREFIX)).toBe(false);
  });
});

describe('buildReminderCopy', () => {
  it('uses the label as the title so simultaneous reminders are distinguishable', () => {
    const copy = buildReminderCopy('Evening reflection', 5);
    expect(copy.title).toBe('Evening reflection');
  });

  it('keeps the streak-aware body regardless of the label', () => {
    expect(buildReminderCopy('Evening reflection', 5).body).toBe(pickReminderCopy(5).body);
  });

  it('falls back to the streak title when unlabelled (the pre-list behaviour)', () => {
    expect(buildReminderCopy('', 5)).toEqual(pickReminderCopy(5));
    expect(buildReminderCopy('   ', 0)).toEqual(pickReminderCopy(0));
  });

  it('trims a padded label', () => {
    expect(buildReminderCopy('  Lunch  ', 2).title).toBe('Lunch');
  });
});

describe('planReminderSchedule', () => {
  it('schedules every enabled reminder, at its own time, under its own identifier', () => {
    const reminders = [
      reminder({ id: 'reminder-1', label: 'Morning', time: '08:15' }),
      reminder({ id: 'reminder-2', label: 'Evening', time: '21:30' }),
    ];

    const plan = planReminderSchedule({ reminders, currentStreak: 0, ...NOT_LOGGED });

    expect(plan.toSchedule).toEqual([
      expect.objectContaining({ identifier: ident('reminder-1'), hour: 8, minute: 15, title: 'Morning' }),
      expect.objectContaining({ identifier: ident('reminder-2'), hour: 21, minute: 30, title: 'Evening' }),
    ]);
  });

  it('skips disabled reminders', () => {
    const reminders = [
      reminder({ id: 'reminder-1', enabled: true }),
      reminder({ id: 'reminder-2', enabled: false }),
    ];

    const plan = planReminderSchedule({ reminders, currentStreak: 0, ...NOT_LOGGED });

    expect(plan.toSchedule.map(p => p.identifier)).toEqual([ident('reminder-1')]);
  });

  it('titles an unlabelled reminder with the streak copy, never an empty string', () => {
    // Deliberately the RAW label, not the settings list's "Reminder" fallback:
    // an unnamed reminder keeps the motivating pre-list title.
    const plan = planReminderSchedule({
      reminders: [reminder({ label: '' })],
      currentStreak: 3,
      ...NOT_LOGGED,
    });
    expect(plan.toSchedule[0].title).toBe(pickReminderCopy(3).title);
    expect(plan.toSchedule[0].title.length).toBeGreaterThan(0);
  });

  it('re-schedules an already-scheduled reminder (a changed time must take effect)', () => {
    // "Schedule only what is missing" would silently keep the old time forever.
    const plan = planReminderSchedule({
      reminders: [reminder({ id: 'reminder-1', time: '09:45' })],
      scheduledIdentifiers: [ident('reminder-1')],
      currentStreak: 0,
      ...NOT_LOGGED,
    });

    expect(plan.toSchedule).toHaveLength(1);
    expect(plan.toSchedule[0]).toMatchObject({ hour: 9, minute: 45 });
    // ...and it is NOT also queued for cancellation.
    expect(plan.toCancel).not.toContain(ident('reminder-1'));
  });

  it('cancels ours that are scheduled but no longer wanted (deleted or disabled)', () => {
    const plan = planReminderSchedule({
      reminders: [
        reminder({ id: 'reminder-1', enabled: true }),
        reminder({ id: 'reminder-2', enabled: false }), // switched off
      ],
      // reminder-3 was deleted from the list entirely.
      scheduledIdentifiers: [ident('reminder-1'), ident('reminder-2'), ident('reminder-3')],
      currentStreak: 0,
      ...NOT_LOGGED,
    });

    expect(plan.toCancel).toContain(ident('reminder-2'));
    expect(plan.toCancel).toContain(ident('reminder-3'));
    expect(plan.toCancel).not.toContain(ident('reminder-1'));
  });

  it('never cancels a foreign identifier', () => {
    const plan = planReminderSchedule({
      reminders: [],
      scheduledIdentifiers: ['some-other-app-notification', 'soulsync-weekly-recap'],
      currentStreak: 0,
      ...NOT_LOGGED,
    });

    expect(plan.toCancel).toEqual([LEGACY_DAILY_REMINDER_IDENTIFIER]);
  });

  it('always cancels the legacy single-reminder identifier, exactly once', () => {
    // Unconditional so an upgrading user is cleaned up even when the OS schedule
    // could not be read (scheduledIdentifiers defaults to []).
    const withoutListing = planReminderSchedule({
      reminders: [reminder()],
      currentStreak: 0,
      ...NOT_LOGGED,
    });
    expect(withoutListing.toCancel).toEqual([LEGACY_DAILY_REMINDER_IDENTIFIER]);

    const withListing = planReminderSchedule({
      reminders: [reminder()],
      scheduledIdentifiers: [LEGACY_DAILY_REMINDER_IDENTIFIER, LEGACY_DAILY_REMINDER_IDENTIFIER],
      currentStreak: 0,
      ...NOT_LOGGED,
    });
    expect(withListing.toCancel).toEqual([LEGACY_DAILY_REMINDER_IDENTIFIER]);
  });

  it('an empty list cancels everything of ours and schedules nothing', () => {
    const plan = planReminderSchedule({
      reminders: [],
      scheduledIdentifiers: [ident('reminder-1'), ident('reminder-2')],
      currentStreak: 0,
      ...NOT_LOGGED,
    });

    expect(plan.toSchedule).toEqual([]);
    expect(plan.toCancel).toEqual([
      LEGACY_DAILY_REMINDER_IDENTIFIER,
      ident('reminder-1'),
      ident('reminder-2'),
    ]);
  });

  it('uses tomorrow’s streak in the copy once today is already logged', () => {
    // The next fire of a DAILY trigger is tomorrow, which will be one more
    // consecutive day than today's count.
    const reminders = [reminder({ label: '' })]; // unlabelled -> streak copy is the title
    const todayKey = '2026-09-03';

    const notLogged = planReminderSchedule({
      reminders,
      currentStreak: 4,
      todayKey,
      entryDates: ['2026-09-02'],
    });
    const logged = planReminderSchedule({
      reminders,
      currentStreak: 4,
      todayKey,
      entryDates: ['2026-09-02', todayKey],
    });

    expect(notLogged.toSchedule[0].title).toBe(pickReminderCopy(4).title);
    expect(logged.toSchedule[0].title).toBe(pickReminderCopy(5).title);
  });

  it('is idempotent — planning twice from its own result changes nothing', () => {
    const reminders = [
      reminder({ id: 'reminder-1', time: '08:00' }),
      reminder({ id: 'reminder-2', time: '13:00' }),
    ];
    const first = planReminderSchedule({ reminders, currentStreak: 1, ...NOT_LOGGED });
    const second = planReminderSchedule({
      reminders,
      scheduledIdentifiers: first.toSchedule.map(p => p.identifier),
      currentStreak: 1,
      ...NOT_LOGGED,
    });

    expect(second.toSchedule).toEqual(first.toSchedule);
    expect(second.toCancel).toEqual([LEGACY_DAILY_REMINDER_IDENTIFIER]);
  });

  it('normalizes a corrupt stored time rather than emitting NaN hours', () => {
    // parseReminders would already have normalized this; belt-and-braces, since
    // a NaN hour would throw inside the native scheduler.
    const plan = planReminderSchedule({
      reminders: [reminder({ time: 'not-a-time' })],
      currentStreak: 0,
      ...NOT_LOGGED,
    });
    expect(plan.toSchedule[0]).toMatchObject({ hour: 20, minute: 0 });
  });

  it('cancel and schedule sets never overlap', () => {
    // A class-level invariant: if an identifier appeared in both, execution
    // order would decide whether the reminder survives.
    const plan = planReminderSchedule({
      reminders: [
        reminder({ id: 'reminder-1', enabled: true }),
        reminder({ id: 'reminder-2', enabled: false }),
      ],
      scheduledIdentifiers: [
        ident('reminder-1'),
        ident('reminder-2'),
        ident('reminder-9'),
        LEGACY_DAILY_REMINDER_IDENTIFIER,
      ],
      currentStreak: 2,
      ...NOT_LOGGED,
    });

    const scheduled = new Set(plan.toSchedule.map(p => p.identifier));
    for (const id of plan.toCancel) expect(scheduled.has(id)).toBe(false);
    expect(new Set(plan.toCancel).size).toBe(plan.toCancel.length); // no duplicates
  });
});

describe('reconcileReminders (effects)', () => {
  // Imported lazily so the mocks above are in place; the module caches the
  // resolved native module, which is the same mock object throughout.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { reconcileReminders } = require('@/lib/notifications') as typeof import('@/lib/notifications');

  beforeEach(() => {
    jest.clearAllMocks();
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  });

  it('schedules a DAILY trigger per enabled reminder, on the app channel', async () => {
    await reconcileReminders({
      reminders: [reminder({ id: 'reminder-1', label: 'Morning', time: '07:05' })],
      currentStreak: 0,
      ...NOT_LOGGED,
    });

    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const [request] = mockNotifications.scheduleNotificationAsync.mock.calls[0] as [any];
    expect(request.identifier).toBe(ident('reminder-1'));
    expect(request.trigger).toEqual({ type: 'daily', hour: 7, minute: 5 });
    expect(request.content).toMatchObject({ title: 'Morning', sound: false, channelId: 'daily-reminder' });
  });

  it('cancels each identifier BEFORE re-scheduling it (a re-arm replaces, never stacks)', async () => {
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: ident('reminder-1') },
    ]);

    await reconcileReminders({
      reminders: [reminder({ id: 'reminder-1' })],
      currentStreak: 0,
      ...NOT_LOGGED,
    });

    const cancelledSelf = mockNotifications.cancelScheduledNotificationAsync.mock.calls
      .map((call, i) => ({
        id: call[0],
        order: mockNotifications.cancelScheduledNotificationAsync.mock.invocationCallOrder[i],
      }))
      .find(c => c.id === ident('reminder-1'));
    expect(cancelledSelf).toBeDefined();
    expect(cancelledSelf!.order).toBeLessThan(
      mockNotifications.scheduleNotificationAsync.mock.invocationCallOrder[0]
    );
  });

  it('cancels stale reminders of ours and leaves foreign notifications alone', async () => {
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: ident('reminder-1') },
      { identifier: ident('reminder-7') }, // deleted
      { identifier: 'someone-elses-notification' },
    ]);

    await reconcileReminders({
      reminders: [reminder({ id: 'reminder-1' })],
      currentStreak: 0,
      ...NOT_LOGGED,
    });

    const cancelled = mockNotifications.cancelScheduledNotificationAsync.mock.calls.map(c => c[0]);
    expect(cancelled).toContain(ident('reminder-7'));
    expect(cancelled).toContain(LEGACY_DAILY_REMINDER_IDENTIFIER);
    expect(cancelled).not.toContain('someone-elses-notification');
  });

  it('registers the Android channel only when something is actually scheduled', async () => {
    await reconcileReminders({
      reminders: [reminder({ enabled: false })],
      currentStreak: 0,
      ...NOT_LOGGED,
    });
    expect(mockNotifications.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();

    await reconcileReminders({
      reminders: [reminder({ enabled: true })],
      currentStreak: 0,
      ...NOT_LOGGED,
    });
    expect(mockNotifications.setNotificationChannelAsync).toHaveBeenCalledTimes(1);
  });

  it('still arms reminders when the OS schedule cannot be read', async () => {
    // A failed listing must degrade to "can't clean up unknown identifiers",
    // never to "no reminders at all".
    mockNotifications.getAllScheduledNotificationsAsync.mockRejectedValue(new Error('nope'));

    await reconcileReminders({
      reminders: [reminder({ id: 'reminder-1' })],
      currentStreak: 0,
      ...NOT_LOGGED,
    });

    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      LEGACY_DAILY_REMINDER_IDENTIFIER
    );
  });

  it('never requests (or even reads) permission implicitly', async () => {
    // Permission is a user-gesture-only action — RemindersSection owns it. A
    // re-arm runs on every foreground, so prompting from here would ambush the
    // user on app open.
    await reconcileReminders({
      reminders: [reminder()],
      currentStreak: 0,
      ...NOT_LOGGED,
    });

    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockNotifications.getPermissionsAsync).not.toHaveBeenCalled();
  });
});
