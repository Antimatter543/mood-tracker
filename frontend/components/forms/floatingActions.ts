/**
 * Geometry for the entry form's floating Back / Save buttons (details step).
 *
 * The floating pair stands in for the inline Back + Submit row while that row
 * is scrolled out of view, so the user can save a long entry (many activities,
 * a long note, photos) without scrolling to the end first.
 *
 * Pure and dependency-free so the visibility and placement rules are unit
 * tested directly (see __tests__/entryFormFloatingActions.test.tsx).
 */

export const FLOATING_ACTION_SIZE = 48;
/** Gap between a floating button and the screen edge it is anchored to. */
export const FLOATING_ACTION_EDGE_GAP = 16;
/** Gap between the two floating buttons. */
export const FLOATING_ACTION_SPACING = 8;
/** Gap between the floating buttons and the nav bar / keyboard below them. */
export const FLOATING_ACTION_BOTTOM_GAP = 18;

export type FabSide = 'left' | 'right';

/** Where the inline button row sits inside the scroll content. */
export type RowLayout = { y: number; height: number };

/**
 * Is the WHOLE inline button row inside the part of the scroll viewport the
 * user can actually see?
 *
 * The overlay is drawn edge-to-edge, so the scroll viewport runs to the bottom
 * of the window and the keyboard (whose height is measured from the screen
 * bottom, see hooks/useKeyboardHeight) covers its lower part. The visible band
 * is therefore [scrollY, scrollY + viewportHeight - keyboardHeight].
 *
 * Unmeasured (no row layout or viewport yet) counts as visible, so the floating
 * pair never flashes up before the first layout pass.
 */
export function isRowFullyVisible(args: {
    row: RowLayout | null;
    scrollY: number;
    viewportHeight: number;
    keyboardHeight: number;
}): boolean {
    const { row, scrollY, viewportHeight, keyboardHeight } = args;
    if (!row || viewportHeight <= 0) return true;
    const visibleTop = scrollY;
    const visibleBottom = scrollY + viewportHeight - keyboardHeight;
    return row.y >= visibleTop && row.y + row.height <= visibleBottom;
}

/**
 * Horizontal placement of the floating pair. Back always sits LEFT of Save,
 * the same order as the inline row, whichever side the user picked for their
 * FAB (`fab_position`). The pair hugs that side: on the right, Save is at the
 * edge and Back is inward; on the left, Back is at the edge and Save inward.
 */
export function floatingActionOffsets(side: FabSide): {
    back: { left: number } | { right: number };
    save: { left: number } | { right: number };
} {
    const edge = FLOATING_ACTION_EDGE_GAP;
    const inward = FLOATING_ACTION_EDGE_GAP + FLOATING_ACTION_SIZE + FLOATING_ACTION_SPACING;
    return side === 'left'
        ? { back: { left: edge }, save: { left: inward } }
        : { back: { right: inward }, save: { right: edge } };
}

/**
 * Bottom offset of the floating pair: clear of the nav bar, or of the keyboard
 * when it is up (its height already includes the nav bar area).
 */
export function floatingActionBottom(bottomInset: number, keyboardHeight: number): number {
    return Math.max(bottomInset, keyboardHeight) + FLOATING_ACTION_BOTTOM_GAP;
}
