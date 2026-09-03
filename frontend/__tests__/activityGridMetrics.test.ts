/**
 * Activity chip-grid metrics — the height the entry form reserves for each
 * group's `Sortable.Grid`.
 *
 * REGRESSION CONTEXT (Pixel 3 QA, 2026-09-03): the grid reserved ~0dp of layout
 * height until its async measurement pass landed, so every group's chips painted
 * on top of the NEXT group's header. Measured off the capture: all five group
 * headers sat a uniform 72.7dp apart (i.e. grid height ≈ 0.7dp) where one row of
 * chips needs 78dp. The section now reserves the height itself from the item
 * count, which is knowable synchronously — these tests lock that arithmetic.
 */
import {
    ACTIVITY_CHIP_CIRCLE_SIZE,
    ACTIVITY_CHIP_LABEL_BLOCK,
    ACTIVITY_CHIP_LABEL_GAP,
    ACTIVITY_CHIP_LABEL_LINE_HEIGHT,
    ACTIVITY_CHIP_LABEL_LINES,
    ACTIVITY_GRID_COLUMNS,
    ACTIVITY_GRID_ROW_GAP,
    activityChipHeight,
    activityGridReservedHeight,
    activityGridRowCount,
} from '@/components/forms/activityGridMetrics';

describe('row counting', () => {
    it('reserves nothing for a group with no activities', () => {
        expect(activityGridRowCount(0)).toBe(0);
        expect(activityGridReservedHeight(0)).toBe(0);
    });

    it('fills a row before starting the next one', () => {
        for (let n = 1; n <= ACTIVITY_GRID_COLUMNS; n++) {
            expect(activityGridRowCount(n)).toBe(1);
        }
        expect(activityGridRowCount(ACTIVITY_GRID_COLUMNS + 1)).toBe(2);
        expect(activityGridRowCount(ACTIVITY_GRID_COLUMNS * 3)).toBe(3);
        expect(activityGridRowCount(ACTIVITY_GRID_COLUMNS * 3 + 1)).toBe(4);
    });

    it('never returns a negative row count for nonsense input', () => {
        expect(activityGridRowCount(-4)).toBe(0);
        expect(activityGridReservedHeight(-4)).toBe(0);
    });
});

describe('reserved height', () => {
    it('is the chip stack plus the gaps between rows', () => {
        const chip = activityChipHeight();
        expect(chip).toBe(
            ACTIVITY_CHIP_CIRCLE_SIZE +
                ACTIVITY_CHIP_LABEL_GAP +
                ACTIVITY_CHIP_LABEL_LINES * ACTIVITY_CHIP_LABEL_LINE_HEIGHT
        );

        expect(activityGridReservedHeight(1)).toBe(chip);
        expect(activityGridReservedHeight(ACTIVITY_GRID_COLUMNS)).toBe(chip);
        expect(activityGridReservedHeight(ACTIVITY_GRID_COLUMNS + 1)).toBe(
            2 * chip + ACTIVITY_GRID_ROW_GAP
        );
        expect(activityGridReservedHeight(ACTIVITY_GRID_COLUMNS * 2 + 3)).toBe(
            3 * chip + 2 * ACTIVITY_GRID_ROW_GAP
        );
    });

    /**
     * CLASS-LEVEL INVARIANT, not a spot check: whatever the row-packing maths
     * does, adding an activity can never make a group's reserved space SMALLER —
     * that is the shape of the bug (content growing past reserved space) and it
     * has to be impossible for every count, not just the ones we thought of.
     */
    it('never shrinks as activities are added (0..60 chips)', () => {
        let previous = -1;
        for (let n = 0; n <= 60; n++) {
            const height = activityGridReservedHeight(n);
            expect(height).toBeGreaterThanOrEqual(previous);
            previous = height;
        }
    });

    /**
     * The other half of the same invariant: the reservation must cover the space
     * the chips actually occupy. Re-derived here from the raw constants rather
     * than by calling the helper, so a change to the helper that silently
     * under-reserves fails instead of agreeing with itself.
     */
    it('covers the space the chips actually stack into (0..60 chips)', () => {
        const chipStack =
            ACTIVITY_CHIP_CIRCLE_SIZE +
            ACTIVITY_CHIP_LABEL_GAP +
            ACTIVITY_CHIP_LABEL_BLOCK;

        for (let n = 0; n <= 60; n++) {
            const rows = Math.ceil(Math.max(0, n) / ACTIVITY_GRID_COLUMNS);
            const needed =
                rows === 0 ? 0 : rows * chipStack + (rows - 1) * ACTIVITY_GRID_ROW_GAP;
            expect(activityGridReservedHeight(n)).toBeGreaterThanOrEqual(needed);
        }
    });
});

describe('accessibility font scale', () => {
    it('reserves more room when the OS font is scaled up', () => {
        expect(activityGridReservedHeight(7, 2)).toBeGreaterThan(
            activityGridReservedHeight(7, 1)
        );
        // The scale applies to the label box only — the icon circle is a fixed dp box.
        expect(activityChipHeight(2)).toBe(
            ACTIVITY_CHIP_CIRCLE_SIZE +
                ACTIVITY_CHIP_LABEL_GAP +
                ACTIVITY_CHIP_LABEL_BLOCK * 2
        );
    });

    it('does not reserve LESS when the OS font is scaled down', () => {
        // The label's two-line floor is a dp minHeight, which the OS font scale
        // does not shrink — so a sub-1 scale must not shrink the reservation
        // below the rendered box either.
        expect(activityGridReservedHeight(7, 0.85)).toBe(
            activityGridReservedHeight(7, 1)
        );
    });
});
