# SoulSync DB layer — contract

The on-device SQLite facade (schema, migrations, CRUD, media, write transactions).
100% local: `moodTracker.db` + on-device files, no cloud. Read this before touching
any write path.

## Connection model (there are genuinely TWO connections)

- **Read connection** — the `expo-sqlite` `SQLiteProvider`'s connection
  (`app/(tabs)/_layout.tsx`, `databaseName={DATABASE_NAME}`, `onInit={initializeDatabase}`).
  Every screen/hook reads through `useSQLiteContext()`. Reads take **no transaction**.
- **Write connection** — ONE lazily-opened singleton in `writeTransaction.ts`
  (`openDatabaseAsync(DATABASE_NAME, { useNewConnection: true })`). Every
  multi-statement write runs here, serialized by an in-process mutex.
- **WAL** (`journal_mode = WAL`, set once in `initializeDatabase`, persisted in the
  file) is what lets the two connections coexist: readers never block the writer and
  vice versa.
- `DATABASE_NAME` lives in `writeTransaction.ts` and is the single source of truth for
  both connections — never hardcode `'moodTracker.db'` elsewhere.

## THE RULE — all multi-statement writes go through `withWriteTransaction`

```ts
import { withWriteTransaction } from '@/databases/writeTransaction';

await withWriteTransaction(async (txn) => {
  await txn.runAsync('INSERT ...');       // statements on `txn`, NEVER the outer db
  await txn.runAsync('INSERT ...');
});
```

- **NEVER** call expo's `db.withExclusiveTransactionAsync` / `db.withTransactionAsync`
  in runtime code. WHY: `withExclusiveTransactionAsync` opens a *separate* connection
  and passes it as the `txn` callback arg — this codebase ignored `txn` and ran its
  statements on the outer `db` (the main connection), so BEGIN/COMMIT wrapped NOTHING
  and every "transaction" had **zero atomicity** (an entry could persist without its
  activities; a retry could duplicate). The full incident write-up is the header of
  `writeTransaction.ts`. Enforced by `__tests__/writeTransactionInvariant.test.ts`.
- Statements inside the callback run on **`txn`** only. A `db.runAsync(...)` inside a
  callback body puts the write OUTSIDE the transaction — the original bug. (Pre-reads
  that inform the write may run on the read `db` BEFORE the callback.)
- `withWriteLock(async (conn) => …)` is the lower-level mutex primitive (no auto
  BEGIN/COMMIT) — used only by `resetDatabase`, which must toggle `foreign_keys`
  outside a transaction and let `runMigrations` open its own.

### The ONE exception: `migrations.ts`

`runMigrations` keeps expo's `withTransactionAsync`. It runs at init (before any
concurrency) AND inside `resetDatabase`'s held write lock, and nesting a
`BEGIN IMMEDIATE` inside it would break. The invariant test excludes it explicitly.

### Single-statement settings upserts stay on the read connection

`user-settings.ts` (`updateSetting`, `initializeSettingsTable`) issue ONE autocommit
statement each — atomic on their own, and `busy_timeout` covers cross-connection
contention. They deliberately do NOT use `withWriteTransaction`. (Not in the invariant
scan.)

## Per-connection PRAGMA gotchas (the traps that motivated the write connection)

- **`foreign_keys` is PER-CONNECTION and NOT persisted.** It's set ON on the read
  connection (`initializeDatabase`) AND on the write connection (`writeTransaction.ts`,
  before any BEGIN). Cascades (`ON DELETE CASCADE`) only fire on a connection where FK
  is ON — so a delete's cascade depends on which connection runs it (deletes run on the
  write connection → FK ON → cascade real).
- **`foreign_keys` is a silent NO-OP inside an open transaction.** Set it before BEGIN.
  This is why `resetDatabase` toggles FK OFF/ON *outside* its drop transaction.
- **`busy_timeout` is per-connection** — set on both connections so a cross-connection
  lock wait retries instead of throwing SQLITE_BUSY.
- **`journal_mode = WAL` is PERSISTED in the file** (not per-connection) — set once.
- **`BEGIN IMMEDIATE`** (not deferred `BEGIN`) claims the write lock up front, so a
  write can't fail to upgrade from a read lock with SQLITE_BUSY mid-transaction.

## Date storage contract (mirror of `entries.ts` / `dateHelpers.ts`)

`entries.date` is a **UTC ISO-8601 instant** (`new Date().toISOString()`). SQL only
(a) RANGE-FILTERS on the stored instant with UTC ISO bounds from `startOfLocalDay` /
`endOfLocalDay`, and (b) returns the RAW instant. SQL NEVER day-buckets with
`date()` / `strftime()` (they run in UTC and misattribute backdated entries) — JS owns
day-keying via `localDateString`. The entry form now edits BOTH date and time
(`components/forms/DatePicker.tsx`), so a picked day preserves the time-of-day; the
local-day key still comes from `localDateString`, never `.slice(0,10)`.

## Testing the SQL layer

- The `expo-sqlite` jest mock is a **no-op stub** — `getAllAsync` resolves `[]`, the
  transaction methods just run the callback. A green `tsc + jest` says NOTHING about
  whether SQL actually runs correctly. (See the 2026-07-05 lesson in `tasks/lessons.md`.)
- For real SQL behavior write a **`node:sqlite` integration test** (Node ≥ 22.5, CI is
  Node 22): create the schema, seed rows, run the REAL function/query, assert results.
  References: `__tests__/entries.integration.test.ts` (write-layer atomicity / rollback
  / FK cascade) and `__tests__/entryFilter.integration.test.ts` (Timeline filter CTE).
- Unit-testing a write path with the stub: inject the write connection with
  `__setWriteConnectionForTests(db)` so statements land on the mock you assert on
  (`txn === db`); reset with `__resetWriteTransactionForTests()` per test.
