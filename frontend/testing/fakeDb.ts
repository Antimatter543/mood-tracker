/**
 * The mocked expo-sqlite database for unit tests that assert on the SQL a
 * function issues (for engine behaviour use ./realSqlite instead).
 *
 *   const db = makeDb();            // fresh createMockDatabase(), installed as the write connection
 *   await addActivity(db, ...);
 *   expect(sqlCalls(db, /INSERT INTO activities/)).toHaveLength(1);
 *
 * Call `resetWriteLayer()` in a beforeEach (the write layer keeps a singleton
 * lock/connection between tests).
 */
// Imported directly, never through 'expo-sqlite': 49 suites replace that module
// with a narrow factory that has no createMockDatabase.
import { createMockDatabase } from './mockSqliteDb';
// Static import on purpose: a lazy requireActual would install the connection
// into a post-jest.resetModules module graph the suite's own imports never see.
import * as writeTransaction from '@/databases/writeTransaction';

export type MockDb = ReturnType<typeof createMockDatabase>;

type Route = [RegExp, (params: unknown[], sql: string) => unknown];

export type ScriptedDbOptions = {
    /** First lastInsertRowId runAsync returns; increments per call. Default: the stock mock's fixed 1. */
    firstInsertId?: number;
    /** getFirstAsync answers: the first route whose RegExp matches the SQL wins; unmatched -> null. */
    first?: Route[];
    /** getAllAsync answers: same matching; unmatched -> []. */
    all?: Route[];
};

/**
 * A fresh mock database installed as the write connection, so writes that go
 * through withWriteTransaction land on the same object the test asserts on.
 * Pass `script` to answer reads by SQL pattern and hand out incrementing ids.
 */
export function makeDb(script: ScriptedDbOptions = {}): MockDb {
    const db = createMockDatabase();
    if (script.firstInsertId !== undefined) {
        let nextId = script.firstInsertId;
        db.runAsync.mockImplementation(async () => ({ lastInsertRowId: nextId++, changes: 1 }));
    }
    if (script.first) {
        const routes = script.first;
        db.getFirstAsync.mockImplementation(async (sql: string, params: unknown[] = []) =>
            answer(routes, sql, params, null)
        );
    }
    if (script.all) {
        const routes = script.all;
        db.getAllAsync.mockImplementation(async (sql: string, params: unknown[] = []) =>
            answer(routes, sql, params, [])
        );
    }
    // A suite that mocks writeTransaction itself has no injection point; its
    // mock decides where writes go.
    if (typeof writeTransaction.__setWriteConnectionForTests === 'function') {
        writeTransaction.__setWriteConnectionForTests(db as never);
    }
    return db;
}

function answer(routes: Route[], sql: string, params: unknown[], fallback: unknown): unknown {
    const hit = routes.find(([re]) => re.test(sql));
    return hit ? hit[1](params, sql) : fallback;
}

/** Reset the write layer's singleton connection + lock; call in beforeEach. */
export function resetWriteLayer(): void {
    if (typeof writeTransaction.__resetWriteTransactionForTests === 'function') {
        writeTransaction.__resetWriteTransactionForTests();
    }
}

type CallLog = { mock: { calls: unknown[][] } };

/** Every call of `fn` (default db.runAsync) whose SQL matches `pattern`. */
export function sqlCalls(db: MockDb, pattern: RegExp, fn: CallLog = db.runAsync): unknown[][] {
    return fn.mock.calls.filter((c) => typeof c[0] === 'string' && pattern.test(c[0]));
}

/** The params of the single call whose SQL matches; throws if there is not exactly one. */
export function sqlParams(db: MockDb, pattern: RegExp, fn: CallLog = db.runAsync): unknown[] {
    const calls = sqlCalls(db, pattern, fn);
    if (calls.length !== 1) {
        throw new Error(`testing/fakeDb: expected 1 call matching ${pattern}, got ${calls.length}`);
    }
    return (calls[0][1] as unknown[]) ?? [];
}
