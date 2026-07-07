/**
 * Pure, unit-testable filter builder for the Timeline list.
 *
 * The Timeline is server-PAGINATED (SQL LIMIT/OFFSET, 20/page), so any search /
 * mood filter MUST run in SQL — a client-side filter would only ever see the
 * rows currently loaded (~20), never the whole table. This module turns a UI
 * filter state into a parameterised WHERE fragment (no leading 'WHERE') that
 * DBViewer splices into its paged CTE, plus the ordered params. It is
 * React/SQLite-free so it can be exhaustively jest-tested without a DB.
 */

export type MoodRange = { min: number; max: number };
export type EntryFilters = { query: string; moodRange: MoodRange | null };
export type BuiltFilter = { where: string; params: (string | number)[] };

export type MoodPresetKey = 'all' | 'low' | 'mid' | 'high';

// Mood presets. The mood domain is always 0–10 (REAL, half-step ticks: 0,0.5,…,10),
// so the labels must be HONEST about which tick lands in which band. Low is TRULY
// 0–3 (a 3.5 entry falls in Mid, NOT Low); Mid is symmetric around the Neutral(5)
// anchor (3.5–6.5); High is a clean 7–10. Half-steps force a `.5` boundary somewhere
// and Mid absorbs it — this is the only numeric scheme where every label matches its
// own range. The bands still TILE GAPLESSLY over the reachable ticks: every tick
// (0,0.5,…,10) lands in exactly one band — 3 in Low, 3.5 & 6.5 in Mid, 7 in High —
// nothing can slip between two adjacent bands.
export const MOOD_PRESETS: { key: MoodPresetKey; label: string; range: MoodRange | null }[] = [
    { key: 'all', label: 'All', range: null },
    { key: 'low', label: 'Low · 0–3', range: { min: 0, max: 3 } },
    { key: 'mid', label: 'Mid · 3.5–6.5', range: { min: 3.5, max: 6.5 } },
    { key: 'high', label: 'High · 7–10', range: { min: 7, max: 10 } },
];

export function moodPresetToRange(key: MoodPresetKey): MoodRange | null {
    return MOOD_PRESETS.find(p => p.key === key)?.range ?? null;
}

/**
 * Escape the LIKE metacharacters in a user query so a literal '%' or '_' the
 * user types is matched literally rather than as a wildcard. Backslash is
 * escaped FIRST so the backslashes we add for '%'/'_' aren't themselves doubled,
 * and so '\' can serve as the ESCAPE character. Pairs with `LIKE ? ESCAPE '\'`.
 */
function escapeLike(raw: string): string {
    return raw
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
}

// The text-search clause. A match in the notes OR in ANY of the entry's activity
// names includes the entry. The activity match is a correlated EXISTS on `e.id`;
// its aliases (`ea2`/`a2`) are deliberately distinct from the outer query's
// `ea`/`a` so it can be spliced into the paged CTE without an alias collision.
const TEXT_CLAUSE =
    "(e.notes LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM entry_activities ea2 " +
    "JOIN activities a2 ON ea2.activity_id = a2.id WHERE ea2.entry_id = e.id " +
    "AND a2.name LIKE ? ESCAPE '\\'))";

/**
 * Build a parameterised WHERE fragment (WITHOUT the leading 'WHERE') referencing
 * the entries table alias `e`, plus its ordered params. Returns
 * `{ where: '', params: [] }` when there is nothing to filter.
 *
 * Clause order — and therefore param order — is: text query first, then mood
 * range. Active clauses are joined with ' AND '.
 */
export function buildEntryFilter(filters: EntryFilters): BuiltFilter {
    const clauses: string[] = [];
    const params: (string | number)[] = [];

    const query = filters.query.trim();
    if (query !== '') {
        const pattern = `%${escapeLike(query)}%`;
        clauses.push(TEXT_CLAUSE);
        // Same escaped pattern twice: once for the notes LIKE, once for the
        // activity-name LIKE inside the EXISTS.
        params.push(pattern, pattern);
    }

    if (filters.moodRange) {
        clauses.push('e.mood >= ? AND e.mood <= ?');
        params.push(filters.moodRange.min, filters.moodRange.max);
    }

    return { where: clauses.join(' AND '), params };
}
