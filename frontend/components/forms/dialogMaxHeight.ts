import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOverlayKeyboardHeight } from '@/context/OverlayHost';

/** Space kept clear above and below a dialog card. */
export const DIALOG_MARGIN = 16;
/** Never shrink a card below this, even on a tiny window with the keyboard up. */
export const DIALOG_MIN_HEIGHT = 200;

/**
 * The tallest a centred OverlayModal dialog card may be.
 *
 * The overlay lifts a dialog above the keyboard by padding its centring layer,
 * but it does not scroll, so a card taller than the space left over clips its
 * header or its action button. A `maxHeight: '90%'` on the card does not help:
 * the card's parent hugs the card, so a percentage has no height to resolve
 * against. Hence a number: the window minus the keyboard, the status bar, the
 * nav bar (only while the keyboard is closed, the keyboard covers it) and a
 * margin each side. Pure so the arithmetic is unit-tested.
 */
export function dialogMaxHeight(o: {
    windowHeight: number;
    keyboardHeight: number;
    insetTop: number;
    insetBottom: number;
}): number {
    const bottom = o.keyboardHeight > 0 ? o.keyboardHeight : o.insetBottom;
    const room = o.windowHeight - o.insetTop - bottom - 2 * DIALOG_MARGIN;
    return Math.max(DIALOG_MIN_HEIGHT, Math.floor(room));
}

/** `dialogMaxHeight` for the current window, insets and keyboard. */
export function useDialogMaxHeight(): number {
    const { height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const keyboardHeight = useOverlayKeyboardHeight();
    return dialogMaxHeight({
        windowHeight: height,
        keyboardHeight,
        insetTop: insets.top,
        insetBottom: insets.bottom,
    });
}
