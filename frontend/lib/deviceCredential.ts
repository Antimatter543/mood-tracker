import * as LocalAuthentication from 'expo-local-authentication';

/**
 * The phone's own screen lock, used for ONE thing: "Forgot PIN?" on the
 * SoulSync lock screen. The app lock itself is PIN-only (lib/pinLock.ts).
 * Every call is wrapped so a native failure reads as "no", never as a throw.
 */

/** The phone has a screen lock (PIN, pattern or password). */
export async function hasDeviceCredential(): Promise<boolean> {
    try {
        return Number(await LocalAuthentication.getEnrolledLevelAsync()) > 0;
    } catch {
        return false;
    }
}

/** Ask for the phone's screen lock. True only on success. */
export async function confirmDeviceCredential(): Promise<boolean> {
    try {
        const result = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Confirm it’s you',
            disableDeviceFallback: false,
            requireConfirmation: false,
        });
        return result.success;
    } catch {
        return false;
    }
}
