/**
 * CLASS-LEVEL INVARIANT (like iconCatalog.test.ts): SQL must NEVER day-bucket a
 * stored timestamp.
 *
 * The timezone day-keying bug shipped because SQLite's `date(date)` /
 * `strftime('%w', date)` group/extract in UTC, so a backdated entry stored at
 * LOCAL midnight (= the previous UTC day for any UTC+N user) bucketed onto the
 * wrong day in the Home charts, the streak, the heatmap, the calendar, and the
 * insights queries. The architectural fix moved ALL day-keying out of SQL into
 * one tested JS authority (localDateString / aggregateDailyAverages).
 *
 * This test scans EVERY exported SQL string in queries.ts and asserts none of
 * them re-introduces `date(date)` / `date(e.date)` / `strftime(... date ...)`
 * on a stored timestamp — so the whole bug class is structurally banned and can
 * never silently regress. (Range-filtering with parameterised UTC ISO bounds —
 * `WHERE date BETWEEN ? AND ?` — is fine and is what's expected instead.)
 *
 * Coverage note: the previously-INLINE SQL in app/(tabs)/index.tsx (monthStats)
 * and app/(tabs)/_layout.tsx (notification re-arm) was moved into queries.ts as
 * named exports (MONTHLY_DAILY_AVERAGES / RECENT_ENTRY_DATES) precisely so this
 * invariant covers it too. A grep guard below also fails if those screens grow
 * a new inline `date(date)` / `strftime` over a stored timestamp.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as queries from '@/components/visualisations/queries';

// Matches SQLite day-bucketing of the stored `date` column:
//   date(date) | date( e.date ) | strftime('%w', date) | strftime('%Y', e.date)
//
// CASE-SENSITIVE (no /i flag) on purpose: SQL in this codebase is lowercase
// (`date(...)`, `strftime(...)`), whereas JS uses the capitalised `Date`
// constructor. Matching only lowercase `date(` cleanly distinguishes the banned
// SQL function from a legitimate `new Date(date)` in JS. The leading
// `(?<![A-Za-z])` also rules out `update(` / identifiers ending in `date`. It
// does NOT match the legitimate `WHERE date BETWEEN ? AND ?` range filter.
const BANNED = /(?<![A-Za-z])date\s*\(\s*(?:[a-z_]+\.)?date\s*[),]|strftime\s*\([^)]*\bdate\b/;

// Strip JS/SQL comments so a doc-comment EXPLAINING the old buggy SQL (which we
// keep, for the "why") doesn't read as a live offender. Removes // line, /* */
// block, and -- SQL line comments. Crude but sufficient for source scanning.
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/\/\/[^\n]*/g, ' ') // JS line comments
    .replace(/--[^\n]*/g, ' '); // SQL line comments

describe('queries.ts SQL never day-buckets a stored timestamp', () => {
  const sqlExports = Object.entries(queries).filter(
    ([, v]) => typeof v === 'string',
  ) as [string, string][];

  it('exposes SQL string constants to check (guards against an empty scan)', () => {
    expect(sqlExports.length).toBeGreaterThan(0);
  });

  it.each(sqlExports)('%s does not call date()/strftime on a stored timestamp', (name, sql) => {
    const match = sql.match(BANNED);
    expect(
      match
        ? `${name} contains banned SQL day-bucketing: "${match[0]}". Return the raw instant and day-key in JS via localDateString/aggregateDailyAverages instead.`
        : null,
    ).toBeNull();
  });
});

describe('no source file carries inline SQL day-bucketing (comments excluded)', () => {
  // These screens + the visualisation components previously held inline SQL
  // that day-bucketed in UTC. Re-scan their (comment-stripped) source so a
  // future inline query can't dodge the queries.ts string-export invariant.
  const FILES: string[] = [
    join(__dirname, '..', 'app', '(tabs)', 'index.tsx'),
    join(__dirname, '..', 'app', '(tabs)', '_layout.tsx'),
  ];
  const visDir = join(__dirname, '..', 'components', 'visualisations');
  for (const f of readdirSync(visDir)) {
    if (f.endsWith('.tsx') || f.endsWith('.ts')) FILES.push(join(visDir, f));
  }

  it.each(FILES)('%s has no inline date()/strftime over a stored timestamp', (file) => {
    const src = stripComments(readFileSync(file, 'utf8'));
    const match = src.match(BANNED);
    expect(
      match ? `${file} contains inline banned SQL day-bucketing: "${match[0]}"` : null,
    ).toBeNull();
  });
});
