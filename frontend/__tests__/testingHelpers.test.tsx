/**
 * Pins the shared test helpers in frontend/testing/ to production.
 *
 * Every builder default is DERIVED from a production source; these tests fail
 * the moment the two drift (a builder edited by hand, or production changing a
 * default the fixtures silently kept). They also prove the shared platform
 * mocks are live in every suite, that the real-SQLite gate fails loudly on CI,
 * and that no app code ever imports the test helpers.
 */
import { code, listSourceFiles } from '@/testing/sourceScan';
import React from 'react';
import { render, renderHook } from '@testing-library/react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import {
    FIXED_DAY,
    FIXED_NOW,
    addDays,
    dayKey,
    dayKeys,
    localAt,
    localIso,
    localMidnight,
    makeActivity,
    makeEntries,
    makeEntry,
    makeEntryRow,
    makeGroup,
    makeHealthDay,
    makePhoto,
    makeReminder,
    seedActivity,
    seedGroup,
    SHIPPED_SEED_RENAMES,
} from '@/testing/builders';
import { deferred } from '@/testing/async';
import { makeDb, resetWriteLayer, sqlCalls, sqlParams } from '@/testing/fakeDb';
import {
    DatabaseSync,
    countRows,
    describeSqlite,
    openMigratedSqlite,
    openSqlite,
    sqliteSuiteMode,
    type SqliteAdapter,
} from '@/testing/realSqlite';
import { THEME, defaultThemeName, mockThemeModule, themeTokens } from '@/testing/theme';
import {
    INSETS,
    animatedScroll,
    currentInsets,
    setInsets,
    setKeyboardHeight,
} from '@/testing/platform';
import { countByType, styleOf, svgStrings } from '@/testing/rntl';

import { DEFAULT_DRAFT } from '@/components/forms/hooks/useEntryDraft';
import { initialActivities, initialActivityGroups } from '@/components/seedData';
import { MEDIA_DIR } from '@/databases/mediaHelpers';
import { addReminder } from '@/lib/reminders';
import { HEALTH_CONNECT_SOURCE } from '@/lib/healthConnectConfig';
import { themeColors } from '@/styles/global';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { __setWriteConnectionForTests } from '@/databases/writeTransaction';
import { getEntriesWindow, addMoodEntry } from '@/databases/entries';
import { upsertHealthMetrics, getHealthMetricsRange } from '@/databases/health-metrics';

// ── builders ────────────────────────────────────────────────────────────────

describe('builders derive their defaults from production', () => {
    it('makeEntry starts from the entry form default draft, saved at the fixed instant', () => {
        const e = makeEntry();
        expect(e.mood).toBe(DEFAULT_DRAFT.mood);
        expect(e.notes).toBe(DEFAULT_DRAFT.notes);
        expect(e.date).toBe(FIXED_NOW.toISOString());
        expect(e).toMatchObject({ activities: [], photos: [], starred_at: null });
        expect(makeEntry({ mood: 9 }).mood).toBe(9);
    });

    it('makeActivity is the first shipped seed activity', () => {
        const a = makeActivity();
        const s = initialActivities[0];
        expect(a).toMatchObject({ name: s.name, group_id: s.group_id, icon_name: s.icon_name, icon_family: s.icon_family });
        expect(makeActivity({ name: 'Read' }).name).toBe('Read');
    });

    it('makeGroup is the first shipped seed group; sort_order follows the id like the backfill', () => {
        expect(makeGroup().name).toBe(initialActivityGroups[0].name);
        expect(makeGroup({ id: 3 })).toMatchObject({ id: 3, sort_order: 3 });
        expect(makeGroup({ id: 3, sort_order: 9 }).sort_order).toBe(9);
    });

    it('seedActivity finds an activity by its shipped name or its v1 seed name', () => {
        expect(seedActivity('Social event')).toEqual(seedActivity('Event'));
        expect(seedActivity('Event').name).toBe(SHIPPED_SEED_RENAMES.Event);
        expect(() => seedActivity('No such activity')).toThrow(/no seed activity/);
    });

    it('makePhoto lives under the MEDIA_DIR the app sees', () => {
        expect(makePhoto().file_path.startsWith(MEDIA_DIR)).toBe(true);
        expect(makePhoto({ id: 7 }).file_path).toBe(`${MEDIA_DIR}photo-7.jpg`);
    });

    it('makePhoto follows a suite that mocks mediaHelpers, so the app keeps the photo instead of copying it', () => {
        jest.isolateModules(() => {
            jest.doMock('@/databases/mediaHelpers', () => ({ MEDIA_DIR: 'file:///media/' }));
            const b = require('@/testing/builders') as typeof import('@/testing/builders');
            expect(b.makePhoto({ id: 2 }).file_path).toBe('file:///media/photo-2.jpg');
        });
    });

    it('makeEntries numbers ids 1..n and ends on FIXED_DAY, one day apart', () => {
        const es = makeEntries(3, (i) => ({ mood: i + 4 }));
        expect(es.map((e) => e.id)).toEqual([1, 2, 3]);
        expect(es.map((e) => dayKey(new Date(e.date)))).toEqual([addDays(FIXED_DAY, -2), addDays(FIXED_DAY, -1), FIXED_DAY]);
        expect(es.map((e) => e.mood)).toEqual([4, 5, 6]);
    });

    it('makeReminder is what addReminder creates first', () => {
        expect(makeReminder()).toEqual(addReminder([])[0]);
    });

    it('makeHealthDay carries the Health Connect sync source', () => {
        expect(makeHealthDay().source).toBe(HEALTH_CONNECT_SOURCE);
    });

    it('makeEntryRow mirrors makeEntry', () => {
        const e = makeEntry();
        expect(makeEntryRow()).toMatchObject({ id: e.id, mood: e.mood, notes: e.notes, date: e.date });
    });
});

describe('date helpers (TZ pinned to Australia/Brisbane)', () => {
    it('localAt is local wall-clock time on a YYYY-MM-DD day', () => {
        const d = localAt('2026-06-15', 9, 30);
        expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 5, 15, 9, 30]);
        expect(localMidnight('2026-06-15').getHours()).toBe(0);
        expect(localIso('2026-06-15', 12)).toBe(localAt('2026-06-15').toISOString());
    });

    it('FIXED_NOW is local noon of FIXED_DAY', () => {
        expect(dayKey(FIXED_NOW)).toBe(FIXED_DAY);
        expect(FIXED_NOW.getHours()).toBe(12);
    });

    it('dayKeys and addDays step calendar days across month and year ends', () => {
        expect(dayKeys(3)).toEqual(['2026-06-13', '2026-06-14', FIXED_DAY]);
        expect(dayKeys(3, '2026-06-01')).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
        expect(dayKeys(2, '2026-12-31')).toEqual(['2026-12-31', '2027-01-01']);
        expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });

    it('rejects a day that is not YYYY-MM-DD instead of guessing', () => {
        expect(() => localAt('2026-6-1')).toThrow(/YYYY-MM-DD/);
    });

    it.each(['2026-02-30', '2026-00-31', '2026-13-01', '2026-04-31', '2025-02-29'])(
        'rejects the impossible day %s instead of rolling it into another month',
        (day) => {
            expect(() => localAt(day)).toThrow(/not a real calendar day/);
            expect(() => addDays(day, 0)).toThrow(/not a real calendar day/);
        }
    );

    it('accepts a real leap day', () => {
        expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    });
});

// ── fake DB ─────────────────────────────────────────────────────────────────

describe('fakeDb', () => {
    beforeEach(resetWriteLayer);

    it('scripts reads by SQL pattern and hands out incrementing ids', async () => {
        const db = makeDb({
            firstInsertId: 500,
            first: [[/FROM entries/, (params) => ({ id: params[0] })]],
            all: [[/FROM activities/, () => [{ id: 1 }]]],
        });
        expect(await db.getFirstAsync('SELECT id FROM entries WHERE date = ?', [42])).toEqual({ id: 42 });
        expect(await db.getFirstAsync('SELECT 1 FROM other')).toBeNull();
        expect(await db.getAllAsync('SELECT * FROM activities')).toEqual([{ id: 1 }]);
        expect(await db.getAllAsync('SELECT * FROM other')).toEqual([]);
        expect((await db.runAsync('INSERT INTO x VALUES (?)', [1])).lastInsertRowId).toBe(500);
        expect((await db.runAsync('INSERT INTO x VALUES (?)', [2])).lastInsertRowId).toBe(501);
        expect(sqlCalls(db, /INSERT INTO x/)).toHaveLength(2);
        expect(() => sqlParams(db, /INSERT INTO x/)).toThrow(/expected 1 call/);
    });

    it('is the write connection: withWriteTransaction statements land on it', async () => {
        const db = makeDb();
        await addMoodEntry(db as never, 6, [], 'n', FIXED_NOW.toISOString());
        expect(sqlCalls(db, /INSERT INTO entries/)).toHaveLength(1);
    });

    it('works in a suite that mocks expo-sqlite with its own narrow factory', () => {
        jest.isolateModules(() => {
            jest.doMock('expo-sqlite', () => ({ openDatabaseSync: jest.fn() }));
            const f = require('@/testing/fakeDb') as typeof import('@/testing/fakeDb');
            expect(typeof f.makeDb().runAsync).toBe('function');
        });
    });

    it('works in a suite that mocks the write-transaction module', () => {
        jest.isolateModules(() => {
            jest.doMock('@/databases/writeTransaction', () => ({ withWriteTransaction: jest.fn() }));
            const f = require('@/testing/fakeDb') as typeof import('@/testing/fakeDb');
            expect(() => f.resetWriteLayer()).not.toThrow();
            expect(typeof f.makeDb().runAsync).toBe('function');
        });
    });
});

describe('deferred', () => {
    it('holds a promise open until the test settles it', async () => {
        const d = deferred<number>();
        let got: number | undefined;
        void d.promise.then((v) => (got = v));
        await Promise.resolve();
        expect(got).toBeUndefined();
        d.resolve(7);
        await d.promise;
        expect(got).toBe(7);
        const r = deferred();
        r.reject(new Error('no'));
        await expect(r.promise).rejects.toThrow('no');
    });
});

// ── real SQLite ─────────────────────────────────────────────────────────────

describe('sqliteSuiteMode: missing sqlite never skips silently on CI', () => {
    it.each([
        [true, {}, 'run'],
        [true, { CI: 'true' }, 'run'],
        [false, {}, 'skip'],
        [false, { CI: 'false' }, 'skip'],
        [false, { CI: '0' }, 'skip'],
        [false, { CI: 'true' }, 'fail'],
        [false, { CI: '1' }, 'fail'],
    ] as const)('hasSqlite=%s env=%j -> %s', (has, env, mode) => {
        expect(sqliteSuiteMode(has, env)).toBe(mode);
    });

    it('this CI runner has node:sqlite (pr-checks pins Node 22)', () => {
        if (process.env.CI) expect(DatabaseSync).not.toBeNull();
    });
});

describeSqlite('realSqlite adapter', () => {
    let db: SqliteAdapter;
    beforeEach(() => {
        db = openSqlite({ schema: 'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT);' });
    });

    it('speaks the expo-sqlite async surface', async () => {
        const r = await db.runAsync('INSERT INTO t (v) VALUES (?)', ['a']);
        expect(r).toEqual({ lastInsertRowId: 1, changes: 1 });
        expect(await db.getFirstAsync('SELECT v FROM t WHERE id = ?', [1])).toEqual({ v: 'a' });
        expect(await db.getFirstAsync('SELECT v FROM t WHERE id = ?', [99])).toBeNull();
        expect(await db.getAllAsync('SELECT v FROM t')).toEqual([{ v: 'a' }]);
        expect(countRows(db, 't')).toBe(1);
        expect(countRows(db, 't', "v = 'b'")).toBe(0);
    });

    it('binds every expo-sqlite param form: array, variadic, named object; booleans as 1/0', async () => {
        await db.runAsync('INSERT INTO t (v) VALUES (?)', 'variadic');
        await db.runAsync('INSERT INTO t (v) VALUES ($v)', { $v: 'named' });
        expect(await db.getAllAsync('SELECT v FROM t ORDER BY id')).toEqual([{ v: 'variadic' }, { v: 'named' }]);
        expect(await db.getFirstAsync('SELECT v FROM t WHERE id = ?', 2)).toEqual({ v: 'named' });
        expect(await db.getFirstAsync('SELECT ? AS yes, ? AS no', [true, false])).toEqual({ yes: 1, no: 0 });
    });

    it('withTransactionAsync rolls back on a throw', async () => {
        await expect(
            db.withTransactionAsync(async () => {
                await db.runAsync('INSERT INTO t (v) VALUES (?)', ['x']);
                throw new Error('boom');
            })
        ).rejects.toThrow('boom');
        expect(countRows(db, 't')).toBe(0);
    });
});

describeSqlite('openMigratedSqlite: the shipped schema, and the builders agree with it', () => {
    let db: SqliteAdapter;
    beforeEach(async () => {
        resetWriteLayer();
        db = await openMigratedSqlite();
        __setWriteConnectionForTests(db as never);
    });

    it('runs every migration', async () => {
        const { user_version } = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!;
        expect(user_version).toBeGreaterThanOrEqual(15);
    });

    it('seedActivity(i) is the row a fresh install stores, for every seed activity', async () => {
        const rows = await db.getAllAsync<ReturnType<typeof seedActivity>>(
            'SELECT id, group_id, name, icon_name, icon_family, position FROM activities ORDER BY id'
        );
        expect(rows).toHaveLength(initialActivities.length);
        // Every field, the shipped name included (SHIPPED_SEED_RENAMES applies
        // migration 6's "Event" -> "Social event" over seedData's v1 names).
        expect(rows).toEqual(initialActivities.map((_, i) => seedActivity(i)));
    });

    it('seedGroup(i) is the group row a fresh install stores, for every seed group; makeGroup() the first', async () => {
        const rows = await db.getAllAsync('SELECT id, name, sort_order FROM activity_groups ORDER BY id');
        expect(rows).toEqual(initialActivityGroups.map((_, i) => seedGroup(i)));
        expect(rows[0]).toEqual(makeGroup());
    });

    it('makeEntryRow has exactly the columns getEntriesWindow selects', async () => {
        await addMoodEntry(db as never, 5, [], '', FIXED_NOW.toISOString());
        const raw: unknown[] = [];
        const getAll = db.getAllAsync;
        db.getAllAsync = (async (sql: string, params?: unknown[]) => {
            const rows = await getAll(sql, params);
            raw.push(...rows);
            return rows;
        }) as typeof db.getAllAsync;
        await getEntriesWindow(db as never, { query: '', moodRange: null, starredOnly: false }, 0, 10);
        expect(raw.length).toBeGreaterThan(0);
        expect(Object.keys(raw[0] as object).sort()).toEqual(Object.keys(makeEntryRow()).sort());
    });

    it('makeHealthDay round-trips through the real health-metrics store unchanged', async () => {
        const day = makeHealthDay();
        await upsertHealthMetrics(db as never, [day], day.source, day.syncedAt);
        expect(await getHealthMetricsRange(db as never, FIXED_DAY, FIXED_DAY)).toEqual([day]);
    });
});

// ── theme ───────────────────────────────────────────────────────────────────

describe('theme helpers use the real tokens', () => {
    it('THEME is the theme a fresh install resolves to', () => {
        expect(defaultThemeName()).toBe('dark');
        expect(THEME).toBe(themeColors.dark);
        expect(themeTokens('light')).toBe(themeColors.light);
    });

    it('mockThemeModule keeps the real exports and serves real tokens without a provider', () => {
        const mod = mockThemeModule('forest');
        expect(mod.themeColors).toBe(themeColors);
        expect(mod.useThemeColors()).toBe(themeColors.forest);
    });
});

// ── shared platform mocks (jest.setup.ts) ───────────────────────────────────

describe('shared platform mocks are live in every suite', () => {
    it('safe-area insets default to NONE and follow setInsets', async () => {
        expect((await renderHook(() => useSafeAreaInsets())).result.current).toEqual(INSETS.NONE);
        setInsets(INSETS.THREE_BUTTON_NAV);
        expect((await renderHook(() => useSafeAreaInsets())).result.current).toEqual(INSETS.THREE_BUTTON_NAV);
        setInsets({ bottom: 48 });
        expect((await renderHook(() => useSafeAreaInsets())).result.current).toEqual({ top: 0, bottom: 48, left: 0, right: 0 });
    });

    it('state resets before every test (this runs after the test that set insets)', async () => {
        expect((await renderHook(() => useSafeAreaInsets())).result.current).toEqual(INSETS.NONE);
        expect((await renderHook(() => useKeyboardHeight())).result.current).toBe(0);
    });

    it('useKeyboardHeight follows setKeyboardHeight', async () => {
        setKeyboardHeight(804);
        expect((await renderHook(() => useKeyboardHeight())).result.current).toBe(804);
    });

    it('reanimated loads, and Animated.ScrollView reports scrollToEnd to animatedScroll', async () => {
        const ref = React.createRef<{ scrollToEnd: (o?: unknown) => void }>();
        await render(
            <Animated.ScrollView ref={ref as never}>
                <Animated.View testID="inner" style={{ opacity: 0.5 }} />
            </Animated.ScrollView>
        );
        ref.current!.scrollToEnd({ animated: true });
        expect(animatedScroll.toEnd).toHaveBeenCalledWith({ animated: true });
    });

    it('the setters still steer the mocks after jest.isolateModules / resetModules', () => {
        jest.isolateModules(() => {
            const sa = require('react-native-safe-area-context');
            const kb = require('@/hooks/useKeyboardHeight');
            setInsets(INSETS.GESTURE_NAV);
            setKeyboardHeight(300);
            expect(sa.useSafeAreaInsets()).toEqual(INSETS.GESTURE_NAV);
            expect(kb.useKeyboardHeight()).toBe(300);
        });
        expect(currentInsets()).toEqual(INSETS.GESTURE_NAV);
    });

    it('gesture-handler keeps its plain-JS path: the reanimated stub never passes for real reanimated', async () => {
        // The stub has useSharedValue (gesture-handler's probe for reanimated)
        // but no useEvent. Without the reanimatedWrapper mock in jest.setup.ts a
        // GestureDetector throws "Reanimated.useEvent is not a function" (CI run
        // 41634176527, periodSwipeGesture).
        const view = await render(
            <GestureDetector gesture={Gesture.Pan()}>
                <View testID="pan-target" />
            </GestureDetector>
        );
        expect(view.getByTestId('pan-target')).toBeTruthy();
    });
});

// ── render-tree helpers ─────────────────────────────────────────────────────

describe('rntl helpers', () => {
    const tree = {
        type: 'View',
        props: { style: [{ padding: 4 }, { margin: 2 }] },
        children: [
            { type: 'RNSVGCircle', props: {}, children: null },
            [{ type: 'RNSVGTSpan', props: { content: 'Jan' }, children: null }],
            'text',
        ],
    };

    it('styleOf flattens; countByType and svgStrings walk nested children and arrays', () => {
        expect(styleOf(tree)).toEqual({ padding: 4, margin: 2 });
        expect(styleOf(null)).toEqual({});
        expect(countByType(tree, 'Circle')).toBe(1);
        expect(svgStrings(tree)).toEqual(['Jan']);
    });
});

// ── boundary: test helpers never ship ───────────────────────────────────────
// Shape scan (no compiler rule can say "app code must not import a folder"):
// a builder or fake reaching the bundle would ship jest-only code to users.

const APP_DIRS = ['app', 'components', 'context', 'databases', 'hooks', 'lib', 'styles', 'types'];
const TESTING_IMPORT = /(from\s+|require\(\s*|import\(\s*)['"](@\/testing|(\.\.?\/)+testing)(\/[^'"]*)?['"]/;

describe('no app source imports the test helpers', () => {
    const files = listSourceFiles(APP_DIRS);

    it('scans the real source tree', () => {
        // Guards the scan itself: an empty file list would pass vacuously.
        expect(files.length).toBeGreaterThan(100);
        expect(files).toContain('databases/entries.ts');
    });

    it('the import pattern catches every import form (positive control)', () => {
        for (const line of [
            "import { makeEntry } from '@/testing/builders';",
            "const t = require('@/testing/theme');",
            "import x from '../testing/fakeDb';",
            "await import('@/testing')",
        ]) {
            expect(TESTING_IMPORT.test(line)).toBe(true);
        }
        expect(TESTING_IMPORT.test("import { x } from '@/lib/testingUtils';")).toBe(false);
    });

    it('none of them imports frontend/testing', () => {
        expect(files.filter((f) => TESTING_IMPORT.test(code(f)))).toEqual([]);
    });
});
