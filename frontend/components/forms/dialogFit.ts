import type { ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOverlayKeyboardHeight } from '@/context/OverlayHost';

/** Space kept clear between a dialog card and the status bar / keyboard / nav bar. */
export const DIALOG_MARGIN = 16;

/**
 * Margins that keep a centred OverlayModal card off the system bars and the
 * keyboard. The overlay already pads its layer by the keyboard height, so with
 * the keyboard up only the margin is added below; with it closed the nav bar
 * inset is. Pure so the arithmetic is unit-tested.
 */
export function dialogMargins(o: {
    keyboardHeight: number;
    insetTop: number;
    insetBottom: number;
}): { marginTop: number; marginBottom: number } {
    return {
        marginTop: o.insetTop + DIALOG_MARGIN,
        marginBottom: (o.keyboardHeight > 0 ? 0 : o.insetBottom) + DIALOG_MARGIN,
    };
}

/**
 * Fitting a form dialog (Add / Edit activity) on any screen.
 *
 * `cardStyle` lets the card shrink to the space the overlay gives it (the
 * overlay's card wrapper shrinks too, see OverlayModal `cardPress`), so a card
 * with a scrolling body never runs under the keyboard or off the top. Flexbox
 * does the sizing from the real layout; nothing is computed from the window.
 *
 * `keyboardOpen`: while typing, a dialog puts its action row at the end of the
 * scrolling body instead of pinning it, so the fields get the whole card and
 * the focused field is never cropped on a short screen or at a large font.
 */
export function useDialogFit(): { keyboardOpen: boolean; cardStyle: ViewStyle } {
    const insets = useSafeAreaInsets();
    const keyboardHeight = useOverlayKeyboardHeight();
    return {
        keyboardOpen: keyboardHeight > 0,
        cardStyle: {
            flexShrink: 1,
            ...dialogMargins({
                keyboardHeight,
                insetTop: insets.top,
                insetBottom: insets.bottom,
            }),
        },
    };
}
