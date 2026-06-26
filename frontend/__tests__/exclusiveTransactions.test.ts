/**
 * CLASS-LEVEL INVARIANT (like queriesNoDateBucketing.test.ts / iconCatalog.test.ts):
 * runtime, user-facing DB writes must use `withExclusiveTransactionAsync`, never
 * the non-exclusive `withTransactionAsync`.
 *
 * WHY this whole class is banned: expo-sqlite's `withTransactionAsync` does NOT
 * take an exclusive lock — per the official docs, "any query that runs while the
 * transaction is active will be included in the transaction, including statements
 * outside the scope function." The app runs every query on a SINGLE shared
 * connection, and the focus-driven Home refresh (`useDataRefresh` -> `fetchData`)
 * fires ~6 concurrent reads. A non-exclusive write transaction can interleave with
 * those reads and leave the connection in a bad in-memory state -> reads return
 * empty -> Home cards revert to their empty state, stuck until the app is reopened
 * (the reported "everything disappears when I add a mood, fixed only by a restart"
 * bug). `withExclusiveTransactionAsync` serializes the connection for the callback
 * duration and is a clean drop-in (lifecycle.ts resetDatabase already uses it).
 *
 * This test scans the runtime DB module sources and FAILS if any of them contains
 * a non-exclusive `withTransactionAsync(` call, so the bug class can never silently
 * regress.
 *
 * EXCLUDED on purpose:
 *   - databases/migrations.ts: `runMigrations` runs at init AND is also invoked
 *     INSIDE resetDatabase's exclusive transaction (lifecycle.ts). Making its inner
 *     transaction exclusive too would nest BEGIN EXCLUSIVE inside an already-open
 *     exclusive transaction and break init/reset. It stays `withTransactionAsync`.
 *   - databases/lifecycle.ts: already uses `withExclusiveTransactionAsync`.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

// The runtime, user-facing DB modules whose write transactions are reachable while
// a screen is reading on the shared connection. (migrations/lifecycle excluded —
// see the file header for why.)
const RUNTIME_DB_FILES = [
  'entries.ts',
  'activities.ts',
  'groups.ts',
  'data-export.ts',
] as const;

const dbDir = join(__dirname, '..', 'databases');

// Matches a non-exclusive transaction call: `.withTransactionAsync(` but NOT
// `.withExclusiveTransactionAsync(`. The `(?<!Exclusive)` look-behind on the
// method-name boundary is what distinguishes the banned call from the allowed one.
const BANNED_TXN = /\.withTransactionAsync\s*\(/;

// Strip JS/SQL comments so a doc-comment that NAMES `withTransactionAsync` (to
// explain the rule / the migrations exclusion) doesn't read as a live offender.
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/\/\/[^\n]*/g, ' ') // JS line comments
    .replace(/--[^\n]*/g, ' '); // SQL line comments

describe('runtime DB modules use exclusive transactions only', () => {
  it.each(RUNTIME_DB_FILES)(
    'databases/%s contains no non-exclusive withTransactionAsync()',
    (file) => {
      const src = stripComments(readFileSync(join(dbDir, file), 'utf8'));
      const match = src.match(BANNED_TXN);
      expect(
        match
          ? `databases/${file} uses the non-exclusive db.withTransactionAsync(...). ` +
              `On the shared connection it can interleave with the focus-driven Home ` +
              `refresh reads and blank the dashboard until restart. Use ` +
              `db.withExclusiveTransactionAsync(...) instead (drop-in; see lifecycle.ts).`
          : null,
      ).toBeNull();
    },
  );

  it('guards against an empty scan (the files exist and were read)', () => {
    for (const file of RUNTIME_DB_FILES) {
      const src = readFileSync(join(dbDir, file), 'utf8');
      // Every one of these modules opens at least one transaction; assert the
      // scan actually saw transaction code so a rename can't silently empty it.
      expect(src).toMatch(/withExclusiveTransactionAsync/);
    }
  });
});
