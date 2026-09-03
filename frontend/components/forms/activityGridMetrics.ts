/**
 * Activity-chip grid metrics — the ONE source of truth for how tall a group's
 * activity grid is.
 *
 * WHY THIS EXISTS
 * ---------------
 * The chips are laid out by `react-native-sortables`' `Sortable.Grid`, which does
 * NOT size itself the way a normal flex-wrap `View` does. It measures every item
 * asynchronously and then switches into an ABSOLUTE layout whose container height
 * is a shared value (`containerHeight`, initially `0`/`null`). Until a full
 * measurement pass lands, the grid occupies ~0dp of layout height while still
 * PAINTING its chips (the library's default `overflow` is `'visible'`), so the
 * chips spill downwards and the next group's header renders on top of them.
 *
 * On the Pixel 3 that window is plainly visible: measured off the QA capture,
 * every group's grid contributed 0.7dp of height instead of the 78dp one row of
 * chips actually needs, so all five group headers sat a uniform 72.7dp apart with
 * the chips drawn across them.
 *
 * So the section reserves the space itself: the chip is a fixed, known size, which
 * makes every row the same height and lets the grid's height be derived from the
 * item count alone — synchronously, on the very first render, with no measurement
 * involved. The reservation is a `minHeight`, so it only ever guarantees a floor;
 * the grid is still free to grow.
 *
 * KEEP THE STYLES AND THE MATH TOGETHER: `ActivitySelector` builds the chip styles
 * from these same constants, so the reservation cannot drift away from what is
 * actually rendered. `__tests__/activityGridMetrics.test.ts` locks that invariant.
 */

/** Chips per row. Mirrors `columns` on the `Sortable.Grid`. */
export const ACTIVITY_GRID_COLUMNS = 5;

/** Vertical space between chip rows. Mirrors `rowGap` on the `Sortable.Grid`. */
export const ACTIVITY_GRID_ROW_GAP = 8;

/** Diameter of the round icon button. */
export const ACTIVITY_CHIP_CIRCLE_SIZE = 52;

/** Space between the circle and its label (the chip wrapper's `gap`). */
export const ACTIVITY_CHIP_LABEL_GAP = 6;

/**
 * The label is capped at two lines (`numberOfLines={2}`) and floored at two lines
 * (`minHeight`), so a one-word chip and a two-word chip are exactly as tall as
 * each other. Without the floor, rows are ragged and the grid's height stops
 * being derivable from the item count.
 */
export const ACTIVITY_CHIP_LABEL_LINES = 2;

/** Explicit so the label's height is a known number rather than a platform default. */
export const ACTIVITY_CHIP_LABEL_LINE_HEIGHT = 15;

/** Height of the two-line label box at the OS default font scale. */
export const ACTIVITY_CHIP_LABEL_BLOCK =
    ACTIVITY_CHIP_LABEL_LINES * ACTIVITY_CHIP_LABEL_LINE_HEIGHT;

/**
 * Height of one chip at a given OS font scale.
 *
 * React Native scales `fontSize` and `lineHeight` by the accessibility font scale
 * but leaves `minHeight` (a dp value) alone, so the label box is the LARGER of the
 * two — hence `Math.max(1, fontScale)`. That keeps the reservation correct when a
 * user has bumped their system font size instead of quietly under-reserving.
 */
export const activityChipHeight = (fontScale = 1): number =>
    ACTIVITY_CHIP_CIRCLE_SIZE +
    ACTIVITY_CHIP_LABEL_GAP +
    ACTIVITY_CHIP_LABEL_BLOCK * Math.max(1, fontScale);

/** Rows needed to lay out `itemCount` chips. */
export const activityGridRowCount = (itemCount: number): number =>
    itemCount <= 0 ? 0 : Math.ceil(itemCount / ACTIVITY_GRID_COLUMNS);

/**
 * Layout height to reserve for a group's chip grid. An empty group reserves
 * nothing (its grid genuinely has no content to spill).
 */
export const activityGridReservedHeight = (
    itemCount: number,
    fontScale = 1
): number => {
    const rows = activityGridRowCount(itemCount);
    if (rows === 0) return 0;
    return (
        rows * activityChipHeight(fontScale) +
        (rows - 1) * ACTIVITY_GRID_ROW_GAP
    );
};
