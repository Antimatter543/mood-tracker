/**
 * CLASS-LEVEL INVARIANT (like queriesNoDateBucketing.test.ts / iconCatalog.test.ts).
 * Guards the whole write layer against a regression to the incident that
 * databases/writeTransaction.ts documents: every write used expo-sqlite's
 * `withExclusiveTransactionAsync` but ran its statements on the outer `db`
 * (ignoring the `txn` callback arg), so BEGIN/COMMIT wrapped NOTHING and the
 * writes had no atomicity. Three static rules, all enforced by scanning source:
 *
 *   1. NO expo transaction API (`withExclusiveTransactionAsync` /
 *      `withTransactionAsync`) anywhere in the runtime db/component modules —
 *      those are REPLACED by databases/writeTransaction.ts. (migrations.ts is the
 *      one documented exception: it runs at init AND inside resetDatabase's held
 *      write lock, and uses expo's `withTransactionAsync` on purpose.)
 *   2. Every WRITE module imports the write primitive from writeTransaction.ts.
 *   3. Inside a `withWriteTransaction` / `withWriteLock` callback, statements run
 *      on the callback's connection (`txn`/`conn`) — NEVER on the outer `db`
 *      (which would put the write outside the transaction: the original bug).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');

// Runtime modules reachable while writing. migrations.ts is EXCLUDED from rule 1
// (documented above); DBViewer.tsx is a component that must be SQL/txn-free.
const NO_EXPO_TXN_FILES = [
  'databases/entries.ts',
  'databases/activities.ts',
  'databases/groups.ts',
  'databases/data-export.ts',
  'databases/health-metrics.ts',
  'databases/lifecycle.ts',
  'components/generateData.ts',
  'components/DBViewer.tsx',
] as const;

// Modules that open write transactions — each must import from writeTransaction.
const WRITE_MODULES = [
  'databases/entries.ts',
  'databases/activities.ts',
  'databases/groups.ts',
  'databases/data-export.ts',
  'databases/health-metrics.ts',
  'databases/lifecycle.ts',
  'components/generateData.ts',
] as const;

const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

// Strip JS/SQL comments so a doc-comment that NAMES a banned symbol (to explain
// the rule / the incident) doesn't read as a live offender.
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/--[^\n]*/g, ' ');

describe('rule 1 — runtime modules never call expo transaction APIs', () => {
  it.each(NO_EXPO_TXN_FILES)('%s uses no withExclusive/withTransactionAsync', (file) => {
    const src = stripComments(read(file));
    expect(src).not.toMatch(/\.withExclusiveTransactionAsync\s*\(/);
    expect(src).not.toMatch(/\.withTransactionAsync\s*\(/);
  });

  it('migrations.ts is the ONLY runtime module allowed expo withTransactionAsync', () => {
    // Documents the exception AND proves it still exists (so the exclusion above
    // isn't silently pointing at a file that stopped using it).
    const src = stripComments(read('databases/migrations.ts'));
    expect(src).toMatch(/\.withTransactionAsync\s*\(/);
  });
});

describe('rule 2 — write modules import the write primitive', () => {
  it.each(WRITE_MODULES)('%s imports from databases/writeTransaction', (file) => {
    const src = read(file);
    expect(src).toMatch(/from ['"]@\/databases\/writeTransaction['"]/);
    expect(src).toMatch(/withWriteTransaction|withWriteLock/);
  });
});

/**
 * Extract each write-primitive callback body by brace-matching from the first
 * `{` after the call. (The write callbacks contain no `{`/`}` inside string
 * literals, so a plain brace counter is exact here.)
 */
function callbackBodies(src: string, primitive: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const call = src.indexOf(primitive + '(', from);
    if (call === -1) break;
    const open = src.indexOf('{', call);
    if (open === -1) break;
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) break;
    }
    bodies.push(src.slice(open + 1, i));
    from = i + 1;
  }
  return bodies;
}

const DB_DML = /\bdb\.(runAsync|execAsync|getAllAsync|getFirstAsync)\s*\(/;

describe('rule 3 — statements inside a write callback run on txn/conn, never the outer db', () => {
  it.each(WRITE_MODULES)('%s issues no db.<dml>() inside a write callback', (file) => {
    const src = stripComments(read(file));
    const bodies = [
      ...callbackBodies(src, 'withWriteTransaction'),
      ...callbackBodies(src, 'withWriteLock'),
    ];
    for (const body of bodies) {
      expect(body).not.toMatch(DB_DML);
    }
  });
});
