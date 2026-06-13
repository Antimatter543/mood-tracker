import { useState } from 'react';
import {
    useAnimatedKeyboard,
    useAnimatedReaction,
    runOnJS,
} from 'react-native-reanimated';

/**
 * Track the on-screen keyboard's height (0 when hidden), in JS state.
 *
 * WHY THIS EXISTS — the empirical failure it fixes (TWO dead attempts before this):
 * Under enforced edge-to-edge (Expo SDK 56 / RN 0.85 / targetSdk 36,
 * `decorFitsSystemWindows=false`):
 *   1. A `KeyboardAvoidingView` is a no-op on Android (the window doesn't resize).
 *   2. RN's JS `Keyboard` module (`keyboardDidShow`) derives Android height from
 *      the window-RESIZE delta — and under edge-to-edge the window never resizes,
 *      so the event reports height 0. Verified on the release APK: the focused
 *      Notes field never moved and the activity dialog barely shifted, because the
 *      padding it was fed was 0.
 *
 * The correct height SOURCE under edge-to-edge is Android's native
 * WindowInsetsAnimation callback, which reanimated exposes via
 * `useAnimatedKeyboard` (already a dependency — reanimated 4.3.1 — and bundled in
 * Expo Go, so NO new native dep / the dev loop is preserved). Reanimated flags it
 * as soft-deprecated in favour of `react-native-keyboard-controller` (a native
 * module NOT in Expo Go) — but the built-in hook is the correct in-budget choice
 * here, and it still works. (Note: do NOT write the literal at-deprecated tag in
 * this comment — TS's JSDoc parser would treat it as a real tag and mark this hook
 * + every consumer deprecated.)
 *
 * EDGE-TO-EDGE OPTIONS (prescribed by the docs + the native math, NOT guessed):
 * `Keyboard.updateHeight` (reanimated android/.../keyboard/Keyboard.java) computes
 *     keyboardHeight = ime.bottom - (isNavigationBarTranslucent ? 0 : systemBar.bottom)
 * Our app is unconditional edge-to-edge — the nav + status bars are drawn behind
 * (translucent) — so we set BOTH translucent flags `true`. That makes the reported
 * height the FULL keyboard height from the screen bottom (~804 on the Pixel 3),
 * which is exactly what we pad by to clear the keyboard. With them `false` the nav
 * inset (~48dp) would be wrongly subtracted (the docs: translucent=true → margin 0;
 * translucent=false → margin per insets; status-bar-translucent=true → top margin 0).
 *
 * The height lives on the UI thread (a shared value); we bridge it to JS state with
 * `useAnimatedReaction` + `runOnJS`, updating only when the ROUNDED height changes
 * (not every animation frame) so the existing padding/scroll code keeps consuming a
 * plain number with no per-frame runOnJS jank.
 *
 * Consumers add the returned height to a scroll container's `paddingBottom` (giving
 * real scroll range) and scroll the focused field into view.
 */
export function useKeyboardHeight(): number {
    const keyboard = useAnimatedKeyboard({
        // Edge-to-edge: both system bars are translucent / drawn behind, so the
        // reported keyboard height must NOT subtract their insets. See header.
        isStatusBarTranslucentAndroid: true,
        isNavigationBarTranslucentAndroid: true,
    });
    const [height, setHeight] = useState(0);

    // Bridge the UI-thread shared value to JS state. Only push on a meaningful
    // (rounded) change so we don't fire runOnJS every animation frame.
    useAnimatedReaction(
        () => Math.round(keyboard.height.value),
        (current, previous) => {
            if (current !== previous) {
                runOnJS(setHeight)(current);
            }
        },
        []
    );

    return height;
}
