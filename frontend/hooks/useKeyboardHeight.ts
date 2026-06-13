import { useEffect, useState } from 'react';
import { Keyboard, KeyboardEvent, Platform } from 'react-native';

/**
 * Track the on-screen keyboard's height (0 when hidden).
 *
 * WHY THIS EXISTS — the empirical failure it fixes:
 * Under enforced edge-to-edge (Expo SDK 56 / RN 0.85 / targetSdk 36,
 * `decorFitsSystemWindows=false`), Android's `adjustResize` no longer resizes
 * the app window when the IME opens, and a `KeyboardAvoidingView` with
 * `behavior={undefined}` is a NO-OP — verified on the release-shape APK: the
 * focused Notes EditText stayed at its no-keyboard bounds, fully BEHIND the
 * keyboard, and the form's ScrollView stayed full-height (nothing to scroll).
 * So the JS layer must consume the IME inset itself: read the keyboard height
 * here, then pad a ScrollView's contentContainer by it (giving real scroll
 * range) and scroll the focused field into view.
 *
 * Android only fires `keyboardDidShow` / `keyboardDidHide` (the `Will*` events
 * are iOS-only), so we listen to the `Did*` events on both platforms — they're
 * universally available and fire after the frame is known. `endCoordinates.height`
 * is the keyboard height in the same px space as layout. iOS also gets the
 * `Will*` events for a smoother (pre-animation) update.
 *
 * Returns the current keyboard height. Components add it to a contentContainer's
 * `paddingBottom` (typically plus the safe-area bottom inset) so the last field
 * can scroll above the keyboard.
 */
export function useKeyboardHeight(): number {
    const [height, setHeight] = useState(0);

    useEffect(() => {
        const onShow = (e: KeyboardEvent) => {
            setHeight(e.endCoordinates?.height ?? 0);
        };
        const onHide = () => setHeight(0);

        // `Did*` events are available on Android AND iOS. On iOS the `Will*`
        // events fire earlier (before the keyboard animates in), giving a
        // smoother push; Android ignores them (they never fire there).
        const subs = [
            Keyboard.addListener('keyboardDidShow', onShow),
            Keyboard.addListener('keyboardDidHide', onHide),
        ];
        if (Platform.OS === 'ios') {
            subs.push(
                Keyboard.addListener('keyboardWillShow', onShow),
                Keyboard.addListener('keyboardWillHide', onHide)
            );
        }

        return () => subs.forEach((s) => s.remove());
    }, []);

    return height;
}
