/**
 * Pure decision helper for multi-photo selection in the entry form.
 *
 * Extracted from PhotoAttachments so the "given what's already attached + what
 * the user just picked + the cap, which URIs do we add and did we hit the
 * limit?" logic is unit-testable without the native image picker.
 *
 * Rules (all enforced HERE, never trusted to the OS picker — `selectionLimit` is
 * best-effort on some Android pickers, so the cap must hold regardless):
 *   1. Never let the total exceed `max`. Remaining = max - currentPhotos.length.
 *   2. Dedupe: drop any picked URI already attached (in currentPhotos) and any
 *      duplicate within the picked batch — keeping first-seen order.
 *   3. `limitHit` is true when the user picked MORE *new* photos than the
 *      remaining slots could hold (i.e. some new picks were dropped purely
 *      because of the cap) — so the caller can surface a "limit reached" notice.
 *      Picking exactly the remaining count is NOT a limit hit.
 */
export function selectPhotosToAdd(
    currentPhotos: string[],
    pickedUris: string[],
    max: number,
): { toAdd: string[]; limitHit: boolean } {
    const remaining = Math.max(0, max - currentPhotos.length);
    const already = new Set(currentPhotos);

    // New, de-duplicated picks in first-seen order (excludes anything already
    // attached and any repeat inside the batch).
    const seen = new Set<string>();
    const newUnique: string[] = [];
    for (const uri of pickedUris) {
        if (already.has(uri) || seen.has(uri)) continue;
        seen.add(uri);
        newUnique.push(uri);
    }

    const toAdd = newUnique.slice(0, remaining);
    // Limit hit only when genuinely-new picks were dropped because of the cap.
    const limitHit = newUnique.length > remaining;

    return { toAdd, limitHit };
}
