/**
 * Class-level invariant: EVERY UI module that performs a database write must
 * also broadcast the "data changed" signal.
 *
 * WHY. SoulSync has now shipped this bug three times, each time on a different
 * write path and each time reported as "the screen shows stale data after I
 * changed something":
 *   - adding a mood entry (reported 2026-06-26, root-caused + fixed 2026-07-13
 *     by replacing a DataContext `refreshCount` with the external
 *     `dataRefreshStore`, see context/dataRefreshStore.ts for why a context
 *     value never reached the tab screens),
 *   - creating an activity or renaming/reordering/deleting an activity group
 *     from the entry form, which reloaded ONLY the selector's own list and left
 *     Home's "Recent activities" and "Explore your activities" on the old
 *     catalogue until the user navigated away and back,
 *   - syncing or clearing Health Connect data, which left the Statistics and
 *     Insights health charts drawing rows that no longer existed.
 *
 * The common shape is a call site that updates its OWN state after a write and
 * forgets that other screens render the same rows. Reviewing call sites has not
 * caught it, so this test enumerates them instead: it discovers the write
 * functions from the database layer itself (any exported async function whose
 * body mutates), finds every screen/component that calls one, and fails unless
 * that module broadcasts. A NEW write path fails the build until it does.
 *
 * Source-scan verdict (lane D): KEEP. "Every caller of a write also broadcasts"
 * is a cross-file shape no compiler or single behavioural test sees.
 * Bug commit: 1c050b8.
 */
import { code, listSourceFiles, readSource } from '@/testing/sourceScan';

/**
 * Modules whose writes deliberately do NOT broadcast, each with the reason.
 * An entry here is a claim that must stay true, so each is asserted below.
 */
const EXEMPT: Record<string, string> = {
    // Signals through its `onChanged` prop instead of reaching for the context
    // itself; DBViewer (its only mounting point) wires that to refetchEntries.
    'components/timeline/RecentlyDeletedPanel.tsx':
        'broadcasts via its onChanged prop, wired to refetchEntries by DBViewer',
    // Dev-only seed/clear helper. Its callers (the __DEV__ Settings sections)
    // broadcast after invoking it.
    'components/generateData.ts':
        'dev-only helper; its __DEV__ Settings callers broadcast',
};

/**
 * `user_settings` rows are not data any chart renders, settings propagate
 * through SettingsContext, which re-renders consumers on its own. Including
 * them here would demand a data-version bump for every theme toggle.
 */
const NON_DATA_DB_MODULES = ['user-settings.ts'];

/** Exported async functions in databases/ whose body mutates the database. */
const writeFunctions = (): string[] => {
    const names = new Set<string>();
    for (const file of listSourceFiles(['databases'])) {
        if (NON_DATA_DB_MODULES.some(m => file.endsWith(m))) continue;
        const src = code(file);
        // Split on top-level `export async function` declarations and keep the
        // body up to the next one; a body containing DML (or our write
        // primitive) makes that function a write.
        const parts = src.split(/export async function\s+/).slice(1);
        for (const part of parts) {
            const name = part.match(/^(\w+)/)?.[1];
            if (!name) continue;
            if (/\b(INSERT|UPDATE|DELETE)\s|withWriteTransaction|runAsync\(/i.test(part)) {
                names.add(name);
            }
        }
    }
    return [...names];
};

/**
 * What counts as broadcasting. `bumpDataVersion` is the store primitive and
 * `refetchEntries` the context handle; `broadcastWrite` is DBViewer's stable
 * wrapper over the latter (it exists so the Timeline's memoized entry-card
 * callbacks don't carry a context value in their dependency lists — see the note
 * in DBViewer). A wrapper is only trustworthy if it is still wired to the real
 * signal, so the exemption test below asserts that chain rather than taking the
 * name on faith.
 */
const BROADCAST = /refetchEntries|bumpDataVersion|broadcastWrite/;

describe('every UI write path broadcasts the data-refresh signal', () => {
    const writes = writeFunctions();

    it('discovers the database write functions (guards against a vacuous sweep)', () => {
        // If the discovery regex ever stops matching, every assertion below
        // would pass trivially. Anchor it on writes we know exist.
        expect(writes.length).toBeGreaterThan(8);
        for (const known of ['addMoodEntry', 'updateMoodEntry', 'deleteMoodEntry', 'addActivity']) {
            expect(writes).toContain(known);
        }
    });

    it('every screen/component calling a write also broadcasts', () => {
        const offenders: string[] = [];
        for (const rel of listSourceFiles(['app', 'components'])) {
            const src = code(rel);
            const called = writes.filter(fn => new RegExp(`\\b${fn}\\s*\\(`).test(src));
            if (called.length === 0) continue;
            if (rel in EXEMPT) continue;
            if (BROADCAST.test(src)) continue;
            offenders.push(`${rel} calls ${called.join(', ')} but never broadcasts`);
        }

        expect(offenders).toEqual([]);
    });

    it('each exemption still holds', () => {
        // RecentlyDeletedPanel must genuinely take and call an onChanged prop...
        const panel = readSource('components/timeline/RecentlyDeletedPanel.tsx');
        expect(panel).toMatch(/onChanged\s*:\s*\(\)\s*=>\s*void/);
        expect(panel).toMatch(/onChanged\(\)/);

        // ...and DBViewer, its only mounting point, must wire that to a broadcast.
        const viewer = readSource('components/DBViewer.tsx');
        expect(viewer).toMatch(/<RecentlyDeletedPanel/);
        const onChangedProp = viewer.slice(viewer.indexOf('<RecentlyDeletedPanel'));
        expect(onChangedProp.slice(0, 600)).toMatch(BROADCAST);

        // DBViewer broadcasts through its own `broadcastWrite` wrapper, so prove the
        // wrapper is still CONNECTED to the real signal. Without this the regex
        // above would accept a `broadcastWrite` that had been quietly turned into a
        // no-op, and every Timeline write would stop reaching the other screens with
        // the whole sweep still green.
        const stripped = code('components/DBViewer.tsx');
        expect(stripped).toMatch(/const\s+broadcastWrite\s*=[\s\S]{0,120}?refetchEntries/);
        expect(stripped).toMatch(/const\s*\{\s*refetchEntries\s*\}\s*=\s*useDataContext\(\)/);

        // Every exempt path must still exist, so a rename cannot silently
        // retire an exemption and take its write out of the sweep with it.
        for (const rel of Object.keys(EXEMPT)) {
            expect(() => readSource(rel)).not.toThrow();
        }
    });
});
