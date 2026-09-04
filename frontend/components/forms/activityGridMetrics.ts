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

/* ─────────────────────────────────────────────────────────────────────────────
 * LABEL SIZING, a chip label must never break INSIDE a word.
 *
 * Pixel 3 QA, 2026-09-04 (store capture `10-entry-form.png`): "Unmotivated"
 * rendered as "Unmotivate / d" and "Overwhelmed" as "Overwhelm / ed". The chip
 * cell is ~59dp wide, the label is 11dp, and `numberOfLines={2}` lets Android
 * break a word that cannot fit one line, so any label with a word longer than
 * ~10 characters shreds, and a user-created activity name can be any length.
 *
 * `adjustsFontSizeToFit` does NOT fix this and is not used here. Android's
 * autosize only shrinks text that OVERFLOWS the allowed lines, and a mid-word
 * break means the text already "fits" two lines, so it never engages on the
 * exact case that is broken. (It also has a live history of Android defects
 * when combined with an explicit `lineHeight`: RN #43104 text missing / not
 * resized, #30717, #47045.)
 *
 * Instead the shrink is computed deterministically, on the JS side, from an
 * estimate of the label's width: cheap, synchronous, unit-testable, and
 * identical on every render. The ladder is
 *   1. longest word fits one line at the base size  -> base size, 2 lines
 *      (multi-word names still wrap at the SPACE, e.g. "Social / event")
 *   2. it doesn't                                   -> shrink to the largest
 *      half-point size at which it does, floored at `MIN_FONT_SCALE`
 *   3. it still doesn't at the floor                -> one line, ellipsized
 *      (a single absurd word, e.g. a pasted sentence with no spaces)
 * `lineHeight` and the label's `minHeight` never change, so a shrunk chip is
 * exactly as tall as its neighbours and grid rows stay aligned.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Horizontal gap between chip columns. Mirrors `columnGap` on the `Sortable.Grid`. */
export const ACTIVITY_GRID_COLUMN_GAP = 8;

/**
 * Horizontal space consumed OUTSIDE the chip columns, per side: the entry
 * form's content container (`paddingHorizontal: 20` in `EntryForm`) plus the
 * grid's own `paddingHorizontal: 12`. Verified against the Pixel 3 capture, 
 * the first chip's centre sits 61.7dp from the left edge of a 392.7dp window,
 * i.e. 32dp of inset + half a cell.
 *
 * Only the label's font size depends on it, and only through a `Math.min`, so
 * an inset that drifts by a few dp shrinks a label slightly more or less. It
 * can never change a row's height or unreserve the grid.
 */
export const ACTIVITY_GRID_HORIZONTAL_INSET = 32;

/** Base label size (dp). The style's `fontSize`; the OS font scale is applied on top. */
export const ACTIVITY_CHIP_LABEL_FONT_SIZE = 11;

/**
 * Never RENDER a label below this fraction of the base size, a legibility
 * floor, so the escape hatch from an unfittable word is truncation, not
 * microtype. It is a floor on the rendered size, not on the style's `fontSize`:
 * at an OS font scale of 1.3 the style may legitimately drop to 6.35 because
 * React Native multiplies it back up to the same 8.25dp on screen.
 */
export const ACTIVITY_CHIP_LABEL_MIN_FONT_SCALE = 0.75;

/** Fraction of the cell a label may occupy, breathing room + estimator slack. */
export const ACTIVITY_CHIP_LABEL_FILL = 0.95;

/** Shrunk sizes are quantised DOWN to this step, so neighbouring chips agree more often. */
export const ACTIVITY_CHIP_LABEL_FONT_STEP = 0.5;

/** Width of one chip cell (dp) for a given window width. */
export const activityChipCellWidth = (windowWidth: number): number => {
    const content =
        windowWidth -
        2 * ACTIVITY_GRID_HORIZONTAL_INSET -
        (ACTIVITY_GRID_COLUMNS - 1) * ACTIVITY_GRID_COLUMN_GAP;
    return Math.max(0, content / ACTIVITY_GRID_COLUMNS);
};

/**
 * Per-character advance widths as a fraction of the font size, bucketed from
 * Roboto's metrics (the RN Android default). Estimating rather than measuring
 * is deliberate: a real measurement is async and would arrive a frame late,
 * which is the whole class of bug `activityGridReservedHeight` exists to avoid.
 * The buckets run slightly WIDE, so the estimate errs towards shrinking a
 * label that would just barely have fitted rather than shredding one that
 * doesn't. Checked against the Pixel 3 capture: "Frustrated" 4.7em estimated /
 * 4.6em measured (fits, unchanged), "Unmotivated" 5.74 / 5.72 (shrinks).
 */
const CHAR_EM_NARROWEST = 0.26; // i l j I and thin punctuation
const CHAR_EM_NARROW = 0.34; // t f r
const CHAR_EM_SPACE = 0.26;
const CHAR_EM_DIGIT = 0.57;
const CHAR_EM_UPPER = 0.65;
const CHAR_EM_WIDE = 0.85; // m w M W
const CHAR_EM_DEFAULT = 0.55;

const NARROWEST_CHARS = new Set("iljI|!.,;:'`()[]{}-".split(''));
const NARROW_CHARS = new Set('tfr'.split(''));
const WIDE_CHARS = new Set('mwMW@%'.split(''));

const charWidthEm = (char: string): number => {
    if (char === ' ') return CHAR_EM_SPACE;
    if (WIDE_CHARS.has(char)) return CHAR_EM_WIDE;
    if (NARROWEST_CHARS.has(char)) return CHAR_EM_NARROWEST;
    if (NARROW_CHARS.has(char)) return CHAR_EM_NARROW;
    if (char >= '0' && char <= '9') return CHAR_EM_DIGIT;
    if (char >= 'A' && char <= 'Z') return CHAR_EM_UPPER;
    return CHAR_EM_DEFAULT;
};

/** Estimated width of `text` in ems (multiply by the font size for dp). */
export const estimateTextWidthEm = (text: string): number =>
    [...text].reduce((sum, char) => sum + charWidthEm(char), 0);

/** The widest whitespace-delimited word in `name`, in ems. */
export const longestWordWidthEm = (name: string): number =>
    name
        .split(/\s+/)
        .filter(Boolean)
        .reduce((widest, word) => Math.max(widest, estimateTextWidthEm(word)), 0);

export type ActivityChipLabelLayout = {
    /** dp, before the OS font scale is applied by React Native. */
    fontSize: number;
    numberOfLines: number;
};

/**
 * Font size + line cap for one chip label. See the ladder documented above.
 *
 * `fontScale` is the OS accessibility font scale: React Native multiplies the
 * style's `fontSize` by it at render time while the cell stays a fixed dp
 * width, so a larger scale eats the same budget and the style size drops
 * further, the label still honours the user's font preference as far as the
 * cell allows (it renders LARGER than at scale 1 for as long as it can), and it
 * still never breaks a word. `allowFontScaling` therefore stays on.
 */
export const activityChipLabelLayout = (
    name: string,
    cellWidth: number,
    fontScale = 1
): ActivityChipLabelLayout => {
    const base = ACTIVITY_CHIP_LABEL_FONT_SIZE;
    const floor = base * ACTIVITY_CHIP_LABEL_MIN_FONT_SCALE;
    const wordEm = longestWordWidthEm(name);
    // No text, no cell width (SSR/first render on an unmeasured window), or a
    // degenerate estimate: leave the label exactly as it renders today.
    if (wordEm <= 0 || cellWidth <= 0) {
        return { fontSize: base, numberOfLines: ACTIVITY_CHIP_LABEL_LINES };
    }

    const budget = cellWidth * ACTIVITY_CHIP_LABEL_FILL;
    // React Native multiplies the style's fontSize by the OS scale, so the sizes
    // are reasoned about as RENDERED dp and converted back at the end.
    const scale = Math.max(1, fontScale);
    const renderedFits = budget / wordEm;
    if (renderedFits >= base * scale) {
        return { fontSize: base, numberOfLines: ACTIVITY_CHIP_LABEL_LINES };
    }

    const step = ACTIVITY_CHIP_LABEL_FONT_STEP;
    const quantised = Math.floor(renderedFits / scale / step) * step;
    if (quantised * scale < floor) {
        // Last resort: one absurd word (a pasted sentence with no spaces).
        // One line + the default tail ellipsis beats a word sliced across two.
        return { fontSize: floor / scale, numberOfLines: 1 };
    }
    return { fontSize: quantised, numberOfLines: ACTIVITY_CHIP_LABEL_LINES };
};
