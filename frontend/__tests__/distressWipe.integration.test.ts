/**
 * INTEGRATION: the distress wipe (databases/distressWipe.ts) against REAL SQLite
 * at the shipped schema (every migration, default activities seeded).
 *
 * The promise under test, from the user's point of view: after the wipe the
 * journal still looks real (same days, same moods, default activities), and
 * nothing private is left: no note, photo, custom activity or group, binned
 * entry or leftover backup file.
 */
// The hand-written FileSystem mock (documentDirectory, cacheDirectory,
// readDirectoryAsync); the auto-mock omits the folder constants.
jest.mock('expo-file-system/legacy', () => require('../__mocks__/expo-file-system'));

import * as FileSystem from 'expo-file-system/legacy';
import {
    __resetWriteTransactionForTests,
    __setWriteConnectionForTests,
} from '@/databases/writeTransaction';
import {
    defaultActivityKeys,
    isLeftoverBackupFile,
    runDistressWipe,
    wipeSensitiveData,
} from '@/databases/distressWipe';
import { initialActivities } from '@/components/seedData';
import { countRows, describeSqlite, openMigratedSqlite, SqliteAdapter } from '@/testing/realSqlite';

const fs = FileSystem as unknown as {
    deleteAsync: jest.Mock;
    readDirectoryAsync: jest.Mock;
    documentDirectory: string;
    cacheDirectory: string;
};

describe('distress wipe helpers (pure)', () => {
    it('every seeded default activity is in the keep-list (class-level, the whole catalogue)', () => {
        const keys = defaultActivityKeys();
        expect(keys.length).toBeGreaterThanOrEqual(initialActivities.length);
        for (const a of initialActivities) {
            expect(keys.some(k => k.endsWith(`\u001f${a.name}`))).toBe(true);
        }
        // migration 6's rename keeps its default status
        expect(keys).toContain('Social\u001fSocial event');
    });

    it('recognises only the files the export writes', () => {
        expect(isLeftoverBackupFile('mood_tracker_export_2026-11-01.json')).toBe(true);
        expect(isLeftoverBackupFile('mood_tracker_export_2026-11-01_encrypted.json')).toBe(true);
        expect(isLeftoverBackupFile('moodTracker.db')).toBe(false);
        expect(isLeftoverBackupFile('SQLite')).toBe(false);
        expect(isLeftoverBackupFile('entry_media')).toBe(false);
    });
});

describeSqlite('distress wipe: real SQLite', () => {
    let db: SqliteAdapter;

    const idOf = (sql: string, ...p: unknown[]) =>
        Number((db.raw.prepare(sql).get(...(p as never[])) as { id: number }).id);

    let defaultHappy: number;
    let defaultWork: number;
    let customInDefaultGroup: number;
    let customGroupActivity: number;
    let shadowDefault: number; // a custom activity NAMED like a default, in a custom group
    let customGroup: number;

    beforeEach(async () => {
        db = await openMigratedSqlite();
        __resetWriteTransactionForTests();
        __setWriteConnectionForTests(db as never);
        jest.clearAllMocks();

        defaultHappy = idOf(`SELECT a.id FROM activities a JOIN activity_groups g ON g.id=a.group_id
                             WHERE g.name='Emotions' AND a.name='Happy'`);
        defaultWork = idOf(`SELECT a.id FROM activities a JOIN activity_groups g ON g.id=a.group_id
                            WHERE g.name='Activities' AND a.name='Work'`);

        db.raw.exec(`INSERT INTO activity_groups (name, sort_order) VALUES ('Therapy', 99)`);
        customGroup = idOf(`SELECT id FROM activity_groups WHERE name='Therapy'`);
        db.raw.prepare(`INSERT INTO activities (name, group_id) VALUES ('Panic attack', ?)`).run(customGroup);
        customGroupActivity = idOf(`SELECT id FROM activities WHERE name='Panic attack'`);
        db.raw.prepare(`INSERT INTO activities (name, group_id) VALUES ('Happy', ?)`).run(customGroup);
        shadowDefault = idOf(`SELECT id FROM activities WHERE name='Happy' AND group_id=?`, customGroup);
        db.raw.exec(`INSERT INTO activities (name, group_id) VALUES ('Medication', 5)`);
        customInDefaultGroup = idOf(`SELECT id FROM activities WHERE name='Medication'`);

        // Entry 1: live, note, star, photo, default + custom activities.
        db.raw.exec(`INSERT INTO entries (id, mood, notes, date, starred_at)
                     VALUES (1, 3.5, 'secret diary text', '2026-11-01T10:00:00.000Z', '2026-11-01T11:00:00.000Z')`);
        // Entry 2: live, no note, only default activities.
        db.raw.exec(`INSERT INTO entries (id, mood, notes, date) VALUES (2, 8, NULL, '2026-11-02T10:00:00.000Z')`);
        // Entry 3: in the recycle bin, with a note and a photo.
        db.raw.exec(`INSERT INTO entries (id, mood, notes, date, deleted_at)
                     VALUES (3, 2, 'deleted but private', '2026-11-03T10:00:00.000Z', '2026-11-04T10:00:00.000Z')`);

        const link = db.raw.prepare('INSERT INTO entry_activities (entry_id, activity_id) VALUES (?, ?)');
        link.run(1, defaultHappy);
        link.run(1, customGroupActivity);
        link.run(1, customInDefaultGroup);
        link.run(1, shadowDefault);
        link.run(2, defaultWork);
        link.run(3, defaultHappy);

        db.raw.exec(`INSERT INTO entry_media (entry_id, file_path) VALUES (1, 'file:///docs/entry_media/a.jpg')`);
        db.raw.exec(`INSERT INTO entry_media (entry_id, file_path) VALUES (3, 'file:///docs/entry_media/b.jpg')`);
        db.raw.exec(`INSERT OR REPLACE INTO user_settings (key, value) VALUES ('distress_wipe_enabled', 'true')`);
        db.raw.exec(`INSERT OR REPLACE INTO user_settings (key, value) VALUES ('app_lock_enabled', 'true')`);
    });

    afterEach(() => {
        __resetWriteTransactionForTests();
        db.raw.close();
    });

    it('keeps every live entry with its date and mood', async () => {
        await wipeSensitiveData(db as never);
        const rows = db.raw.prepare('SELECT id, mood, date FROM entries ORDER BY id').all();
        expect(rows).toEqual([
            { id: 1, mood: 3.5, date: '2026-11-01T10:00:00.000Z' },
            { id: 2, mood: 8, date: '2026-11-02T10:00:00.000Z' },
        ]);
    });

    it('clears every note, but keeps stars (not incriminating, and they make it look real)', async () => {
        await wipeSensitiveData(db as never);
        expect(countRows(db, 'entries', 'notes IS NOT NULL')).toBe(0);
        expect(countRows(db, 'entries', 'starred_at IS NOT NULL')).toBe(1);
        const dump = JSON.stringify(db.raw.prepare('SELECT * FROM entries').all());
        expect(dump).not.toMatch(/secret|private/);
    });

    it('keeps links to default activities only', async () => {
        await wipeSensitiveData(db as never);
        const links = db.raw
            .prepare('SELECT entry_id, activity_id FROM entry_activities ORDER BY entry_id, activity_id')
            .all();
        expect(links).toEqual([
            { entry_id: 1, activity_id: defaultHappy },
            { entry_id: 2, activity_id: defaultWork },
        ]);
    });

    it('removes custom activities and groups, keeps the whole default catalogue', async () => {
        const defaultsBefore = countRows(db, 'activities') - 3;
        await wipeSensitiveData(db as never);
        expect(countRows(db, 'activities')).toBe(defaultsBefore);
        expect(countRows(db, 'activities', `name IN ('Panic attack', 'Medication')`)).toBe(0);
        expect(countRows(db, 'activities', `id = ${shadowDefault}`)).toBe(0);
        expect(countRows(db, 'activity_groups', `name = 'Therapy'`)).toBe(0);
        expect(countRows(db, 'activity_groups')).toBe(5);
    });

    it('purges the recycle bin and every photo row', async () => {
        await wipeSensitiveData(db as never);
        expect(countRows(db, 'entries', 'deleted_at IS NOT NULL')).toBe(0);
        expect(countRows(db, 'entry_media')).toBe(0);
        expect(countRows(db, 'entry_activities', 'entry_id = 3')).toBe(0);
    });

    it('turns the distress option off and leaves the app lock on', async () => {
        await wipeSensitiveData(db as never);
        const get = (k: string) =>
            (db.raw.prepare('SELECT value FROM user_settings WHERE key = ?').get(k) as { value: string }).value;
        expect(get('distress_wipe_enabled')).toBe('false');
        expect(get('app_lock_enabled')).toBe('true');
    });

    it('switches secure_delete on for the write connection before deleting', async () => {
        await wipeSensitiveData(db as never);
        const row = db.raw.prepare('PRAGMA secure_delete').get() as { secure_delete: number };
        expect(row.secure_delete).toBe(1);
    });

    it('200 logged days stay 200 days, each with its mood and default activities', async () => {
        db.raw.exec('DELETE FROM entry_activities; DELETE FROM entry_media; DELETE FROM entries;');
        const ins = db.raw.prepare('INSERT INTO entries (id, mood, notes, date) VALUES (?, ?, ?, ?)');
        const link = db.raw.prepare('INSERT INTO entry_activities (entry_id, activity_id) VALUES (?, ?)');
        for (let i = 1; i <= 200; i++) {
            const day = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString();
            ins.run(i, (i % 10) + 1, `private note ${i}`, day);
            link.run(i, defaultHappy);
            link.run(i, customGroupActivity);
        }
        const before = db.raw.prepare('SELECT id, mood, date FROM entries ORDER BY id').all();

        await wipeSensitiveData(db as never);

        expect(db.raw.prepare('SELECT id, mood, date FROM entries ORDER BY id').all()).toEqual(before);
        expect(countRows(db, 'entry_activities', `activity_id = ${defaultHappy}`)).toBe(200);
        expect(countRows(db, 'entry_activities')).toBe(200);
        expect(countRows(db, 'entries', 'notes IS NOT NULL')).toBe(0);
    });

    it('blanks reminder NAMES but keeps each reminder, its time and on/off state', async () => {
        const list = [
            { id: 'a', label: 'Take meds', time: '08:00', enabled: true },
            { id: 'b', label: '', time: '20:00', enabled: false },
        ];
        db.raw.prepare(`INSERT OR REPLACE INTO user_settings (key, value) VALUES ('reminders', ?)`)
            .run(JSON.stringify(list));

        const result = await wipeSensitiveData(db as never);

        const stored = JSON.parse(
            (db.raw.prepare(`SELECT value FROM user_settings WHERE key='reminders'`).get() as { value: string }).value
        );
        expect(stored).toEqual([
            { id: 'a', label: '', time: '08:00', enabled: true },
            { id: 'b', label: '', time: '20:00', enabled: false },
        ]);
        expect(JSON.parse(result.reminders!)).toEqual(stored);
    });

    it('keeps health metrics and every other setting', async () => {
        db.raw.exec(`INSERT INTO health_metrics (date, sleep_total_minutes, synced_at) VALUES ('2026-11-01', 420, 'x')`);
        db.raw.exec(`INSERT OR REPLACE INTO user_settings (key, value) VALUES ('theme', 'forest')`);
        await wipeSensitiveData(db as never);
        expect(countRows(db, 'health_metrics')).toBe(1);
        expect((db.raw.prepare(`SELECT value FROM user_settings WHERE key='theme'`).get() as { value: string }).value)
            .toBe('forest');
    });

    it('is atomic: a failing statement rolls everything back', async () => {
        db.raw.exec('DROP TABLE user_settings');
        await expect(wipeSensitiveData(db as never)).rejects.toThrow();
        expect(countRows(db, 'entries', 'notes IS NOT NULL')).toBe(2);
        expect(countRows(db, 'entry_media')).toBe(2);
        expect(countRows(db, 'activity_groups', `name = 'Therapy'`)).toBe(1);
    });

    it('also works where foreign keys are OFF (no reliance on cascades)', async () => {
        db.raw.exec('PRAGMA foreign_keys = OFF');
        await wipeSensitiveData(db as never);
        expect(countRows(db, 'entry_activities', 'activity_id NOT IN (SELECT id FROM activities)')).toBe(0);
        expect(countRows(db, 'entry_activities', 'entry_id NOT IN (SELECT id FROM entries)')).toBe(0);
    });

    it('is idempotent: a second run changes nothing', async () => {
        await wipeSensitiveData(db as never);
        const second = await wipeSensitiveData(db as never);
        expect(second).toMatchObject({
            notesCleared: 0,
            photosRemoved: 0,
            customActivitiesRemoved: 0,
            customGroupsRemoved: 0,
            binnedEntriesPurged: 0,
            reminders: null,
        });
    });

    it('runDistressWipe unlinks the photos, the media folder and leftover backups', async () => {
        fs.readDirectoryAsync.mockImplementation(async (dir: string) =>
            dir === fs.documentDirectory
                ? ['SQLite', 'entry_media', 'mood_tracker_export_2026-10-01.json']
                : ['ImagePicker']
        );
        const summary = await runDistressWipe(db as never);
        // The binned entry (and, by cascade, its photo row) goes with the bin purge.
        expect(summary).toMatchObject({ notesCleared: 1, photosRemoved: 1, binnedEntriesPurged: 1 });

        const deleted = fs.deleteAsync.mock.calls.map(c => c[0]);
        expect(deleted).toEqual(expect.arrayContaining([
            'file:///docs/entry_media/a.jpg',
            'file:///docs/entry_media/b.jpg',
            `${fs.documentDirectory}mood_tracker_export_2026-10-01.json`,
            `${fs.cacheDirectory}ImagePicker`,
        ]));
        expect(deleted.some((p: string) => p.endsWith('entry_media/'))).toBe(true);
        // never the database itself
        expect(deleted.some((p: string) => /SQLite|\.db$/.test(p))).toBe(false);
    });
});
