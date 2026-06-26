/**
 * CLASS-LEVEL INVARIANT (like queriesNoDateBucketing.test.ts / iconCatalog.test.ts).
 * Two rules for the runtime DB layer, both enforced here:
 *
 *   1. NO non-exclusive `withTransactionAsync(` anywhere in the runtime db modules.
 *   2. The runtime WRITE paths use `withExclusiveTransactionAsync`.
 *
 * WHY exclusive WRITES: expo-sqlite's `withTransactionAsync` does NOT take an
 * exclusive lock — per the official docs, "any query that runs while the
 * transaction is active will be included in the transaction, including statements
 * outside the scope function." The app runs every query on a SINGLE shared
 * connection, and the focus-driven refresh (`useDataRefresh` -> `fetchData`) fires
 * ~6 concurrent reads. A non-exclusive WRITE transaction can interleave with those
 * reads and leave the connection in a bad in-memory state -> reads return empty ->
 * Home cards revert to their empty state, stuck until the app is reopened (the
 * reported "everything disappears when I add a mood, fixed only by a restart" bug).
 * `withExclusiveTransactionAsync` serializes the connection for the callback
 * duration (clean drop-in; lifecycle.ts resetDatabase already uses it).
 *
 * WHY READS use NO transaction (the correction, 2026-06-26): wrapping the
 * `getMoodEntries` SELECT + its per-entry Promise.all of sub-reads in
 * withExclusiveTransactionAsync held that exclusive lock for the WHOLE walk — with
 * ~255 entries, ~510 serialized queries -> a ~3.2s main-thread block
 * (Choreographer "Skipped ~191 frames!") that blanked Timeline under a rapid tab
 * burst, and a read-side BEGIN is itself a collision vector. A timeline list does
 * NOT need a consistent snapshot (the focus refresh re-reads anyway), and plain
 * awaited reads serialize on the single connection fine. So a READ path correctly
 * has NEITHER transaction wrapper — only the BANNED-`withTransactionAsync` rule
 * (#1) applies to it, never an exclusive-required rule.
 *
 * EXCLUDED from the scan on purpose:
 *   - databases/migrations.ts: `runMigrations` runs at init AND is also invoked
 *     INSIDE resetDatabase's exclusive transaction (lifecycle.ts). Making its inner
 *     transaction exclusive too would nest BEGIN EXCLUSIVE inside an already-open
 *     exclusive transaction and break init/reset. It stays `withTransactionAsync`.
 *   - databases/lifecycle.ts: already uses `withExclusiveTransactionAsync`.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

// The runtime, user-facing DB modules reachable while a screen is reading on the
// shared connection. (migrations/lifecycle excluded — see the file header.)
const RUNTIME_DB_FILES = [
  'entries.ts',
  'activities.ts',
  'groups.ts',
  'data-export.ts',
] as const;

// The subset that opens at least one WRITE transaction (so the exclusive-usage
// scan is provably non-empty). `entries.ts` qualifies via addMoodEntry — its
// getMoodEntries READ deliberately has no transaction at all.
const RUNTIME_WRITE_FILES = [
  'entries.ts',
  'activities.ts',
  'groups.ts',
  'data-export.ts',
] as const;

const dbDir = join(__dirname, '..', 'databases');

// Matches a non-exclusive transaction call: `.withTransactionAsync(`. NOTE this
// also substring-matches inside `.withExclusiveTransactionAsync(` — so we test it
// only AFTER stripping the allowed exclusive calls from the source (below),
// otherwise every exclusive call would be a false positive.
const BANNED_TXN = /\.withTransactionAsync\s*\(/;

// Strip JS/SQL comments so a doc-comment that NAMES `withTransactionAsync` (to
// explain the rule / the migrations exclusion) doesn't read as a live offender.
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/\/\/[^\n]*/g, ' ') // JS line comments
    .replace(/--[^\n]*/g, ' '); // SQL line comments

// Remove the ALLOWED exclusive calls so the remaining `.withTransactionAsync(`
// matches are ONLY genuine non-exclusive ones (the look-behind alternative isn't
// reliable across the substring boundary, so neutralise the allowed form first).
const stripExclusiveCalls = (src: string): string =>
  src.replace(/\.withExclusiveTransactionAsync\s*\(/g, '.__exclusiveTxn__(');

describe('runtime DB modules never use a non-exclusive transaction', () => {
  it.each(RUNTIME_DB_FILES)(
    'databases/%s contains no non-exclusive withTransactionAsync()',
    (file) => {
      const src = stripExclusiveCalls(stripComments(readFileSync(join(dbDir, file), 'utf8')));
      const match = src.match(BANNED_TXN);
      expect(
        match
          ? `databases/${file} uses the non-exclusive db.withTransactionAsync(...). ` +
              `On the shared connection it can interleave with the focus-driven refresh ` +
              `reads and blank the dashboard until restart. For a WRITE use ` +
              `db.withExclusiveTransactionAsync(...) (drop-in; see lifecycle.ts); a READ ` +
              `should use no transaction at all (plain awaited queries).`
          : null,
      ).toBeNull();
    },
  );
});

describe('runtime DB WRITE paths use exclusive transactions', () => {
  it.each(RUNTIME_WRITE_FILES)(
    'databases/%s opens at least one withExclusiveTransactionAsync()',
    (file) => {
      const src = readFileSync(join(dbDir, file), 'utf8');
      // Proves the scan above actually saw exclusive transaction code (so a
      // rename can't silently empty it) AND that the write paths stayed exclusive.
      expect(src).toMatch(/withExclusiveTransactionAsync/);
    },
  );
});
