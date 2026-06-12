/**
 * Tests for the lazy expo-notifications guard in lib/notifications.ts.
 *
 * expo-notifications' native module is STRIPPED from Expo Go on Android (SDK
 * 53+). There are two ways the module can be absent, and the guard must handle
 * both WITHOUT crashing and WITHOUT a console.error (console.error makes LogBox
 * render a full-screen "Uncaught Error" on every Expo Go boot):
 *
 *   1. Expo Go on Android (`Constants.executionEnvironment === 'storeClient'`):
 *      the module's OWN factory throws/console.errors during evaluation, so even
 *      a try/catch around require can't suppress the LogBox error. The guard must
 *      therefore detect Expo Go up front and NEVER call require — asserted here by
 *      mocking expo-notifications with a factory that fails the test if invoked.
 *   2. Any other runtime where require throws (defensive): the try/catch still
 *      degrades to a no-op.
 *
 * In both cases the "unavailable" notice is console.WARN, once per runtime.
 *
 * We force each path with jest.doMock + isolateModules so each case gets a fresh
 * module (fresh cache/flag). console.warn/error are already jest.fn() spies
 * (silenced in jest.setup.ts) — we read their call records.
 */
import { Platform } from 'react-native';
import { ExecutionEnvironment } from 'expo-constants';

describe('expo-notifications lazy guard', () => {
    const warnSpy = console.warn as jest.Mock;
    const errorSpy = console.error as jest.Mock;
    const realOS = Platform.OS;

    beforeEach(() => {
        jest.resetModules();
        warnSpy.mockClear();
        errorSpy.mockClear();
    });

    afterEach(() => {
        // Restore Platform.OS for any test that mutated it.
        Object.defineProperty(Platform, 'OS', { value: realOS, configurable: true });
    });

    const setOS = (os: 'android' | 'ios') =>
        Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

    /** Mock expo-constants's executionEnvironment for the isolated module load. */
    const mockExecutionEnvironment = (env: ExecutionEnvironment) => {
        jest.doMock('expo-constants', () => ({
            __esModule: true,
            ExecutionEnvironment: {
                Bare: 'bare',
                Standalone: 'standalone',
                StoreClient: 'storeClient',
            },
            default: { executionEnvironment: env },
        }));
    };

    // ── Case group 1: require throws (real dev-client where the module is
    //    genuinely broken, OR any non-Expo-Go runtime). executionEnvironment is
    //    'standalone' so the up-front Expo-Go skip does NOT fire and we exercise
    //    the try/catch fallback. ──────────────────────────────────────────────
    const loadWithThrowingRequire = (os: 'android' | 'ios' = 'android') => {
        setOS(os);
        let mod!: typeof import('@/lib/notifications');
        jest.isolateModules(() => {
            mockExecutionEnvironment(ExecutionEnvironment.Standalone);
            jest.doMock('expo-notifications', () => {
                throw new Error('Native module RNExpoNotifications not available');
            });
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            mod = require('@/lib/notifications');
        });
        return mod;
    };

    it('does not throw when require fails (functions degrade)', async () => {
        const mod = loadWithThrowingRequire();
        await expect(mod.cancelDailyReminder()).resolves.toBeUndefined();
        await expect(mod.ensureAndroidChannel()).resolves.toBeUndefined();
        await expect(mod.requestNotificationPermission()).resolves.toBe(false);
        await expect(mod.getNotificationPermissionStatus()).resolves.toBe('undetermined');
    });

    it('logs the unavailable notice via console.warn, never console.error', async () => {
        const mod = loadWithThrowingRequire();
        await mod.cancelDailyReminder(); // triggers the guard

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy).not.toHaveBeenCalled();

        const [msg] = warnSpy.mock.calls[0];
        expect(typeof msg).toBe('string');
        expect(msg).toMatch(/\[notifications\]/);
        expect(msg).toMatch(/Expo Go/);
    });

    it('logs the notice at most ONCE across many calls (module flag)', async () => {
        const mod = loadWithThrowingRequire();
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

    // ── Case group 2: Expo Go on Android — the module must NEVER be required,
    //    because its factory throws DURING evaluation (LogBox error our catch
    //    can't suppress). The mock factory below fails the test if it is ever
    //    invoked. ────────────────────────────────────────────────────────────
    const loadInExpoGoAndroid = () => {
        setOS('android');
        let mod!: typeof import('@/lib/notifications');
        const requireSpy = jest.fn();
        jest.isolateModules(() => {
            mockExecutionEnvironment(ExecutionEnvironment.StoreClient);
            jest.doMock('expo-notifications', () => {
                // If the guard ever requires the module in Expo Go, this fires —
                // which is exactly the bug (the real module's factory throws here).
                requireSpy();
                throw new Error('expo-notifications factory must not run in Expo Go');
            });
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            mod = require('@/lib/notifications');
        });
        return { mod, requireSpy };
    };

    it('never requires expo-notifications in Expo Go on Android', async () => {
        const { mod, requireSpy } = loadInExpoGoAndroid();
        // Hammer every guarded entry point.
        await mod.cancelDailyReminder();
        await mod.requestNotificationPermission();
        await mod.getNotificationPermissionStatus();
        await mod.scheduleOrSkipDailyReminder({
            enabled: true,
            reminderTime: '20:00',
            currentStreak: 1,
            todayKey: '2026-06-13',
            entryDates: [],
        });

        // The require factory was never invoked — the up-front Expo-Go skip ran.
        expect(requireSpy).not.toHaveBeenCalled();
        // And it still degrades cleanly with the warn-once, no error.
        await expect(mod.requestNotificationPermission()).resolves.toBe(false);
        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('iOS Expo Go still requires the module (skip is Android-only)', () => {
        // iOS is unaffected by the Android native-module strip, so the up-front
        // skip must NOT fire on iOS even under storeClient — the require path runs.
        setOS('ios');
        const requireSpy = jest.fn(() => ({
            // a minimal stub standing in for the real module on iOS
            cancelScheduledNotificationAsync: jest.fn(),
        }));
        jest.isolateModules(() => {
            mockExecutionEnvironment(ExecutionEnvironment.StoreClient);
            jest.doMock('expo-notifications', () => {
                requireSpy();
                return { __esModule: true, cancelScheduledNotificationAsync: jest.fn() };
            });
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = require('@/lib/notifications');
            // Touch a guarded fn so getNotifications() runs its resolution path.
            void mod.cancelDailyReminder();
        });
        expect(requireSpy).toHaveBeenCalledTimes(1);
    });
});
