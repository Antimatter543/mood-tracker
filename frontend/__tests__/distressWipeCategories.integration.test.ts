/**
 * REGRESSION GUARD, one row per distress-wipe category (lib/distressScope.ts),
 * against REAL SQLite at the shipped schema and the full runDistressWipe path
 * (database, stored backup key, files).
 *
 * For every category it proves, with ONLY that category switched on:
 *   1. its data is gone,
 *   2. no other category's data was touched (except what the category
 *      logically takes along, listed in IMPLIES),
 *   3. what is never erased (display settings, the app lock, the default
 *      activity catalogue) is still there.
 * Plus one run with every category on (an empty journal, like a fresh install)
 * and one with every category off (nothing but the distress switch changes).
 *
 * The table is a Record over DistressCategory, so adding a category without a
 * row here does not compile, and the runtime check below fails too. That is
 * the point: a category must not silently stop working in a later update.
 */
jest.mock('expo-file-system/legacy', () => require('../__mocks__/expo-file-system'));

import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import {
    __resetWriteTransactionForTests,
    __setWriteConnectionForTests,
} from '@/databases/writeTransaction';
import { runDistressWipe } from '@/databases/distressWipe';
import { initialActivities } from '@/components/seedData';
import {
    DEFAULT_DISTRESS_SCOPE,
    DISTRESS_CATEGORIES,
    DistressCategory,
    DistressScope,
} from '@/lib/distressScope';
import { countRows, describeSqlite, openMigratedSqlite, SqliteAdapter } from '@/testing/realSqlite';

const fs = FileSystem as unknown as {
    deleteAsync: jest.Mock;
    readDirectoryAsync: jest.Mock;
    documentDirectory: string;
    cacheDirectory: string;
};
const store = SecureStore as unknown as {
    __dump: () => Record<string, string>;
    __reset: () => void;
};

const BACKUP_KEY = 'backup_encryption_key_v1';
const LEFTOVER_BACKUP = 'mood_tracker_export_2026-10-01.json';
const PHOTO_LIVE = 'file:///docs/entry_media/live.jpg';
const PHOTO_BINNED = 'file:///docs/entry_media/binned.jpg';

type Ctx = { db: SqliteAdapter; deleted: string[] };

const setting = (db: SqliteAdapter, key: string) =>
    (db.raw.prepare('SELECT value FROM user_settings WHERE key = ?').get(key) as { value: string } | undefined)
        ?.value;

/** "Is this category's data gone?" for the fixture below. */
const ERASED: Record<DistressCategory, (c: Ctx) => boolean> = {
    notes: ({ db }) => countRows(db, 'entries', 'deleted_at IS NULL AND notes IS NOT NULL') === 0,
    photos: ({ db, deleted }) =>
        countRows(db, 'entry_media', 'entry_id IN (SELECT id FROM entries WHERE deleted_at IS NULL)') === 0 &&
        deleted.includes(PHOTO_LIVE),
    stars: ({ db }) => countRows(db, 'entries', 'starred_at IS NOT NULL') === 0,
    customActivities: ({ db }) =>
        countRows(db, 'activities', `name = 'Panic attack'`) === 0 &&
        countRows(db, 'activity_groups', `name = 'Therapy'`) === 0,
    recycleBin: ({ db }) => countRows(db, 'entries', 'deleted_at IS NOT NULL') === 0,
    health: ({ db }) => countRows(db, 'health_metrics') === 0 && setting(db, 'health_connect_opt_in') === 'false',
    reminderNames: ({ db }) => JSON.parse(setting(db, 'reminders') ?? '[]')[0]?.label === '',
    backupKey: () => !(BACKUP_KEY in store.__dump()),
    leftoverFiles: ({ deleted }) =>
        deleted.includes(`${fs.documentDirectory}${LEFTOVER_BACKUP}`) &&
        deleted.includes(`${fs.cacheDirectory}ImagePicker`),
    defaultActivityLinks: ({ db }) =>
        countRows(
            db,
            'entry_activities',
            `entry_id IN (SELECT id FROM entries WHERE deleted_at IS NULL)
             AND activity_id IN (SELECT a.id FROM activities a JOIN activity_groups g ON g.id = a.group_id
                                 WHERE g.name IN ('Emotions', 'Activities'))`
        ) === 0,
    entries: ({ db }) => countRows(db, 'entries') === 0,
};

/** What a category takes along by its nature (an erased entry has no note left). */
const IMPLIES: Partial<Record<DistressCategory, DistressCategory[]>> = {
    entries: ['notes', 'stars', 'photos', 'recycleBin', 'defaultActivityLinks'],
};

const only = (category: DistressCategory): DistressScope =>
    Object.fromEntries(DISTRESS_CATEGORIES.map(c => [c, c === category])) as DistressScope;
const allOn = Object.fromEntries(DISTRESS_CATEGORIES.map(c => [c, true])) as DistressScope;
const allOff = Object.fromEntries(DISTRESS_CATEGORIES.map(c => [c, false])) as DistressScope;

describe('distress categories: every category has a regression row', () => {
    it('the table covers exactly the shipped categories', () => {
        expect(Object.keys(ERASED).sort()).toEqual([...DISTRESS_CATEGORIES].sort());
    });
});

describeSqlite('distress wipe, per category (real SQLite, full wipe path)', () => {
    let db: SqliteAdapter;
    let defaultCatalogue: number;

    beforeEach(async () => {
        db = await openMigratedSqlite();
        __resetWriteTransactionForTests();
        __setWriteConnectionForTests(db as never);
        jest.clearAllMocks();
        store.__reset();

        const id = (sql: string) => Number((db.raw.prepare(sql).get() as { id: number }).id);
        const happy = id(`SELECT a.id FROM activities a JOIN activity_groups g ON g.id=a.group_id
                          WHERE g.name='Emotions' AND a.name='Happy'`);
        const work = id(`SELECT a.id FROM activities a JOIN activity_groups g ON g.id=a.group_id
                         WHERE g.name='Activities' AND a.name='Work'`);
        db.raw.exec(`INSERT INTO activity_groups (name, sort_order) VALUES ('Therapy', 99)`);
        const therapy = id(`SELECT id FROM activity_groups WHERE name='Therapy'`);
        db.raw.prepare(`INSERT INTO activities (name, group_id) VALUES ('Panic attack', ?)`).run(therapy);
        const panic = id(`SELECT id FROM activities WHERE name='Panic attack'`);
        defaultCatalogue = countRows(db, 'activities') - 1;

        // 1: live, note + star + photo, default + custom activity
        // 2: live, plain, default activity
        // 3: in the recycle bin, note + photo
        db.raw.exec(`INSERT INTO entries (id, mood, notes, date, starred_at) VALUES
            (1, 3, 'private note', '2026-11-01T10:00:00.000Z', '2026-11-01T11:00:00.000Z'),
            (2, 8, NULL, '2026-11-02T10:00:00.000Z', NULL)`);
        db.raw.exec(`INSERT INTO entries (id, mood, notes, date, deleted_at) VALUES
            (3, 2, 'deleted note', '2026-11-03T10:00:00.000Z', '2026-11-04T10:00:00.000Z')`);
        const link = db.raw.prepare('INSERT INTO entry_activities (entry_id, activity_id) VALUES (?, ?)');
        link.run(1, happy);
        link.run(1, panic);
        link.run(2, work);
        link.run(3, happy);
        db.raw.prepare(`INSERT INTO entry_media (entry_id, file_path) VALUES (1, ?), (3, ?)`).run(PHOTO_LIVE, PHOTO_BINNED);
        db.raw.exec(`INSERT INTO health_metrics (date, sleep_total_minutes, synced_at) VALUES ('2026-11-01', 420, 'x')`);
        db.raw.exec(`INSERT OR REPLACE INTO user_settings (key, value) VALUES
            ('reminders', '[{"id":"a","label":"Take meds","time":"08:00","enabled":true}]'),
            ('health_connect_opt_in', 'true'),
            ('theme', 'forest'),
            ('app_lock_enabled', 'true'),
            ('distress_wipe_enabled', 'true')`);
        await SecureStore.setItemAsync(BACKUP_KEY, '{"k":1}');
        fs.readDirectoryAsync.mockImplementation(async (dir: string) =>
            dir === fs.documentDirectory ? ['SQLite', 'entry_media', LEFTOVER_BACKUP]
                : dir === `${fs.documentDirectory}entry_media/` ? ['live.jpg', 'binned.jpg']
                : ['ImagePicker']
        );
    });

    afterEach(() => {
        __resetWriteTransactionForTests();
        db.raw.close();
        store.__reset();
    });

    const run = async (scope: DistressScope): Promise<Ctx> => {
        await runDistressWipe(db as never, scope);
        return { db, deleted: fs.deleteAsync.mock.calls.map(c => c[0] as string) };
    };

    /** What is never erased, whatever the selection. */
    const expectNeverErased = (c: Ctx) => {
        expect(setting(c.db, 'theme')).toBe('forest');
        expect(setting(c.db, 'app_lock_enabled')).toBe('true');
        expect(setting(c.db, 'distress_wipe_enabled')).toBe('false'); // it fired
        expect(countRows(c.db, 'activities', `name <> 'Panic attack'`)).toBe(defaultCatalogue);
        expect(c.deleted.some(p => /SQLite|\.db$/.test(p))).toBe(false);
    };

    it('the fixture starts with something in every category', async () => {
        const ctx = { db, deleted: [] };
        for (const c of DISTRESS_CATEGORIES) expect([c, ERASED[c](ctx)]).toEqual([c, false]);
    });

    it.each([...DISTRESS_CATEGORIES])('"%s" alone erases its data and nothing else', async (category) => {
        const ctx = await run(only(category));
        expect([category, ERASED[category](ctx)]).toEqual([category, true]);
        const alsoGone = new Set([category, ...(IMPLIES[category] ?? [])]);
        for (const other of DISTRESS_CATEGORIES) {
            if (!alsoGone.has(other)) expect([other, ERASED[other](ctx)]).toEqual([other, false]);
        }
        expectNeverErased(ctx);
    });

    it('the default selection keeps every live day with its score and default activities', async () => {
        const ctx = await run(DEFAULT_DISTRESS_SCOPE);
        expect(db.raw.prepare('SELECT id, mood, date FROM entries ORDER BY id').all()).toEqual([
            { id: 1, mood: 3, date: '2026-11-01T10:00:00.000Z' },
            { id: 2, mood: 8, date: '2026-11-02T10:00:00.000Z' },
        ]);
        expect(ERASED.defaultActivityLinks(ctx)).toBe(false);
        for (const c of DISTRESS_CATEGORIES) {
            expect([c, ERASED[c](ctx)]).toEqual([c, DEFAULT_DISTRESS_SCOPE[c] || (c === 'recycleBin')]);
        }
        expectNeverErased(ctx);
    });

    it('everything on: an empty journal, like a fresh install', async () => {
        const ctx = await run(allOn);
        for (const c of DISTRESS_CATEGORIES) expect([c, ERASED[c](ctx)]).toEqual([c, true]);
        expect(countRows(db, 'entry_activities')).toBe(0);
        expect(countRows(db, 'entry_media')).toBe(0);
        expect(countRows(db, 'activities')).toBe(defaultCatalogue);
        expect(countRows(db, 'activity_groups')).toBe(5);
        expect(ctx.deleted).toEqual(expect.arrayContaining([PHOTO_LIVE, PHOTO_BINNED]));
        expectNeverErased(ctx);
    });

    it('everything off: nothing but the distress switch changes', async () => {
        const ctx = await run(allOff);
        for (const c of DISTRESS_CATEGORIES) expect([c, ERASED[c](ctx)]).toEqual([c, false]);
        expect(ctx.deleted).toEqual([]);
        expectNeverErased(ctx);
    });

    it('keeping photos never deletes a photo file that is still in use (the folder sweep included)', async () => {
        for (const keep of [only('recycleBin'), only('notes'), { ...DEFAULT_DISTRESS_SCOPE, photos: false }]) {
            fs.deleteAsync.mockClear();
            const ctx = await run(keep);
            expect(ctx.deleted).not.toContain(PHOTO_LIVE);
            expect(ctx.deleted).not.toContain(`${fs.documentDirectory}entry_media/live.jpg`);
        }
    });

    it('the default catalogue matches the seed list (guards the "default" definition itself)', () => {
        expect(defaultCatalogue).toBe(initialActivities.length);
    });
});
