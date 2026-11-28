import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Turn Android's FLAG_SECURE on or off for SoulSync's window: while on, no
 * screenshots, no screen recording and no preview in the app switcher.
 * Our own local Expo module (android/.../SecureWindowModule.kt); why not a
 * package is in README.md next to this file.
 *
 * No-op where the native module is missing (Expo Go, iOS, jest) and never
 * throws: a failure here must not block the app or the lock.
 */
type SecureWindowNative = { setSecure(secure: boolean): Promise<void> };

const native = Platform.OS === 'android' ? requireOptionalNativeModule<SecureWindowNative>('SecureWindow') : null;

export async function setSecureWindow(secure: boolean): Promise<void> {
    if (!native) return;
    try {
        await native.setSecure(secure);
    } catch {
        // the window may be gone (app closing); the next foreground re-applies it
    }
}
