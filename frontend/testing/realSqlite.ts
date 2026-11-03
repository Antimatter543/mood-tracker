/**
 * A REAL SQLite engine for integration tests: Node's built-in `node:sqlite`
 * (Node >= 22.5) behind an expo-sqlite-shaped async adapter.
 *
 *   describeSqlite('entry bin', () => {
 *     let db: SqliteAdapter;
 *     beforeEach(() => { db = openSqlite({ schema: SCHEMA }); __setWriteConnectionForTests(db as never); });
 *     ...
 *   });
 *
 * Missing sqlite is LOUD on CI: describeSqlite throws when process.env.CI is
 * set, so a runner without node:sqlite fails instead of silently skipping
 * every integration suite. Locally it skips with a named reason.
 */

type SyncStatement = {
    run: (...params: unknown[]) => { lastInsertRowid: number | bigint; changes: number | bigint };
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
};

export type SyncDatabase = {
    exec: (sql: string) => void;
    prepare: (sql: string) => SyncStatement;
    close: () => void;
};

type DatabaseSyncCtor = new (path: string) => SyncDatabase;

function loadDatabaseSync(): DatabaseSyncCtor | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('node:sqlite').DatabaseSync as DatabaseSyncCtor;
    } catch {
        return null;
    }
}

/** node:sqlite's DatabaseSync, or null when this Node has no built-in sqlite. */
export const DatabaseSync: DatabaseSyncCtor | null = loadDatabaseSync();

export type SqliteSuiteMode = 'run' | 'skip' | 'fail';

/** Pure: run when sqlite exists; otherwise fail on CI, skip locally. */
export function sqliteSuiteMode(
    hasSqlite: boolean,
    env: Record<string, string | undefined>
): SqliteSuiteMode {
    if (hasSqlite) return 'run';
    const ci = env.CI;
    return ci && ci !== 'false' && ci !== '0' ? 'fail' : 'skip';
}

export const SQLITE_MISSING_MESSAGE =
    'node:sqlite is unavailable (needs Node >= 22.13, or 22.5+ with --experimental-sqlite). Integration suites must not skip on CI: ' +
    'fix the runner Node version.';

/** describe() for suites that need the real engine. See the file header for the CI rule. */
export function describeSqlite(name: string, fn: () => void): void {
    const mode = sqliteSuiteMode(DatabaseSync !== null, process.env);
    if (mode === 'fail') throw new Error(`${name}: ${SQLITE_MISSING_MESSAGE}`);
    if (mode === 'skip') {
        describe.skip(`${name} [skipped locally: node:sqlite unavailable]`, fn);
        return;
    }
    describe(name, fn);
}

type BindValue = string | number | bigint | null | Uint8Array;

/**
 * expo-sqlite's bind forms -> node:sqlite's: an array, variadic values, or one
 * named-params object. Booleans bind as 1/0 (expo does; node:sqlite throws).
 */
function bindArgs(args: unknown[]): unknown[] {
    const bind = (v: unknown) => (typeof v === 'boolean' ? (v ? 1 : 0) : v);
    if (args.length === 1 && args[0] === undefined) return [];
    if (args.length === 1 && Array.isArray(args[0])) return (args[0] as unknown[]).map(bind);
    if (
        args.length === 1 &&
        args[0] !== null &&
        typeof args[0] === 'object' &&
        !(args[0] instanceof Uint8Array)
    ) {
        const named = args[0] as Record<string, unknown>;
        return [Object.fromEntries(Object.entries(named).map(([k, v]) => [k, bind(v)]))];
    }
    return args.map(bind);
}

/**
 * Wrap a node:sqlite database in the expo-sqlite async surface the app uses.
 * Rows come back as node:sqlite returns them (null-prototype objects), so
 * compare them with toEqual, not toStrictEqual against an object literal.
 */
export function sqliteAdapter(db: SyncDatabase) {
    const stmt = (sql: string, args: unknown[]) =>
        [db.prepare(sql), bindArgs(args) as BindValue[]] as const;
    const adapter = {
        /** The underlying synchronous handle, for direct seeding/inspection. */
        raw: db,
        execAsync: async (sql: string): Promise<void> => {
            db.exec(sql);
        },
        runAsync: async (sql: string, ...params: unknown[]) => {
            const [s, a] = stmt(sql, params);
            const r = s.run(...a);
            return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
        },
        getAllAsync: async <T = any>(sql: string, ...params: unknown[]): Promise<T[]> => {
            const [s, a] = stmt(sql, params);
            return s.all(...a) as T[];
        },
        getFirstAsync: async <T = any>(sql: string, ...params: unknown[]): Promise<T | null> => {
            const [s, a] = stmt(sql, params);
            return (s.get(...a) as T | undefined) ?? null;
        },
        withTransactionAsync: async (task: () => Promise<void>): Promise<void> => {
            db.exec('BEGIN');
            try {
                await task();
                db.exec('COMMIT');
            } catch (e) {
                db.exec('ROLLBACK');
                throw e;
            }
        },
    };
    return adapter;
}

export type SqliteAdapter = ReturnType<typeof sqliteAdapter>;

export type OpenSqliteOptions = {
    /** DDL (and optional seed statements) run once on open. */
    schema?: string;
    /** PRAGMA foreign_keys (the app's write connection runs with it ON). Default true. */
    foreignKeys?: boolean;
};

/** A fresh in-memory database behind the adapter. Throws if sqlite is missing (use inside describeSqlite). */
export function openSqlite({ schema, foreignKeys = true }: OpenSqliteOptions = {}): SqliteAdapter {
    if (!DatabaseSync) throw new Error(SQLITE_MISSING_MESSAGE);
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA foreign_keys = ${foreignKeys ? 'ON' : 'OFF'};`);
    if (schema) db.exec(schema);
    return sqliteAdapter(db);
}

/**
 * A fresh in-memory database at the SHIPPED schema: the app's own
 * runMigrations, not a hand-copied CREATE TABLE list that drifts from it.
 * Prefer this for new integration suites.
 */
export async function openMigratedSqlite(options: Omit<OpenSqliteOptions, 'schema'> = {}) {
    const db = openSqlite(options);
    const { runMigrations } = jest.requireActual<typeof import('@/databases/migrations')>(
        '@/databases/migrations'
    );
    await runMigrations(db as never);
    return db;
}

/** Row count of a table (optionally filtered by a WHERE clause body). */
export function countRows(db: SqliteAdapter, table: string, where?: string): number {
    const sql = `SELECT COUNT(*) AS n FROM ${table}${where ? ` WHERE ${where}` : ''}`;
    return Number((db.raw.prepare(sql).get() as { n: number | bigint }).n);
}
