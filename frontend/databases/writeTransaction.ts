import { openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';

/**
 * The ONE write-transaction primitive for the whole app. Every multi-statement
 * write MUST go through `withWriteTransaction`; nothing else opens a real
 * transaction (migrations.ts is the one documented exception — see below).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS — the transactions we thought we shipped were FAKE.
 * ─────────────────────────────────────────────────────────────────────────────
 * The whole app used expo-sqlite's `db.withExclusiveTransactionAsync(task)`. Its
 * source (node_modules/expo-sqlite/src/SQLiteDatabase.ts) is:
 *
 *     const transaction = await Transaction.createAsync(this); // a SEPARATE
 *                                        // connection: { useNewConnection: true }
 *     await transaction.execAsync('BEGIN');
 *     await task(transaction);           // ← passes the NEW connection as `txn`
 *     await transaction.execAsync('COMMIT');
 *
 * The contract is: statements inside the callback MUST run on the `txn` argument.
 * But every call site in this codebase wrote `async () => { await db.runAsync(…) }`
 * — ignoring `txn` and using the OUTER `db` (the provider's main connection). So:
 *   • BEGIN / COMMIT wrapped NOTHING on the idle second connection, and
 *   • the real statements ran on the MAIN connection in autocommit mode.
 * The result: ZERO atomicity (a mid-write failure left entries without their
 * activities, and a retry could duplicate a row), and the "exclusive lock"
 * the 2026-06-26 Home-blank fix believed it added never existed. Green tsc/jest
 * proved nothing here — the jest mock's `withExclusiveTransactionAsync` just runs
 * the callback, so it can't tell a real transaction from an empty one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY WE CAN'T JUST "USE txn" — expo's API cannot be salvaged.
 * ─────────────────────────────────────────────────────────────────────────────
 * Two per-connection PRAGMA traps make the naive fix silently wrong:
 *   • `PRAGMA foreign_keys` is PER-CONNECTION. It's set ON only on the main
 *     connection (in initializeDatabase). expo's fresh `txn` connection has FK
 *     OFF, so `ON DELETE CASCADE` would stop firing inside "fixed" transactions
 *     (deleting an entry would orphan its entry_activities / entry_media rows).
 *   • `PRAGMA foreign_keys` is a silent NO-OP inside an open transaction, and
 *     `withExclusiveTransactionAsync` issues BEGIN *before* your callback runs —
 *     so you can't turn FK on from inside it either.
 * So we stop using expo's transaction API entirely and own the connection.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DESIGN — one singleton write connection + an in-process mutex.
 * ─────────────────────────────────────────────────────────────────────────────
 * • ONE lazily-opened write connection (`useNewConnection: true`, same DB file).
 *   Immediately, BEFORE any transaction, we set `busy_timeout` (so a cross-
 *   connection lock wait retries instead of erroring) and `foreign_keys = ON`
 *   (so cascades are real on THIS connection). `journal_mode = WAL` is persisted
 *   in the file by initializeDatabase, so this connection inherits it — readers
 *   on the main connection never block this writer and vice versa.
 * • An in-process async mutex (a promise chain) serialises every app write. Two
 *   overlapping `withWriteTransaction` calls can't interleave BEGIN/COMMIT on the
 *   single write connection, so a nested `BEGIN` (SQLite forbids it) can never
 *   happen, and writes commit in a well-defined order.
 * • `BEGIN IMMEDIATE` (not the plain deferred `BEGIN` expo uses) claims the
 *   write lock up front. A deferred BEGIN only takes the write lock when the
 *   first write executes, so under contention it can fail to UPGRADE from a read
 *   lock with SQLITE_BUSY mid-transaction; IMMEDIATE fails fast at the top (and
 *   busy_timeout covers the brief wait) instead.
 *
 * Read paths take NO transaction and stay on the provider's main connection —
 * a list read needs neither exclusivity nor a snapshot (the focus refresh
 * re-reads anyway), and WAL lets those reads run concurrently with a write here.
 */

/**
 * The on-device SQLite file name. Single source of truth: the SQLiteProvider in
 * `app/(tabs)/_layout.tsx` opens the READ connection with this exact name, and
 * the write connection below opens a second connection to the SAME file. Keeping
 * one constant guarantees both connections point at one database.
 */
export const DATABASE_NAME = 'moodTracker.db';

/**
 * The lazily-opened singleton write connection. `null` until the first write.
 * Held as the resolved Promise so concurrent first-writers share ONE open.
 */
let writeConnectionPromise: Promise<SQLiteDatabase> | null = null;

/**
 * Test-only override. When set, `withWriteTransaction` runs against this handle
 * instead of opening a real connection — so a unit test can inject the same mock
 * DB it asserts on (statements land on the injected handle, `txn === db`).
 */
let injectedWriteConnection: SQLiteDatabase | null = null;

/**
 * The write mutex: every `withWriteTransaction` chains onto this promise so only
 * one transaction is open on the write connection at a time. Starts resolved.
 */
let writeMutex: Promise<unknown> = Promise.resolve();

/**
 * Open (once) the singleton write connection and put it in a known good state
 * BEFORE any transaction: busy_timeout + foreign_keys ON. These are per-
 * connection settings, so they must be applied to THIS connection explicitly
 * (see the header). A test-injected connection short-circuits the open.
 */
async function getWriteConnection(): Promise<SQLiteDatabase> {
  if (injectedWriteConnection) return injectedWriteConnection;
  if (!writeConnectionPromise) {
    writeConnectionPromise = (async () => {
      const conn = await openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
      // Per-connection, and BEFORE any transaction (PRAGMA foreign_keys is a
      // no-op inside a transaction; busy_timeout must be live before we contend
      // for the write lock with BEGIN IMMEDIATE).
      await conn.execAsync('PRAGMA busy_timeout = 5000;');
      await conn.execAsync('PRAGMA foreign_keys = ON;');
      return conn;
    })();
  }
  return writeConnectionPromise;
}

/**
 * Hold the write mutex for the duration of `task`, handing it the singleton
 * write connection. This is the low-level primitive: it serialises writes but
 * does NOT open a transaction — the caller owns BEGIN/COMMIT (and any PRAGMA
 * toggling). `withWriteTransaction` is the common case built on top of it;
 * `resetDatabase` (lifecycle.ts) uses it directly because it must toggle
 * `foreign_keys` OUTSIDE a transaction and then let `runMigrations` open its own
 * (un-nested) transaction on the same held connection.
 *
 * The mutex is always released in `finally`, so one failed write can't wedge the
 * queue; a rejected predecessor is awaited-and-ignored (that caller already saw
 * its own error).
 */
export async function withWriteLock<T>(
  task: (conn: SQLiteDatabase) => Promise<T>
): Promise<T> {
  const previous = writeMutex;
  let release!: () => void;
  writeMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => {});
  try {
    const conn = await getWriteConnection();
    return await task(conn);
  } finally {
    release();
  }
}

/**
 * Run `task` inside a real, serialized write transaction on the singleton write
 * connection. Statements MUST be issued on the `txn` argument, never on the
 * app's read connection (that would leave the write outside the transaction —
 * the original bug this module fixes).
 *
 * Ordering per call: acquire the mutex → `BEGIN IMMEDIATE` → `await task(txn)` →
 * `COMMIT`. On any error we `ROLLBACK` (best-effort — a failed rollback is
 * swallowed so the ORIGINAL error is what propagates) and rethrow.
 */
export function withWriteTransaction<T>(
  task: (txn: SQLiteDatabase) => Promise<T>
): Promise<T> {
  return withWriteLock(async (conn) => {
    await conn.execAsync('BEGIN IMMEDIATE;');
    try {
      const result = await task(conn);
      await conn.execAsync('COMMIT;');
      return result;
    } catch (error) {
      // Best-effort rollback: if it throws (e.g. no transaction is open because
      // BEGIN itself failed), swallow that so the real error below propagates.
      try {
        await conn.execAsync('ROLLBACK;');
      } catch {
        // ignore — the meaningful failure is `error`, rethrown below.
      }
      throw error;
    }
  });
}

/**
 * TEST ONLY. Inject a stand-in write connection (or `null` to clear). Lets a
 * unit test route the transaction body onto the very mock DB it asserts against,
 * so `withWriteTransaction(async (txn) => txn.runAsync(…))` records calls on that
 * mock (`txn === db`). Never call this in app code.
 */
export function __setWriteConnectionForTests(conn: SQLiteDatabase | null): void {
  injectedWriteConnection = conn;
}

/**
 * TEST ONLY. Reset all module-level state (injected handle, the lazily-opened
 * singleton, and the mutex) so each test starts clean.
 */
export function __resetWriteTransactionForTests(): void {
  injectedWriteConnection = null;
  writeConnectionPromise = null;
  writeMutex = Promise.resolve();
}
