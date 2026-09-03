/**
 * CLASS-LEVEL INVARIANT (like queriesNoDateBucketing.test.ts): every SELECT over
 * the `entries` table must decide, explicitly, what it does about soft-deleted
 * rows.
 *
 * Migration 12 made "delete" a stamp on `entries.deleted_at` rather than a row
 * removal. That is a whole-codebase hazard, not a local one: EVERY pre-existing
 * read silently started including binned entries, and a miss is invisible in
 * tsc, in jest, and on a device with an empty bin — it only shows up as a
 * deleted entry haunting the stats/streak/heatmap weeks later. Two of the reads
 * that needed fixing (CO_OCCURRING_ACTIVITIES, ACTIVITY_ENTRY_COUNTS) did not
 * even NAME the entries table before this change; they counted `entry_activities`
 * rows, which a soft delete deliberately preserves.
 *
 * So the rule is structural, not per-query: any string literal in app source
 * that SELECTs from/joins `entries` MUST contain a `deleted_at IS [NOT] NULL`
 * predicate. `IS NOT NULL` is accepted because the bin's own reads legitimately
 * want the other side — the invariant is "the author decided", not "always
 * exclude". Statements that are not SELECTs (INSERT / DELETE / ALTER / CREATE /
 * DROP) are out of scope: they act on rows by id or on the whole table by
 * design.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import * as queries from '@/components/visualisations/queries';

const ROOT = join(__dirname, '..');

// Directories that hold runtime SQL. `__tests__` is deliberately excluded — a
// test's SQL is the thing doing the asserting.
const SCANNED_DIRS = ['app', 'components', 'context', 'databases', 'hooks', 'lib'];

// Dev-only seed tooling. `generateData.clearAllEntries` is a blanket
// `DELETE FROM entries` behind the __DEV__ "Generate sample entries" button; it
// is MEANT to nuke everything including the bin, and it issues no SELECT anyway.
const EXEMPT_FILES = new Set<string>([]);

/**
 * Every string / template literal in a source file. SQL in this codebase lives
 * in backtick templates or single-quoted strings; extracting literals (rather
 * than regexing whole files) means the predicate has to be in the SAME query as
 * the `FROM entries`, not merely somewhere in the file, and it makes comments
 * that DISCUSS the rule harmless.
 */
const LITERALS = /`[^`]*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g;

const READS_ENTRIES = /\bSELECT\b[\s\S]*\b(?:FROM|JOIN)\s+entries\b/i;
const HAS_DELETED_PREDICATE = /deleted_at\s+IS\s+(?:NOT\s+)?NULL/i;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) {
        if (name === 'node_modules' || name === '__tests__') continue;
        walk(full);
      } else if (/\.tsx?$/.test(name)) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

const FILES = SCANNED_DIRS.flatMap((d) => sourceFiles(join(ROOT, d))).filter(
  (f) => !EXEMPT_FILES.has(f)
);

describe('every exported SQL constant that reads entries excludes the bin', () => {
  const sqlExports = Object.entries(queries).filter(
    ([, v]) => typeof v === 'string'
  ) as [string, string][];

  it('exposes SQL string constants to check (guards against an empty scan)', () => {
    expect(sqlExports.length).toBeGreaterThan(0);
  });

  it.each(sqlExports)('%s carries a deleted_at predicate if it reads entries', (name, sql) => {
    if (!READS_ENTRIES.test(sql)) return; // e.g. a pure entry_activities aggregate
    expect(
      HAS_DELETED_PREDICATE.test(sql)
        ? null
        : `${name} SELECTs from \`entries\` without a \`deleted_at IS NULL\` predicate — ` +
            `it would surface recycle-bin entries. Add it (or \`IS NOT NULL\` if this query ` +
            `is deliberately reading the bin).`
    ).toBeNull();
  });
});

describe('no source file carries an inline SELECT over entries without the bin predicate', () => {
  it('found source files to scan (guards against a broken walk)', () => {
    expect(FILES.length).toBeGreaterThan(20);
  });

  it.each(FILES)('%s', (file) => {
    const src = readFileSync(file, 'utf8');
    const offenders = (src.match(LITERALS) ?? []).filter(
      (lit) => READS_ENTRIES.test(lit) && !HAS_DELETED_PREDICATE.test(lit)
    );
    expect(
      offenders.length
        ? `${file} contains ${offenders.length} SELECT(s) over \`entries\` with no ` +
            `\`deleted_at\` predicate — recycle-bin entries would leak into it. First: ` +
            offenders[0].replace(/\s+/g, ' ').slice(0, 160)
        : null
    ).toBeNull();
  });
});
