/**
 * INTEGRATION test: the REAL `addActivity` against the SHIPPED schema (every
 * migration, seeds included) on a real SQLite engine.
 *
 * Why on top of activities.test.ts: the mocked DB only answers what the test
 * scripts, so it cannot show that the duplicate pre-check agrees with the
 * table's real UNIQUE(name, group_id). PR #51 moved duplicate detection from
 * "match the driver's 'UNIQUE constraint failed' text" to an up-front lookup
 * that returns `code: ACTIVITY_NAME_TAKEN`; this pins that the lookup fires for
 * exactly the rows the constraint would reject, and nothing else.
 */
import { addActivity, ACTIVITY_NAME_TAKEN } from '@/databases/activities';
import { seedActivity, seedGroup } from '@/testing/builders';
import { resetWriteLayer } from '@/testing/fakeDb';
import { countRows, describeSqlite, openMigratedSqlite, type SqliteAdapter } from '@/testing/realSqlite';

describeSqlite('addActivity on the shipped schema', () => {
    let db: SqliteAdapter;
    const existing = seedActivity(0);
    const sameGroup = existing.group_id;
    // Any seeded group other than the one the first seed activity lives in.
    const otherGroup = [seedGroup(0), seedGroup(1)].find((g) => g.id !== sameGroup)!.id;

    beforeEach(async () => {
        resetWriteLayer();
        db = await openMigratedSqlite();
    });

    it('rejects a name already used in the same group with the duplicate code, writing nothing', async () => {
        const before = countRows(db, 'activities');
        const result = await addActivity(db as never, existing.name, sameGroup);

        expect(result.success).toBe(false);
        expect(result.code).toBe(ACTIVITY_NAME_TAKEN);
        expect(result.message).toBe('An activity with this name already exists in this group');
        expect(countRows(db, 'activities')).toBe(before);
    });

    it('treats surrounding spaces as the same name', async () => {
        const result = await addActivity(db as never, `  ${existing.name} `, sameGroup);
        expect(result.code).toBe(ACTIVITY_NAME_TAKEN);
    });

    it('allows the same name in a different group', async () => {
        const result = await addActivity(db as never, existing.name, otherGroup);

        expect(result.success).toBe(true);
        expect(
            countRows(db, 'activities', `name = '${existing.name.replace(/'/g, "''")}'`)
        ).toBe(2);
    });

    it('appends a new name to the end of its group', async () => {
        const result = await addActivity(db as never, 'Pottery', sameGroup, 'Feather', 'star');
        expect(result.success).toBe(true);

        const row = await db.getFirstAsync<{ position: number; icon_name: string }>(
            'SELECT position, icon_name FROM activities WHERE name = ? AND group_id = ?',
            'Pottery',
            sameGroup
        );
        const max = await db.getFirstAsync<{ m: number }>(
            'SELECT MAX(position) AS m FROM activities WHERE group_id = ?',
            sameGroup
        );
        expect(row).toEqual({ position: max!.m, icon_name: 'star' });
    });
});
