/**
 * dialogMaxHeight: the height cap of the Add / Edit activity dialogs (#51).
 * The overlay lifts a card above the keyboard but never scrolls it, so the cap
 * is what keeps the header and the action button on screen at 360x640 with the
 * keyboard up.
 */
import { DIALOG_MARGIN, DIALOG_MIN_HEIGHT, dialogMaxHeight } from '@/components/forms/dialogMaxHeight';

describe('dialogMaxHeight', () => {
    it('keyboard closed: window minus status bar, nav bar and both margins', () => {
        expect(
            dialogMaxHeight({ windowHeight: 640, keyboardHeight: 0, insetTop: 24, insetBottom: 48 })
        ).toBe(640 - 24 - 48 - 2 * DIALOG_MARGIN);
    });

    it('keyboard up: the keyboard replaces the nav bar (it covers it)', () => {
        expect(
            dialogMaxHeight({ windowHeight: 640, keyboardHeight: 280, insetTop: 24, insetBottom: 48 })
        ).toBe(640 - 24 - 280 - 2 * DIALOG_MARGIN);
    });

    it('never goes below the floor on a tiny window', () => {
        expect(
            dialogMaxHeight({ windowHeight: 400, keyboardHeight: 300, insetTop: 24, insetBottom: 0 })
        ).toBe(DIALOG_MIN_HEIGHT);
    });

    it('returns whole dp', () => {
        expect(
            Number.isInteger(
                dialogMaxHeight({ windowHeight: 683.4, keyboardHeight: 0, insetTop: 24.5, insetBottom: 0 })
            )
        ).toBe(true);
    });
});
