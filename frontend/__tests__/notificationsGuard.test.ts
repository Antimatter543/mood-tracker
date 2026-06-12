/**
 * Tests for the lazy expo-notifications guard in lib/notifications.ts (Task 4).
 *
 * In Expo Go on Android the expo-notifications native module is stripped, so the
 * lazy `require('expo-notifications')` throws. The guard must:
 *   - degrade gracefully (functions no-op, never crash), and
 *   - log the "unavailable" notice with console.WARN, never console.ERROR
 *     (console.error made LogBox render a full-screen "Uncaught Error" on every
 *     Expo Go boot), and
 *   - log it at most ONCE per runtime (module flag), not on every call.
 *
 * We force the throw path with jest.doMock + isolateModules so each case gets a
 * fresh module with fresh cache/flag. console.warn/error are already jest.fn()
 * spies (silenced in jest.setup.ts) — we read their call records.
 */

describe('expo-notifications lazy guard (unavailable runtime)', () => {
    const warnSpy = console.warn as jest.Mock;
    const errorSpy = console.error as jest.Mock;

    beforeEach(() => {
        jest.resetModules();
        warnSpy.mockClear();
        errorSpy.mockClear();
    });

    /**
     * Load lib/notifications with expo-notifications mocked to THROW on require
     * (mirrors Expo Go), then return the module so the test can call into it.
     */
    const loadWithUnavailableModule = () => {
        let mod!: typeof import('@/lib/notifications');
        jest.isolateModules(() => {
            jest.doMock('expo-notifications', () => {
                throw new Error('Native module RNExpoNotifications not available (Expo Go)');
            });
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            mod = require('@/lib/notifications');
        });
        return mod;
    };

    it('does not throw when the native module is unavailable (functions degrade)', async () => {
        const mod = loadWithUnavailableModule();
        // These all funnel through getNotifications() and must no-op, not throw.
        await expect(mod.cancelDailyReminder()).resolves.toBeUndefined();
        await expect(mod.ensureAndroidChannel()).resolves.toBeUndefined();
        await expect(mod.requestNotificationPermission()).resolves.toBe(false);
        await expect(mod.getNotificationPermissionStatus()).resolves.toBe('undetermined');
    });

    it('logs the unavailable notice via console.warn, never console.error', async () => {
        const mod = loadWithUnavailableModule();
        await mod.cancelDailyReminder(); // triggers the guard

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy).not.toHaveBeenCalled();

        // Concise, single-string message tagged for grep.
        const [msg] = warnSpy.mock.calls[0];
        expect(typeof msg).toBe('string');
        expect(msg).toMatch(/\[notifications\]/);
        expect(msg).toMatch(/Expo Go/);
    });

    it('logs the notice at most ONCE across many calls (module flag)', async () => {
        const mod = loadWithUnavailableModule();
        // Hammer every guarded entry point several times.
        await mod.cancelDailyReminder();
        await mod.ensureAndroidChannel();
        await mod.requestNotificationPermission();
        await mod.getNotificationPermissionStatus();
        await mod.scheduleOrSkipDailyReminder({
            enabled: true,
            reminderTime: '20:00',
            currentStreak: 3,
            todayKey: '2026-06-12',
            entryDates: [],
        });

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy).not.toHaveBeenCalled();
    });
});
