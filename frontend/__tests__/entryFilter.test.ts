/**
 * Unit tests for the Timeline SQL filter builder (pure — no DB, no React).
 *
 * These guard the CONTRACT that DBViewer's paged CTE relies on:
 *   - the exact WHERE fragment text (aliases `e` / `ea2` / `a2`, ESCAPE clause),
 *   - param COUNT and ORDER (query params first, then mood range),
 *   - LIKE-wildcard escaping so a literal '%'/'_'/'\' the user types is matched
 *     literally, never as a wildcard,
 *   - whitespace-only queries collapsing to "no filter",
 *   - the mood-preset -> range mapping.
 */
import {
    buildEntryFilter,
    moodPresetToRange,
    MOOD_PRESETS,
    EntryFilters,
} from '@/components/timeline/entryFilter';

// The exact text clause the builder emits (single backslash in the runtime
// string — `'\\'` in this literal is one backslash). Must stay byte-identical to
// entryFilter.ts so a drift is caught here, not on-device.
const TEXT_CLAUSE =
    "(e.notes LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM entry_activities ea2 " +
    "JOIN activities a2 ON ea2.activity_id = a2.id WHERE ea2.entry_id = e.id " +
    "AND a2.name LIKE ? ESCAPE '\\'))";

const MOOD_CLAUSE = 'e.mood >= ? AND e.mood <= ?';

const filters = (over: Partial<EntryFilters> = {}): EntryFilters => ({
    query: '',
    moodRange: null,
    ...over,
});

describe('buildEntryFilter — empty', () => {
    it('returns an empty filter when there is no query and no mood range', () => {
        expect(buildEntryFilter(filters())).toEqual({ where: '', params: [] });
    });

    it('treats a whitespace-only query as empty', () => {
        expect(buildEntryFilter(filters({ query: '   \t\n ' }))).toEqual({
            where: '',
            params: [],
        });
    });
});

describe('buildEntryFilter — query only', () => {
    it('emits the text clause and pushes the escaped pattern TWICE', () => {
        const built = buildEntryFilter(filters({ query: 'foo' }));
        expect(built.where).toBe(TEXT_CLAUSE);
        // Same %-wrapped pattern for notes AND activity name.
        expect(built.params).toEqual(['%foo%', '%foo%']);
    });

    it('trims surrounding whitespace before wrapping', () => {
        const built = buildEntryFilter(filters({ query: '  gym  ' }));
        expect(built.params).toEqual(['%gym%', '%gym%']);
    });
});

describe('buildEntryFilter — LIKE wildcard escaping', () => {
    it('escapes a literal percent (50% -> 50\\%)', () => {
        const built = buildEntryFilter(filters({ query: '50%' }));
        // '%50\\%%' -> %, 5, 0, \, %, %
        expect(built.params).toEqual(['%50\\%%', '%50\\%%']);
    });

    it('escapes a literal underscore (a_b -> a\\_b)', () => {
        const built = buildEntryFilter(filters({ query: 'a_b' }));
        expect(built.params).toEqual(['%a\\_b%', '%a\\_b%']);
    });

    it('escapes a literal backslash first (a\\b -> a\\\\b)', () => {
        const built = buildEntryFilter(filters({ query: 'a\\b' }));
        // '%a\\\\b%' -> %, a, \, \, b, %
        expect(built.params).toEqual(['%a\\\\b%', '%a\\\\b%']);
    });

    it('escapes a backslash BEFORE the metachar it precedes (\\% stays two literals)', () => {
        const built = buildEntryFilter(filters({ query: '\\%' }));
        // backslash -> \\, then % -> \% ==> \\\% wrapped: %\\\%%
        expect(built.params).toEqual(['%\\\\\\%%', '%\\\\\\%%']);
    });
});

describe('buildEntryFilter — mood range only', () => {
    it.each([
        ['low', 0, 3.5],
        ['mid', 4, 6.5],
        ['high', 7, 10],
    ] as const)('%s preset yields the BETWEEN params [%d, %d]', (key, min, max) => {
        const range = moodPresetToRange(key);
        const built = buildEntryFilter(filters({ moodRange: range }));
        expect(built.where).toBe(MOOD_CLAUSE);
        expect(built.params).toEqual([min, max]);
    });

    it('emits only the mood clause when query is whitespace-only', () => {
        const built = buildEntryFilter(
            filters({ query: '   ', moodRange: { min: 4, max: 6.5 } })
        );
        expect(built.where).toBe(MOOD_CLAUSE);
        expect(built.params).toEqual([4, 6.5]);
    });
});

describe('buildEntryFilter — combined query + mood', () => {
    it('joins both clauses with AND, query params FIRST then mood params', () => {
        const built = buildEntryFilter(
            filters({ query: 'run', moodRange: { min: 7, max: 10 } })
        );
        expect(built.where).toBe(`${TEXT_CLAUSE} AND ${MOOD_CLAUSE}`);
        expect(built.params).toEqual(['%run%', '%run%', 7, 10]);
    });
});

describe('moodPresetToRange', () => {
    it('maps every preset key to its declared range', () => {
        expect(moodPresetToRange('all')).toBeNull();
        expect(moodPresetToRange('low')).toEqual({ min: 0, max: 3.5 });
        expect(moodPresetToRange('mid')).toEqual({ min: 4, max: 6.5 });
        expect(moodPresetToRange('high')).toEqual({ min: 7, max: 10 });
    });

    it('stays in sync with MOOD_PRESETS (single source of truth)', () => {
        for (const preset of MOOD_PRESETS) {
            expect(moodPresetToRange(preset.key)).toEqual(preset.range);
        }
    });

    it('bands (low/mid/high) cover every half-step mood value 0–10 exactly once', () => {
        expect(MOOD_PRESETS.map(p => p.key)).toEqual(['all', 'low', 'mid', 'high']);
        const bands = MOOD_PRESETS.filter(p => p.range).map(p => p.range!);
        // Half-step ticks are the only REACHABLE mood values, so the class-level
        // invariant isn't continuous tiling — the (3.5,4) / (6.5,7) intervals hold
        // no tick — it's that every reachable value falls in exactly one band
        // (gapless AND non-overlapping on the actual domain).
        for (let v = 0; v <= 10.0001; v += 0.5) {
            const tick = Math.round(v * 2) / 2;
            const hits = bands.filter(r => tick >= r.min && tick <= r.max);
            expect(hits).toHaveLength(1);
        }
        expect(MOOD_PRESETS[1].range).toEqual({ min: 0, max: 3.5 });
        expect(MOOD_PRESETS[3].range).toEqual({ min: 7, max: 10 });
    });
});
