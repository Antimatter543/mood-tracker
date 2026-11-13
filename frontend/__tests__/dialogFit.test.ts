/**
 * dialogMargins: the margins that keep an Add / Edit activity card off the
 * status bar, the nav bar and the keyboard (#51). The card's height comes from
 * flexbox (see useDialogFit); only these margins are arithmetic.
 */
import { DIALOG_MARGIN, dialogMargins } from '@/components/forms/dialogFit';

describe('dialogMargins', () => {
    it('keyboard closed: clears the status bar and the nav bar', () => {
        expect(dialogMargins({ keyboardHeight: 0, insetTop: 24, insetBottom: 48 })).toEqual({
            marginTop: 24 + DIALOG_MARGIN,
            marginBottom: 48 + DIALOG_MARGIN,
        });
    });

    it('keyboard open: the overlay already lifts the layer, so no nav-bar inset below', () => {
        // The keyboard height is measured from the screen bottom, nav bar
        // included; adding the inset again would steal room from the fields.
        expect(dialogMargins({ keyboardHeight: 300, insetTop: 24, insetBottom: 48 })).toEqual({
            marginTop: 24 + DIALOG_MARGIN,
            marginBottom: DIALOG_MARGIN,
        });
    });

    it('no system bars: just the margin on each side', () => {
        expect(dialogMargins({ keyboardHeight: 0, insetTop: 0, insetBottom: 0 })).toEqual({
            marginTop: DIALOG_MARGIN,
            marginBottom: DIALOG_MARGIN,
        });
    });
});
