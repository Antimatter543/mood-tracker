// photoLayout.ts
//
// Pure layout decision for an entry's photos in the Timeline. A single photo
// renders as one large hero image; multiple photos render as a horizontal strip
// of square thumbnails. Extracted so the rule is unit-testable and the card
// component stays a thin renderer.

export type PhotoLayout =
    | { kind: 'none' }
    | { kind: 'single' }
    | { kind: 'grid' };

/**
 * Decide how to lay out `count` photos.
 *   0  -> none   (render nothing)
 *   1  -> single (one full-width hero image)
 *   2+ -> grid   (horizontal strip of thumbnails)
 *
 * A negative/garbage count is treated as 0.
 */
export const photoLayoutFor = (count: number): PhotoLayout => {
    if (!Number.isFinite(count) || count <= 0) return { kind: 'none' };
    if (count === 1) return { kind: 'single' };
    return { kind: 'grid' };
};
